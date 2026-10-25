"""`POST /api/layout-specs/dry-run`: parses a real statement against a real spec, writing
nothing to the database (§2c's "try before you save")."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

_FIXTURE_PDF = (
    Path(__file__).resolve().parent.parent
    / "fixtures"
    / "generated"
    / "layout_b_credit"
    / "layout_b_credit_normal.pdf"
)

#: The same hand-written, schema-valid spec `tests/ingest/test_spec_layout_b.py` proves
#: reproduces Layout B's own golden exactly.
_SPEC_YAML = (
    Path(__file__).resolve().parent.parent / "ingest" / "specs" / "layout_b.yaml"
).read_text()

_INVALID_SPEC_YAML = "rows: []"


def _upload(client: TestClient) -> int:
    user = client.post("/api/users", json={"name": "Alex"}).json()
    with _FIXTURE_PDF.open("rb") as fh:
        upload = client.post(
            "/api/statements",
            files={"file": ("layout_b_credit_normal.pdf", fh, "application/pdf")},
            data={"user_id": str(user["id"])},
        )
    assert upload.status_code == 201, upload.text
    return int(upload.json()["statement"]["id"])


def test_dry_run_parses_without_persisting(client: TestClient) -> None:
    statement_id = _upload(client)

    response = client.post(
        "/api/layout-specs/dry-run",
        json={"statement_id": statement_id, "spec_yaml": _SPEC_YAML},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["txn_count"] == 6
    assert body["currency"] == "USD"
    assert len(body["sample_rows"]) == 6
    assert all(
        {"description_clean", "posted_date", "amount_minor"} <= row.keys()
        for row in body["sample_rows"]
    )
    # A dry run never touches the database: still exactly the one, still-awaiting statement.
    statement = client.get(f"/api/statements/{statement_id}").json()
    assert statement["status"] == "awaiting_extractor"
    assert statement["txn_count"] is None


def test_dry_run_rejects_an_invalid_spec(client: TestClient) -> None:
    statement_id = _upload(client)

    response = client.post(
        "/api/layout-specs/dry-run",
        json={"statement_id": statement_id, "spec_yaml": _INVALID_SPEC_YAML},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["errors"]


def test_dry_run_missing_statement_is_404(client: TestClient) -> None:
    response = client.post(
        "/api/layout-specs/dry-run",
        json={"statement_id": 999999, "spec_yaml": _SPEC_YAML},
    )
    assert response.status_code == 404
