"""
Download and ingest web images into project storage.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from utils.image_analysis import (
    analyze_image_caption_sync,
    analyze_image_ocr_sync,
    analyze_caption_from_text_sync,
    build_image_extracted_text,
)
from utils.image_assets import IMAGE_EXTENSIONS
from utils.minio_storage import resolve_project_path, is_minio_enabled
from utils.svg_utils import extract_svg_text, rasterize_svg_to_png


class ImageIngestor:
    def __init__(
        self,
        project_id: str,
        file_tools=None,
        project_root: Optional[Path] = None,
    ):
        self.project_id = project_id
        self.file_tools = file_tools
        self._cleanup = None

        if project_root is not None:
            self.project_root = Path(project_root)
        elif is_minio_enabled():
            project_root, cleanup = resolve_project_path(None, project_id)
            self.project_root = Path(project_root)
            self._cleanup = cleanup
        else:
            base = os.getenv("GENLATEX_PROJECTS_PATH", ".")
            self.project_root = Path(base) / project_id
            self.project_root.mkdir(parents=True, exist_ok=True)

        self.image_dir = self.project_root / "research_images"
        self.image_dir.mkdir(parents=True, exist_ok=True)

        self.max_bytes = int(os.getenv("WEB_IMAGE_MAX_BYTES", "6000000"))
        self.max_per_query = int(os.getenv("WEB_IMAGE_MAX_PER_QUERY", "5"))
        self._seen_hashes = set()

        self.app_base_url = (
            os.getenv("GENLATEX_APP_URL")
            or os.getenv("NEXT_PUBLIC_APP_URL")
            or os.getenv("NEXT_PUBLIC_BASE_URL")
            or ""
        )
        self.agent_token = os.getenv("GENLATEX_AGENT_API_KEY") or os.getenv("AGENT_API_TOKEN") or ""
        self.persist_enabled = bool(self.app_base_url)

    def finalize(self) -> None:
        if self._cleanup:
            try:
                self._cleanup()
            except Exception:
                pass

    def ingest_urls(self, urls: List[str], source: str = "web") -> List[Dict[str, Any]]:
        added = []
        if not urls:
            return added

        count = 0
        with httpx.Client(timeout=12.0, follow_redirects=True) as client:
            for url in urls:
                if count >= self.max_per_query:
                    break
                if not url or not isinstance(url, str):
                    continue
                try:
                    response = client.get(url, headers={"User-Agent": "GenLaTeXImageBot/1.0"})
                except Exception:
                    continue
                if response.status_code != 200:
                    continue
                content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
                if not content_type.startswith("image/"):
                    continue
                image_bytes = response.content or b""
                if not image_bytes or len(image_bytes) > self.max_bytes:
                    continue

                ext = _guess_ext(content_type, url)

                svg_text = ""
                analysis_bytes = image_bytes
                analysis_mime = content_type or "image/png"

                if ext == "svg":
                    svg_text = extract_svg_text(image_bytes)
                    rasterized = rasterize_svg_to_png(image_bytes)
                    if rasterized:
                        ext = "png"
                        analysis_bytes = rasterized
                        analysis_mime = "image/png"
                    else:
                        analysis_mime = "image/svg+xml"

                digest = hashlib.sha256(analysis_bytes).hexdigest()
                if digest in self._seen_hashes:
                    continue
                self._seen_hashes.add(digest)

                file_id = f"webimg_{digest[:12]}"
                file_name = f"{file_id}.{ext}"
                file_path = self.image_dir / file_name

                try:
                    file_path.write_bytes(analysis_bytes)
                except Exception:
                    continue

                caption_data = analyze_image_caption_sync(analysis_bytes, analysis_mime, file_name)
                ocr_text = ""
                if svg_text:
                    if not caption_data.get("caption"):
                        caption_data = analyze_caption_from_text_sync(svg_text, file_name=file_name)
                    ocr_text = svg_text
                else:
                    ocr_text = analyze_image_ocr_sync(analysis_bytes, analysis_mime)
                caption = caption_data.get("caption", "")
                tags = caption_data.get("tags", [])

                image_analysis = {
                    "caption": caption,
                    "image_type": caption_data.get("image_type", "other"),
                    "tags": tags,
                    "confidence": caption_data.get("confidence", 0.0),
                    "ocr_text": ocr_text,
                }

                extracted_text = build_image_extracted_text(caption, ocr_text)
                extracted_content = {
                    "success": True,
                    "file_type": ext,
                    "total_pages": 1,
                    "total_chars": len(extracted_text),
                    "chunks": [],
                    "full_text": extracted_text,
                }

                meta = {
                    "about": caption or f"Web image from {source}",
                    "summary": caption,
                    "keywords": tags,
                    "image_analysis": image_analysis,
                    "contentPreview": (caption or "")[:500],
                    "source_url": url,
                    "source": source,
                }

                file_info = {
                    "fileId": file_id,
                    "fileName": file_name,
                    "filePath": str(file_path),
                    "fileType": ext,
                    "fileSize": len(analysis_bytes),
                    "contentHash": digest,
                    "metadata": meta,
                    "extracted_content": extracted_content,
                    "derived": True,
                }

                if self.file_tools:
                    self.file_tools.add_research_file(file_info)

                added.append(file_info)
                count += 1

        if added:
            self._persist_to_db(added)

        return added

    def _persist_to_db(self, files: List[Dict[str, Any]]) -> None:
        if not self.persist_enabled or not files:
            return

        url = f"{self.app_base_url.rstrip('/')}/api/files/{self.project_id}/research/ingest"
        headers = {}
        if self.agent_token:
            headers["Authorization"] = f"Bearer {self.agent_token}"

        payload_files = []
        for f in files:
            if not isinstance(f, dict):
                continue
            meta = dict(f.get("metadata") or {})
            extracted = f.get("extracted_content")
            if extracted:
                meta["extracted_content"] = extracted
            analysis_tags = (meta.get("image_analysis") or {}).get("tags")
            if not isinstance(analysis_tags, list):
                analysis_tags = []
            keywords = meta.get("keywords") if isinstance(meta.get("keywords"), list) else analysis_tags

            # Use storage-relative path for DB (research_images/filename) so it works
            # when agent runs again with different temp dir or when MinIO is used
            file_path = f.get("filePath") or f.get("file_path") or ""
            if file_path and self.project_id:
                try:
                    parts = tuple(Path(file_path).parts)
                    if self.project_id in parts:
                        idx = parts.index(self.project_id)
                        rel = Path(*parts[idx + 1:]) if idx + 1 < len(parts) else Path(file_path).name
                        file_path = str(rel).replace("\\", "/")
                    elif not Path(file_path).is_absolute() and "research_images" in file_path:
                        # Already relative with research_images - use as-is
                        file_path = file_path.replace("\\", "/")
                    else:
                        file_path = f"research_images/{f.get('fileName', Path(file_path).name)}"
                except (ValueError, IndexError, TypeError):
                    file_path = f"research_images/{f.get('fileName', Path(file_path).name)}"

            payload_files.append({
                "fileId": f.get("fileId"),
                "fileName": f.get("fileName"),
                "filePath": file_path,
                "fileType": f.get("fileType"),
                "fileSize": f.get("fileSize"),
                "contentHash": f.get("contentHash"),
                "metadata": meta,
                "keywords": keywords
            })

        if not payload_files:
            return

        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json={"files": payload_files}, headers=headers)
            if resp.status_code >= 300:
                return
        except Exception:
            return


def _guess_ext(content_type: str, url: str) -> str:
    if content_type.startswith("image/"):
        ext = content_type.split("/", 1)[1].lower()
        if ext == "jpeg":
            ext = "jpg"
        if ext == "svg+xml":
            ext = "svg"
        if ext in IMAGE_EXTENSIONS:
            return ext
    try:
        path = urlparse(url).path
        ext = Path(path).suffix.lower().lstrip(".")
        if ext in IMAGE_EXTENSIONS:
            return ext
    except Exception:
        pass
    return "png"
