"""
SVG helpers for text extraction and rasterization.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple
from xml.etree import ElementTree


def extract_svg_text(svg_bytes: bytes) -> str:
    """Extract text content from SVG elements (text, tspan, title, desc)."""
    if not svg_bytes:
        return ""
    try:
        root = ElementTree.fromstring(svg_bytes)
    except ElementTree.ParseError:
        return ""

    texts = []
    for elem in root.iter():
        tag = _strip_ns(elem.tag)
        if tag in ("text", "tspan", "title", "desc"):
            if elem.text and elem.text.strip():
                texts.append(elem.text.strip())
        # Some SVGs store text in aria-label or title attributes
        aria = elem.attrib.get("aria-label") or elem.attrib.get("title")
        if aria and aria.strip():
            texts.append(aria.strip())

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for t in texts:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    return "\n".join(unique).strip()


def get_svg_dimensions(svg_bytes: bytes) -> Tuple[Optional[int], Optional[int]]:
    """Parse width/height from SVG (returns pixels when possible)."""
    if not svg_bytes:
        return None, None
    try:
        root = ElementTree.fromstring(svg_bytes)
    except ElementTree.ParseError:
        return None, None

    width = _parse_svg_length(root.attrib.get("width"))
    height = _parse_svg_length(root.attrib.get("height"))
    if width and height:
        return width, height

    view_box = root.attrib.get("viewBox") or root.attrib.get("viewbox")
    if view_box:
        parts = re.split(r"[ ,]+", view_box.strip())
        if len(parts) == 4:
            try:
                vb_width = float(parts[2])
                vb_height = float(parts[3])
                return int(vb_width), int(vb_height)
            except ValueError:
                return width, height
    return width, height


def rasterize_svg_to_png(svg_bytes: bytes, output_width: Optional[int] = None) -> Optional[bytes]:
    """Rasterize SVG bytes to PNG bytes using cairosvg if available."""
    if not svg_bytes:
        return None
    try:
        import cairosvg
    except Exception:
        return None

    try:
        return cairosvg.svg2png(bytestring=svg_bytes, output_width=output_width)
    except Exception:
        return None


def _strip_ns(tag: str) -> str:
    if not tag:
        return ""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _parse_svg_length(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        match = re.match(r"^\s*([0-9.]+)", value)
        if not match:
            return None
        return int(float(match.group(1)))
    except (ValueError, TypeError):
        return None
