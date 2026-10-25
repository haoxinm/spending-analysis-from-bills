"""`GET /api/statements/{id}/preview`: page words + page size for the Layout mapper's
click-to-map UI (§2c). Local-only — never egresses anything."""

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


def test_preview_returns_words_and_page_size(client: TestClient) -> None:
    statement_id = _upload(client)

    response = client.get(f"/api/statements/{statement_id}/preview", params={"page": 1})
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["page_number"] == 1
    assert body["width"] > 0
    assert body["height"] > 0
    assert body["words"]
    word = body["words"][0]
    assert {"text", "x0", "x1", "top", "bottom"} <= word.keys()
    assert any(w["text"] == "CASCADE" for w in body["words"])


def test_preview_defaults_to_page_one(client: TestClient) -> None:
    statement_id = _upload(client)
    response = client.get(f"/api/statements/{statement_id}/preview")
    assert response.status_code == 200
    assert response.json()["page_number"] == 1


def test_preview_out_of_range_page_is_404(client: TestClient) -> None:
    statement_id = _upload(client)
    response = client.get(f"/api/statements/{statement_id}/preview", params={"page": 999})
    assert response.status_code == 404


def test_preview_missing_statement_is_404(client: TestClient) -> None:
    response = client.get("/api/statements/999999/preview")
    assert response.status_code == 404
