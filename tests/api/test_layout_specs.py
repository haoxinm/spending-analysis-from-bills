from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_revise_approve_export_layout_spec(client: TestClient) -> None:
    created = client.post(
        "/api/layout-specs", json={"name": "BofA credit", "spec_yaml": "rows: []"}
    )
    assert created.status_code == 201
    spec = created.json()
    assert spec["version"] == 1
    assert spec["approved"] is False

    revised = client.post(
        f"/api/layout-specs/{spec['id']}/revise",
        json={"name": "BofA credit", "spec_yaml": "rows: [1]"},
    )
    assert revised.status_code == 201
    assert revised.json()["version"] == 2

    approved = client.post(f"/api/layout-specs/{spec['id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["approved"] is True

    exported = client.get(f"/api/layout-specs/{spec['id']}/export")
    assert exported.status_code == 200
    assert exported.text == "rows: []"

    listing = client.get("/api/layout-specs")
    assert len(listing.json()) == 2


def test_missing_layout_spec_is_404(client) -> None:  # type: ignore[no-untyped-def]
    assert (
        client.post(
            "/api/layout-specs/999999/revise", json={"name": "x", "spec_yaml": "y"}
        ).status_code
        == 404
    )
    assert client.post("/api/layout-specs/999999/approve").status_code == 404
    assert client.get("/api/layout-specs/999999/export").status_code == 404
