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

from dataclasses import dataclass
from pathlib import Path

import pdfplumber

from spend_analyzer.core.errors import SpendAnalyzerError
from spend_analyzer.core.types import Word
from spend_analyzer.ingest.extract import extract


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
