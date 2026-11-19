"""
Shared in-memory state for document generation with asyncio lock for thread-safe access.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from api.models import PaperGenerationResponse, PaperStatus

active_documents: Dict[str, PaperGenerationResponse] = {}
# Backward compatibility alias
active_papers = active_documents
_active_papers_lock = asyncio.Lock()


async def get_paper(paper_id: str) -> Optional[PaperGenerationResponse]:
    """Get paper by id under lock. Returns None if not found."""
    async with _active_papers_lock:
        return active_documents.get(paper_id)


async def set_paper(paper_id: str, paper: PaperGenerationResponse) -> None:
    """Store paper under lock."""
    async with _active_papers_lock:
        active_documents[paper_id] = paper


async def pop_paper(paper_id: str) -> Optional[PaperGenerationResponse]:
    """Remove and return paper by id under lock. Returns None if not found."""
    async with _active_papers_lock:
        return active_documents.pop(paper_id, None)


async def contains_paper(paper_id: str) -> bool:
    """Check if paper exists under lock."""
    async with _active_papers_lock:
        return paper_id in active_documents


async def list_papers() -> List[PaperGenerationResponse]:
    """Return list of all paper values under lock (copy)."""
    async with _active_papers_lock:
        return list(active_documents.values())


async def list_paper_ids_and_values() -> List[Tuple[str, PaperGenerationResponse]]:
    """Return list of (paper_id, paper) under lock (references, not copy of values)."""
    async with _active_papers_lock:
        return list(active_documents.items())


async def cleanup_old_papers(retention_sec: float) -> int:
    """Remove completed/failed papers older than retention_sec. Returns count removed."""
    now = datetime.now()
    to_remove = []
    async with _active_papers_lock:
        for paper_id, paper in active_documents.items():
            if paper.status not in (PaperStatus.COMPLETED, PaperStatus.FAILED):
                continue
            delta = (now - paper.updated_at).total_seconds()
            if delta > retention_sec:
                to_remove.append(paper_id)
        for paper_id in to_remove:
            active_documents.pop(paper_id, None)
    return len(to_remove)


async def evict_oldest_completed_if_over(max_size: int) -> None:
    """If len(active_papers) >= max_size, evict oldest completed/failed by updated_at until under cap."""
    async with _active_papers_lock:
        while len(active_documents) >= max_size:
            completed = [
                (paper_id, paper)
                for paper_id, paper in active_documents.items()
                if paper.status in (PaperStatus.COMPLETED, PaperStatus.FAILED)
            ]
            if not completed:
                break
            completed.sort(key=lambda x: x[1].updated_at)
            paper_id = completed[0][0]
            active_documents.pop(paper_id, None)


async def get_document(document_id: str) -> Optional[PaperGenerationResponse]:
    return await get_paper(document_id)


async def set_document(document_id: str, document: PaperGenerationResponse) -> None:
    await set_paper(document_id, document)


async def pop_document(document_id: str) -> Optional[PaperGenerationResponse]:
    return await pop_paper(document_id)


async def contains_document(document_id: str) -> bool:
    return await contains_paper(document_id)


async def list_documents() -> List[PaperGenerationResponse]:
    return await list_papers()
