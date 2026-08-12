"""Shared AI model caller — the connected opencode-go model
(deepseek-v4-flash via OPENCODE_GO_API_KEY / BASE_URL / MODEL env).

Single implementation so the summary router and the entry-plan narration
use identical wiring. Never raises: returns None when unconfigured,
unreachable, or the model errors — callers fall back to deterministic text.
"""

from __future__ import annotations

import os

import requests

BASE_URL = os.getenv("OPENCODE_GO_BASE_URL", "https://opencode.ai/zen/go/v1")
MODEL = os.getenv("OPENCODE_GO_MODEL", "deepseek-v4-flash")
API_KEY = os.getenv("OPENCODE_GO_API_KEY", "")


def call_model(system: str | None, prompt: str, max_tokens: int = 400) -> str | None:
    """One chat completion; returns the model text or None on any failure."""
    if not API_KEY:
        return None
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        resp = requests.post(
            f"{BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": max_tokens,
            },
            timeout=45,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:  # noqa: BLE001
        print(f"[ai] model call failed ({MODEL}): {e}")
        return None
