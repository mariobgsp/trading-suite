"""Shared AI model caller — DISABLED.

AI section has been dismantled per user request (2026-08). This module
remains as a no-op stub so existing imports (`from app.ai import call_model`)
do not break, but it never performs a network call and returns None
immediately. Fallback deterministic text in callers is used instead.
"""

from __future__ import annotations

BASE_URL = ""
MODEL = "disabled"
API_KEY = ""


def call_model(system: str | None, prompt: str, max_tokens: int = 400) -> str | None:  # noqa: ARG001
    """AI disabled — always returns None instantly (no network, no wait)."""
    return None
