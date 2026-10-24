"""The HTTP seam is thin, typed and fails with a status rather than a stack trace."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.main import app
from app.routers import flow as flow_router


def test_flow_paths_are_mounted():
    paths = app.openapi()["paths"]
    assert "/api/flow/health" in paths
    assert "/api/flow/cards" in paths
    assert "/api/flow/{ticker}" in paths
    assert "/api/flow/validate" in paths
    assert "/api/flow/cache" in paths
    assert "/api/flow/cache/clear" in paths


def test_cards_delegates_to_the_module():
    expected = {"available": True, "count": 0, "cards": []}
    with patch.object(flow_router.flow, "cards", return_value=expected) as called:
        result = asyncio.run(flow_router.cards("tickers", "AAA", 1, "auto", 60, False))
    assert result == expected
    called.assert_called_once_with("tickers", "AAA", 1, "auto", 60, False)


def test_detail_maps_missing_data_to_404():
    with patch.object(flow_router.flow, "series", side_effect=LookupError("no data")):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(flow_router.detail("NOPE", 60, "auto"))
    assert caught.value.status_code == 404


def test_validate_maps_no_data_to_404():
    with patch.object(
        flow_router.flow,
        "validate",
        return_value={"available": False, "error": "no evaluable observations"},
    ):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(flow_router.validate_one("NOPE", 5, 250, "auto"))
    assert caught.value.status_code == 404
