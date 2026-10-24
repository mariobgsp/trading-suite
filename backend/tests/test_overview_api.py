"""The overview HTTP seam returns cache/status states without blocking."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.main import app
from app.routers import overview as router_mod


def test_overview_paths_are_mounted():
    paths = app.openapi()["paths"]
    assert "/api/overview" in paths
    assert "/api/overview/status" in paths
    assert "/api/overview/refresh" in paths
    assert "/api/overview/cache" in paths


def test_latest_serialises_the_building_state():
    payload = {"state": "building", "session": "2026-10-23", "status": {}, "snapshot": None}
    with patch.object(router_mod.overview, "latest", return_value=(payload, 202)):
        response = asyncio.run(router_mod.latest())
    assert response.status_code == 202
    body = json.loads(response.body)
    assert body["state"] == "building"


def test_latest_serialises_a_snapshot():
    payload = {"as_of": "2026-10-23", "market": {}, "gauge": {}}
    with patch.object(router_mod.overview, "latest", return_value=(payload, 200)):
        response = asyncio.run(router_mod.latest())
    assert response.status_code == 200
    assert json.loads(response.body)["as_of"] == "2026-10-23"


def test_status_and_refresh_delegate():
    with patch.object(router_mod.overview, "status", return_value={"state": "done"}):
        assert asyncio.run(router_mod.status()) == {"state": "done"}
    with patch.object(router_mod.overview, "refresh", return_value={"state": "running"}):
        assert asyncio.run(router_mod.refresh()) == {"state": "running"}


def test_archive_maps_missing_snapshot_to_404():
    with patch.object(router_mod.overview, "archive", return_value=None):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(router_mod.archive("2026-10-01"))
    assert caught.value.status_code == 404
