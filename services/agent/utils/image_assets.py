"""
Helpers for image asset naming and filtering.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

IMAGE_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "svg"
}


def is_image_type(file_type: Optional[str]) -> bool:
    if not file_type:
        return False
    return file_type.lower().lstrip(".") in IMAGE_EXTENSIONS


def _safe_id(value: str) -> str:
    value = value or "image"
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", value)
    return safe.strip("_") or "image"


def build_output_name(
    file_id: str,
    file_path: Optional[str] = None,
    file_type: Optional[str] = None
) -> str:
    safe_id = _safe_id(file_id)
    ext = ""
    if file_path:
        ext = Path(file_path).suffix.lower().lstrip(".")
    if not ext and file_type:
        ext = file_type.lower().lstrip(".")
    if not ext:
        ext = "png"
    if ext == "svg":
        ext = "png"
    if ext not in IMAGE_EXTENSIONS:
        ext = "png"
    return f"{safe_id}.{ext}"


def build_latex_path(output_name: str) -> str:
    return f"images/{output_name}"


def collect_image_candidates(research_files: List[Dict]) -> List[Dict]:
    images = []
    for f in research_files or []:
        meta = f.get("metadata") or {}
        if isinstance(meta, str):
            try:
                import json
                meta = json.loads(meta)
            except Exception:
                meta = {}
        if isinstance(meta, dict):
            flag = meta.get("isChunk")
            if flag is None:
                flag = meta.get("is_chunk")
            if flag is True or (isinstance(flag, str) and flag.lower() == "true"):
                continue
        file_type = (f.get("fileType") or f.get("file_type") or "").lower().lstrip(".")
        if not is_image_type(file_type):
            continue
        file_id = f.get("fileId") or f.get("file_id") or f.get("fileName") or "image"
        file_path = f.get("filePath") or f.get("file_path") or ""
        output_name = build_output_name(file_id, file_path=file_path, file_type=file_type)
        images.append({
            "fileId": file_id,
            "fileName": f.get("fileName") or f.get("file_name") or output_name,
            "filePath": file_path,
            "fileType": file_type,
            "outputName": output_name,
            "latexPath": build_latex_path(output_name),
            "metadata": f.get("metadata") or {},
        })
    return images
