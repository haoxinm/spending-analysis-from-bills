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


def test_create_list_update_delete_issuer(client: TestClient) -> None:
    created = client.post(
        "/api/issuers", json={"name": "Bank of Example", "match_terms": ["Bank of Example"]}
    )
    assert created.status_code == 201
    issuer = created.json()
    assert issuer["match_terms"] == ["Bank of Example"]

    listing = client.get("/api/issuers")
    assert any(i["id"] == issuer["id"] for i in listing.json())

    updated = client.patch(f"/api/issuers/{issuer['id']}", json={"name": "BoE"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "BoE"

    deleted = client.delete(f"/api/issuers/{issuer['id']}")
    assert deleted.status_code == 204


def test_preview_match_finds_and_excludes_statements(client: TestClient) -> None:
    user = client.post("/api/users", json={"name": "Alex"}).json()
    with _FIXTURE_PDF.open("rb") as fh:
        upload = client.post(
            "/api/statements",
            files={"file": ("layout_b_credit_normal.pdf", fh, "application/pdf")},
            data={"user_id": str(user["id"])},
        )
    assert upload.status_code == 201, upload.text
    statement_id = upload.json()["statement"]["id"]

    matching = client.post(
        "/api/issuers/preview-match", json={"match_terms": ["CASCADE TRUST BANK"]}
    )
    assert matching.status_code == 200, matching.text
    matched_ids = [row["statement_id"] for row in matching.json()]
    assert statement_id in matched_ids
    assert "page" not in str(matching.json()).lower()  # no page text ever comes back

    non_matching = client.post(
        "/api/issuers/preview-match", json={"match_terms": ["Some Other Bank Entirely"]}
    )
    assert non_matching.status_code == 200
    assert statement_id not in [row["statement_id"] for row in non_matching.json()]


def test_preview_match_with_no_terms_returns_empty(client: TestClient) -> None:
    response = client.post("/api/issuers/preview-match", json={"match_terms": []})
    assert response.status_code == 200
    assert response.json() == []
