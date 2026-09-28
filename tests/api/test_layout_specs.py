from __future__ import annotations

from fastapi.testclient import TestClient

#: A real, schema-valid spec (mirrors `tests/ingest/specs/layout_b.yaml`) — every spec this
#: router persists is validated through `ingest.layout_spec.load_spec` before being saved.
_VALID_SPEC_YAML = """
id: api_test_layout
version: 1
account_type: credit
currency: USD
detect:
  all_of: ["ACCOUNT ACTIVITY"]
  score: 0.85
columns:
  - {name: posted_date, x0: 45, x1: 165, type: date, formats: ["%m/%d"]}
  - {name: description, x0: 165, x1: 420, type: text}
  - {name: amount, x0: 420, x1: 495, type: money}
sections:
  mode: heading
  patterns:
    - {match: "PURCHASES", outflow_kind_hint: purchase, inflow_kind_hint: adjustment}
sign: {outflow: unsigned, inflow: leading_minus}
year_inference: from_period
totals: {section_totals: false}
"""

_INVALID_SPEC_YAML = "rows: []"


def test_create_revise_approve_export_layout_spec(client: TestClient) -> None:
    created = client.post(
        "/api/layout-specs", json={"name": "BofA credit", "spec_yaml": _VALID_SPEC_YAML}
    )
    assert created.status_code == 201, created.text
    spec = created.json()
    assert spec["version"] == 1
    assert spec["approved"] is False

    revised_yaml = _VALID_SPEC_YAML.replace("score: 0.85", "score: 0.9")
    revised = client.post(
        f"/api/layout-specs/{spec['id']}/revise",
        json={"name": "BofA credit", "spec_yaml": revised_yaml},
    )
    assert revised.status_code == 201, revised.text
    assert revised.json()["version"] == 2

    approved = client.post(f"/api/layout-specs/{spec['id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["approved"] is True

    exported = client.get(f"/api/layout-specs/{spec['id']}/export")
    assert exported.status_code == 200
    assert exported.text == _VALID_SPEC_YAML

    listing = client.get("/api/layout-specs")
    assert len(listing.json()) == 2


def test_create_rejects_an_invalid_spec_with_field_errors(client: TestClient) -> None:
    response = client.post(
        "/api/layout-specs", json={"name": "Bad spec", "spec_yaml": _INVALID_SPEC_YAML}
    )
    assert response.status_code == 422
    body = response.json()["detail"]
    assert body["errors"]  # at least one field-level error came back
    assert all("field" in e and "message" in e for e in body["errors"])


def test_revise_rejects_an_invalid_spec(client: TestClient) -> None:
    created = client.post(
        "/api/layout-specs", json={"name": "BofA credit", "spec_yaml": _VALID_SPEC_YAML}
    )
    spec_id = created.json()["id"]

    response = client.post(
        f"/api/layout-specs/{spec_id}/revise",
        json={"name": "BofA credit", "spec_yaml": _INVALID_SPEC_YAML},
    )
    assert response.status_code == 422
    # The invalid revision was never persisted: the spec is still at version 1.
    listing = client.get("/api/layout-specs").json()
    assert [s["version"] for s in listing if s["id"] == spec_id] == [1]


def test_missing_layout_spec_is_404(client) -> None:  # type: ignore[no-untyped-def]
    assert (
        client.post(
            "/api/layout-specs/999999/revise", json={"name": "x", "spec_yaml": "y"}
        ).status_code
        == 404
    )
    assert client.post("/api/layout-specs/999999/approve").status_code == 404
    assert client.get("/api/layout-specs/999999/export").status_code == 404
