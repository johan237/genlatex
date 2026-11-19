"""
Document planning agent wrapper.

This module provides document-first naming for the planning stage.
"""

from agents.planner import PaperPlanner


class DocumentPlanner(PaperPlanner):
    """Planner specialized for general LaTeX document generation."""

