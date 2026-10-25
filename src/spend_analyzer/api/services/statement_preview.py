"""Statement page preview for the Layout mapper's click-to-map UI (§2c, local-only).

Reads page geometry (each word's `text`/`x0`/`x1`/`top`/`bottom`, plus the page's own size)
straight from a statement's staged PDF. `ingest.extract.extract` already reads word boxes but
not page dimensions, so this module opens the PDF a second time with `pdfplumber` (already a
frozen dependency, §0.3) just for `page.width`/`page.height`.

Stays on the localhost token API and never touches egress: this never imports anything from
`classify/llm/`, and the router this feeds returns geometry only, never a description string
that could be mistaken for something safe to send anywhere (I1b/I3).
"""

from __future__ import annotations

import contextlib
import json
import threading
from dataclasses import dataclass
from pathlib import Path

import pdfplumber
from sqlalchemy.orm import Session

from spend_analyzer.config import Settings
from spend_analyzer.core.errors import SpendAnalyzerError
from spend_analyzer.core.types import Word
from spend_analyzer.db.models import User
from spend_analyzer.ingest.extract import extract

#: pdfium (behind `pdfplumber.Page.to_image`, via `pypdfium2`) is not thread-safe: the Import
#: screen requests every page thumbnail at once and FastAPI serves them from its threadpool, and
#: concurrent renders segfault the whole server process. Serialise every render behind this lock.
_PDFIUM_LOCK = threading.Lock()


class PagePreviewNotFound(SpendAnalyzerError):
    """The requested page does not exist in this statement's PDF."""


@dataclass(frozen=True)
class PagePreview:
    page_number: int
    width: float
    height: float
    words: tuple[Word, ...]


def preview_page(pdf_path: Path, page_number: int) -> PagePreview:
    """Return `page_number`'s (1-based) words and page size from `pdf_path`.

    Raises:
        PagePreviewNotFound: `page_number` is out of range for this PDF.
    """
    doc = extract(pdf_path)
    page = next((p for p in doc.pages if p.page_number == page_number), None)
    if page is None:
        raise PagePreviewNotFound(
            f"page {page_number} does not exist (this statement has {doc.page_count} page(s))"
        )
    with pdfplumber.open(pdf_path) as pdf:
        if page_number < 1 or page_number > len(pdf.pages):
            raise PagePreviewNotFound(
                f"page {page_number} does not exist (this statement has {len(pdf.pages)} page(s))"
            )
        plumber_page = pdf.pages[page_number - 1]
        width, height = float(plumber_page.width), float(plumber_page.height)
    return PagePreview(page_number=page_number, width=width, height=height, words=page.words)


def page_infos(pdf_path: Path, selected: list[int] | None) -> list[tuple[int, int, str, bool]]:
    """``(page_number, char_count, snippet, selected)`` per page; ``selected=None`` = all."""
    doc = extract(pdf_path)
    chosen = set(selected) if selected else None
    return [
        (
            p.page_number,
            p.char_count,
            " ".join(p.text.split())[:300],
            chosen is None or p.page_number in chosen,
        )
        for p in doc.pages
    ]


def render_page_png(pdf_path: Path, page_number: int, width: int) -> bytes:
    """A PNG thumbnail of ``page_number`` (1-based), ``width`` pixels wide.

    Raises:
        PagePreviewNotFound: ``page_number`` is out of range.
    """
    import io

    with _PDFIUM_LOCK, pdfplumber.open(pdf_path) as pdf:
        if page_number < 1 or page_number > len(pdf.pages):
            raise PagePreviewNotFound(
                f"page {page_number} does not exist (this statement has {len(pdf.pages)} page(s))"
            )
        image = pdf.pages[page_number - 1].to_image(width=width)
        buffer = io.BytesIO()
        image.original.save(buffer, format="PNG")
        return buffer.getvalue()


def llm_pii_terms(session: Session, settings: Settings, user_id: int | None) -> tuple[str, ...]:
    """The redaction terms the LLM statement parser uses: `[privacy] pii_terms` plus the
    statement user's `pii_aliases` (mirrors `ingest.pipeline._resolve_parser`)."""
    terms: set[str] = set(settings.privacy.pii_terms)
    user = session.get(User, user_id) if user_id is not None else None
    if user is not None:
        with contextlib.suppress(json.JSONDecodeError, TypeError):
            terms.update(json.loads(user.pii_aliases))
    return tuple(sorted(terms))
