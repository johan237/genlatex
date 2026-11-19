"""
Vision-based image analysis helpers.
Uses OpenRouter vision models for captioning and OCR.
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI, OpenAI


DEFAULT_VISION_MODEL = "deepseek/deepseek-ocr"

_CLIENT: Optional[AsyncOpenAI] = None
_SYNC_CLIENT: Optional[OpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip()
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable not set")
    _CLIENT = AsyncOpenAI(base_url=base_url, api_key=api_key)
    return _CLIENT


def _get_sync_client() -> OpenAI:
    global _SYNC_CLIENT
    if _SYNC_CLIENT is not None:
        return _SYNC_CLIENT
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip()
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable not set")
    _SYNC_CLIENT = OpenAI(base_url=base_url, api_key=api_key)
    return _SYNC_CLIENT


def _get_model(env_name: str) -> str:
    val = os.getenv(env_name, "").strip()
    return val or DEFAULT_VISION_MODEL


def _strip_code_fences(text: str) -> str:
    if not text:
        return ""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _safe_parse_json(text: str) -> Dict[str, Any]:
    text = _strip_code_fences(text)
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try to recover a JSON object if the model wrapped extra text
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return {}
    return {}


def _to_data_url(image_bytes: bytes, mime: str) -> str:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


async def analyze_image_caption(
    image_bytes: bytes,
    mime: str,
    file_name: str = ""
) -> Dict[str, Any]:
    """Generate a structured caption + tags for an image."""
    model = _get_model("VISION_CAPTION_MODEL")
    client = _get_client()

    prompt = (
        "Analyze this image for use in an academic paper.\n"
        "Return ONLY valid JSON with keys:\n"
        "- caption: concise academic caption (1-2 sentences)\n"
        "- image_type: one of [figure, table, diagram, chart, photo, screenshot, equation, other]\n"
        "- tags: array of 5-12 short keywords\n"
        "- confidence: number 0-1\n"
    )
    if file_name:
        prompt = f"File name: {file_name}\n\n" + prompt

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": _to_data_url(image_bytes, mime)}},
                    ],
                }
            ],
            temperature=0,
            max_tokens=800,
        )
    except Exception:
        return {
            "caption": "",
            "image_type": "other",
            "tags": [],
            "confidence": 0.0,
        }

    content = (response.choices[0].message.content or "").strip()
    data = _safe_parse_json(content)
    if not isinstance(data, dict):
        data = {}
    caption = str(data.get("caption") or "").strip()
    image_type = str(data.get("image_type") or data.get("type") or "other").strip().lower()
    tags = data.get("tags") if isinstance(data.get("tags"), list) else []
    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "caption": caption,
        "image_type": image_type,
        "tags": [str(t).strip() for t in tags if str(t).strip()],
        "confidence": confidence,
    }


async def analyze_image_ocr(image_bytes: bytes, mime: str) -> str:
    """Extract text from an image using a vision OCR model."""
    model = _get_model("VISION_OCR_MODEL")
    client = _get_client()

    prompt = (
        "Extract all visible text from this image.\n"
        "Output ONLY the text, no JSON, no commentary.\n"
        "Preserve line breaks where possible."
    )

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": _to_data_url(image_bytes, mime)}},
                    ],
                }
            ],
            temperature=0,
            max_tokens=1200,
        )
    except Exception:
        return ""

    content = (response.choices[0].message.content or "").strip()
    return _strip_code_fences(content)


def analyze_image_caption_sync(
    image_bytes: bytes,
    mime: str,
    file_name: str = ""
) -> Dict[str, Any]:
    """Sync wrapper for caption generation (for non-async contexts)."""
    model = _get_model("VISION_CAPTION_MODEL")
    client = _get_sync_client()

    prompt = (
        "Analyze this image for use in an academic paper.\n"
        "Return ONLY valid JSON with keys:\n"
        "- caption: concise academic caption (1-2 sentences)\n"
        "- image_type: one of [figure, table, diagram, chart, photo, screenshot, equation, other]\n"
        "- tags: array of 5-12 short keywords\n"
        "- confidence: number 0-1\n"
    )
    if file_name:
        prompt = f"File name: {file_name}\n\n" + prompt

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": _to_data_url(image_bytes, mime)}},
                    ],
                }
            ],
            temperature=0,
            max_tokens=800,
        )
    except Exception:
        return {
            "caption": "",
            "image_type": "other",
            "tags": [],
            "confidence": 0.0,
        }

    content = (response.choices[0].message.content or "").strip()
    data = _safe_parse_json(content)
    if not isinstance(data, dict):
        data = {}
    caption = str(data.get("caption") or "").strip()
    image_type = str(data.get("image_type") or data.get("type") or "other").strip().lower()
    tags = data.get("tags") if isinstance(data.get("tags"), list) else []
    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "caption": caption,
        "image_type": image_type,
        "tags": [str(t).strip() for t in tags if str(t).strip()],
        "confidence": confidence,
    }


def analyze_image_ocr_sync(image_bytes: bytes, mime: str) -> str:
    """Sync wrapper for OCR (for non-async contexts)."""
    model = _get_model("VISION_OCR_MODEL")
    client = _get_sync_client()

    prompt = (
        "Extract all visible text from this image.\n"
        "Output ONLY the text, no JSON, no commentary.\n"
        "Preserve line breaks where possible."
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": _to_data_url(image_bytes, mime)}},
                    ],
                }
            ],
            temperature=0,
            max_tokens=1200,
        )
    except Exception:
        return ""

    content = (response.choices[0].message.content or "").strip()
    return _strip_code_fences(content)


async def analyze_caption_from_text(text: str, file_name: str = "") -> Dict[str, Any]:
    """Generate a caption from text-only image content (e.g., SVG text)."""
    if not text:
        return {
            "caption": "",
            "image_type": "other",
            "tags": [],
            "confidence": 0.0,
        }
    model = _get_model("VISION_CAPTION_MODEL")
    client = _get_client()

    prompt = (
        "You are given extracted text and metadata from a vector graphic.\n"
        "Return ONLY valid JSON with keys:\n"
        "- caption: concise academic caption (1-2 sentences)\n"
        "- image_type: one of [figure, table, diagram, chart, photo, screenshot, equation, other]\n"
        "- tags: array of 5-12 short keywords\n"
        "- confidence: number 0-1\n"
        "Text content:\n"
    )
    if file_name:
        prompt = f"File name: {file_name}\n\n" + prompt
    prompt += text[:4000]

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0,
            max_tokens=500,
        )
    except Exception:
        return {
            "caption": "",
            "image_type": "other",
            "tags": [],
            "confidence": 0.0,
        }

    content = (response.choices[0].message.content or "").strip()
    data = _safe_parse_json(content)
    if not isinstance(data, dict):
        data = {}
    caption = str(data.get("caption") or "").strip()
    image_type = str(data.get("image_type") or data.get("type") or "other").strip().lower()
    tags = data.get("tags") if isinstance(data.get("tags"), list) else []
    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "caption": caption,
        "image_type": image_type,
        "tags": [str(t).strip() for t in tags if str(t).strip()],
        "confidence": confidence,
    }


def analyze_caption_from_text_sync(text: str, file_name: str = "") -> Dict[str, Any]:
    """Sync wrapper for captioning when only text is available."""
    if not text:
        return {
            "caption": "",
            "image_type": "other",
            "tags": [],
            "confidence": 0.0,
        }
    model = _get_model("VISION_CAPTION_MODEL")
    client = _get_sync_client()

    prompt = (
        "You are given extracted text and metadata from a vector graphic.\n"
        "Return ONLY valid JSON with keys:\n"
        "- caption: concise academic caption (1-2 sentences)\n"
        "- image_type: one of [figure, table, diagram, chart, photo, screenshot, equation, other]\n"
        "- tags: array of 5-12 short keywords\n"
        "- confidence: number 0-1\n"
        "Text content:\n"
    )
    if file_name:
        prompt = f"File name: {file_name}\n\n" + prompt
    prompt += text[:4000]

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=500,
        )
    except Exception:
        return {
            "caption": "",
            "image_type": "other",
            "tags": [],
            "confidence": 0.0,
        }

    content = (response.choices[0].message.content or "").strip()
    data = _safe_parse_json(content)
    if not isinstance(data, dict):
        data = {}
    caption = str(data.get("caption") or "").strip()
    image_type = str(data.get("image_type") or data.get("type") or "other").strip().lower()
    tags = data.get("tags") if isinstance(data.get("tags"), list) else []
    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "caption": caption,
        "image_type": image_type,
        "tags": [str(t).strip() for t in tags if str(t).strip()],
        "confidence": confidence,
    }


def build_image_extracted_text(caption: str, ocr_text: str) -> str:
    parts: List[str] = []
    if caption:
        parts.append(f"Caption: {caption}")
    if ocr_text:
        parts.append("OCR Text:")
        parts.append(ocr_text)
    return "\n".join(parts).strip()
