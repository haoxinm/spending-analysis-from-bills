"""Income and tax aggregation over the `tax_*` tables (plan 4b).

**All tax SQL lives here.** Routers and the CLI call `run_tax_summary` / `list_tax_years` /
`list_tax_documents` / `get_tax_document` / `run_income_by_payer`; none builds its own query.
Every user-supplied value (user ids, tax years, currency) is validated and then bound as a
parameter. There is no caller-chosen identifier (no group-by input), so nothing needs an allow-list.

Units and signs (D6): all amounts are integer minor units (cents), USD only. Income is the amount
as received (a net capital loss is negative); tax amounts are non-negative magnitudes.

**Source vs return (D4).** W-2 / 1099 forms (role ``source``) and the 1040 (role ``return``)
describe the same income, so they are never added together. Per (user, tax year):

- income and withholding/FICA come from the source forms; if the year has *no* source forms they
  fall back to the return's line items and ``income_basis`` is ``"return"`` (with a warning);
- liability, payments and refund/owed come from the return only;
- when both exist, W-2 wages (sum of ``salary_wages`` on source forms) are compared with the
  return's wages and a warning is emitted if they differ by more than $1. Neither is silently
  preferred: income stays on the source basis.

**Memo items (D5).** ``qualified_dividends`` and any item stored with ``is_memo`` are excluded from
``total_income_minor``. ``qualified_dividends`` is still listed in ``income_by_category`` (flagged
via ``memo_by_category``); other memo items (e.g. tax-exempt interest) appear only in
``memo_by_category["tax_exempt"]``.

**Rates** (rounded to 4 dp, ``None`` when the denominator ``total_income_minor`` is <= 0 or the
numerator is unavailable):

- ``federal_effective_rate`` = ``total_federal_tax`` (return) / total income;
- ``withholding_rate`` = federal income tax withheld (sources) / total income;
- ``all_in_rate`` = (federal tax [return's total tax if present, else federal withheld]
  + state tax [state liability if present, else state withheld] + local withheld
  + Social Security + Medicare) / total income.

**Refund / owed.** Taken from the return when printed. If the return prints neither but has
``total_payments`` and ``total_federal_tax``, they are derived as the difference and
``refund_or_owed_derived`` is True.

**Aggregation.** With ``TaxQuery.per_user=False`` (default) users are first resolved independently
(so one user's basis never leaks into another's) and then summed; ``user_id`` is None and the
basis is ``"mixed"`` if the users disagree. With ``per_user=True`` there is one row per
(tax year, user).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session, selectinload

from spend_analyzer.core.tax_types import (
    INCOME_CATEGORIES,
    MEMO_INCOME_CATEGORIES,
    TAX_GROUPS,
    IncomeCategory,
    TaxCategory,
)
from spend_analyzer.db.models import IncomeItem, TaxDocument, TaxForm, TaxItem

IncomeBasis = Literal["source_documents", "return", "none", "mixed"]

_MIN_YEAR = 1990
_MAX_YEAR = 2100
#: Wages on sources vs return differing by more than $1 raise a reconciliation warning.
_RECONCILE_TOLERANCE_MINOR = 100
#: Key in `memo_by_category` for memo items that are not `qualified_dividends` (tax-exempt interest).
TAX_EXEMPT_MEMO_KEY = "tax_exempt"

_WITHHELD: tuple[TaxCategory, ...] = TAX_GROUPS["withholding"]
_FICA: tuple[TaxCategory, ...] = TAX_GROUPS["fica"]
_LIABILITY: tuple[TaxCategory, ...] = TAX_GROUPS["liability"]
_ESTIMATE_CATEGORIES: frozenset[str] = frozenset(
    {"federal_tax_ordinary_est", "federal_tax_preferential_est"}
)


@dataclass(frozen=True, slots=True)
class TaxQuery:
    """A request for tax-year summaries. ``None`` filters mean "no filter"."""

    user_ids: list[int] | None = None
    tax_years: list[int] | None = None
    currency: str = "USD"
    per_user: bool = False


@dataclass(frozen=True, slots=True)
class TaxYearSummary:
    """One tax year (for one user, or all selected users). See the module docstring for rules."""

    tax_year: int
    user_id: int | None
    income_basis: IncomeBasis
    income_by_category: dict[IncomeCategory, int]
    memo_by_category: dict[str, int]
    total_income_minor: int
    withheld: dict[TaxCategory, int]
    fica: dict[TaxCategory, int]
    liability: dict[TaxCategory, int]
    payments_minor: int | None
    refund_minor: int | None
    amount_owed_minor: int | None
    refund_or_owed_derived: bool
    federal_effective_rate: float | None
    all_in_rate: float | None
    withholding_rate: float | None
    document_count: int
    form_count: int
    warnings: list[str]


@dataclass(frozen=True, slots=True)
class IncomePayerRow:
    """Income from one payer on source forms (non-memo). ``payer_name`` is LOCAL ONLY."""

    tax_year: int
    user_id: int
    payer_name: str | None
    form_type: str
    category: IncomeCategory
    amount_minor: int


def _validate(query: TaxQuery) -> None:
    if query.currency != "USD":
        raise ValueError(f"unsupported currency: {query.currency!r} (only USD is supported)")
    for year in query.tax_years or []:
        if (
            isinstance(year, bool)
            or not isinstance(year, int)
            or not (_MIN_YEAR <= year <= _MAX_YEAR)
        ):
            raise ValueError(f"invalid tax year: {year!r}")
    for uid in query.user_ids or []:
        if isinstance(uid, bool) or not isinstance(uid, int):
            raise ValueError(f"invalid user id: {uid!r}")


@dataclass
class _Resolved:
    """Per-(user, year) resolved figures, summable across users."""

    basis: IncomeBasis = "none"
    income: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    memo: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    withheld: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    fica: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    liability: dict[str, int] = field(default_factory=dict)
    payments: int | None = None
    refund: int | None = None
    owed: int | None = None
    derived: bool = False
    documents: int = 0
    forms: int = 0
    warnings: list[str] = field(default_factory=list)


def _filters(model: type[IncomeItem] | type[TaxItem], query: TaxQuery) -> list[ColumnElement[bool]]:
    """Currency / user / year filters (all bound parameters) for an item table."""
    conds: list[ColumnElement[bool]] = [model.currency == query.currency]
    if query.user_ids is not None:
        conds.append(model.user_id.in_(query.user_ids))
    if query.tax_years is not None:
        conds.append(model.tax_year.in_(query.tax_years))
    return conds


def _fmt(minor: int) -> str:
    sign = "-" if minor < 0 else ""
    return f"{sign}${abs(minor) // 100:,}.{abs(minor) % 100:02d}"


def _income_rows(session: Session, query: TaxQuery) -> list[Any]:
    stmt = (
        select(
            IncomeItem.user_id,
            IncomeItem.tax_year,
            TaxForm.role,
            TaxForm.form_type,
            IncomeItem.category,
            IncomeItem.is_memo,
            func.sum(IncomeItem.amount_minor),
        )
        .join(TaxForm, TaxForm.id == IncomeItem.form_id)
        .group_by(
            IncomeItem.user_id,
            IncomeItem.tax_year,
            TaxForm.role,
            TaxForm.form_type,
            IncomeItem.category,
            IncomeItem.is_memo,
        )
    )
    return list(session.execute(stmt.where(*_filters(IncomeItem, query))).all())


def _tax_rows(session: Session, query: TaxQuery) -> list[Any]:
    stmt = (
        select(
            TaxItem.user_id,
            TaxItem.tax_year,
            TaxForm.role,
            TaxItem.category,
            func.sum(TaxItem.amount_minor),
        )
        .join(TaxForm, TaxForm.id == TaxItem.form_id)
        .group_by(TaxItem.user_id, TaxItem.tax_year, TaxForm.role, TaxItem.category)
    )
    return list(session.execute(stmt.where(*_filters(TaxItem, query))).all())


def _form_rows(session: Session, query: TaxQuery) -> list[Any]:
    stmt = select(
        TaxForm.user_id,
        TaxForm.tax_year,
        TaxForm.role,
        func.count(TaxForm.id),
        func.count(func.distinct(TaxForm.document_id)),
        func.sum(TaxForm.is_corrected),
    ).group_by(TaxForm.user_id, TaxForm.tax_year, TaxForm.role)
    stmt = stmt.where(TaxForm.user_id.in_(query.user_ids)) if query.user_ids is not None else stmt
    if query.tax_years is not None:
        stmt = stmt.where(TaxForm.tax_year.in_(query.tax_years))
    return list(session.execute(stmt).all())


def _resolve(
    income_rows: list[Any], tax_rows: list[Any], form_rows: list[Any]
) -> dict[tuple[int, int], _Resolved]:
    keys: set[tuple[int, int]] = set()
    src_income: dict[tuple[int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    src_memo: dict[tuple[int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    ret_income: dict[tuple[int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    ret_memo: dict[tuple[int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for user_id, year, role, form_type, category, is_memo, total in income_rows:
        key = (user_id, year)
        keys.add(key)
        if role == "source":
            income, memo = src_income[key], src_memo[key]
        elif form_type == "1040":  # state returns never feed income (they restate the 1040)
            income, memo = ret_income[key], ret_memo[key]
        else:
            continue
        amount = int(total or 0)
        if category in MEMO_INCOME_CATEGORIES:
            memo[category] += amount
            income[category] += amount
        elif is_memo:
            memo[TAX_EXEMPT_MEMO_KEY] += amount
        else:
            income[category] += amount

    src_tax: dict[tuple[int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    ret_tax: dict[tuple[int, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for user_id, year, role, category, total in tax_rows:
        key = (user_id, year)
        keys.add(key)
        (src_tax if role == "source" else ret_tax)[key][category] += int(total or 0)

    docs: dict[tuple[int, int], int] = defaultdict(int)
    forms: dict[tuple[int, int], int] = defaultdict(int)
    corrected: dict[tuple[int, int], int] = defaultdict(int)
    has_source: set[tuple[int, int]] = set()
    has_return: set[tuple[int, int]] = set()
    for user_id, year, role, n_forms, n_docs, n_corrected in form_rows:
        key = (user_id, year)
        keys.add(key)
        forms[key] += int(n_forms)
        docs[key] += int(n_docs)
        corrected[key] += int(n_corrected or 0)
        (has_source if role == "source" else has_return).add(key)

    out: dict[tuple[int, int], _Resolved] = {}
    for key in keys:
        r = _Resolved(documents=docs[key], forms=forms[key])
        if key in has_source:
            r.basis = "source_documents"
            income, memo = src_income[key], src_memo[key]
            withheld_src = src_tax[key]
        elif key in has_return:
            r.basis = "return"
            income, memo = ret_income[key], ret_memo[key]
            withheld_src = ret_tax[key]
            r.warnings.append(
                "No W-2/1099 source documents were imported for this year; income and "
                "withholding come from the tax return."
            )
        else:
            income, memo, withheld_src = {}, {}, {}
        for cat, amount in income.items():
            r.income[cat] += amount
        for cat, amount in memo.items():
            r.memo[cat] += amount
        for cat in _WITHHELD:
            r.withheld[cat] = withheld_src.get(cat, 0)
        for cat in _FICA:
            r.fica[cat] = withheld_src.get(cat, 0)

        ret = ret_tax[key]
        for cat in _LIABILITY:
            if cat in ret:
                r.liability[cat] = ret[cat]
        if "total_payments" in ret:
            r.payments = ret["total_payments"]
        if "refund" in ret:
            r.refund = ret["refund"]
        if "amount_owed" in ret:
            r.owed = ret["amount_owed"]
        if (
            r.refund is None
            and r.owed is None
            and r.payments is not None
            and "total_federal_tax" in r.liability
        ):
            diff = r.payments - r.liability["total_federal_tax"]
            r.refund, r.owed, r.derived = max(diff, 0), max(-diff, 0), True
            r.warnings.append("Refund / amount owed is derived from payments minus total tax.")

        if key in has_source and key in has_return:
            src_wages = src_income[key].get("salary_wages", 0)
            ret_wages = ret_income[key].get("salary_wages", 0)
            if abs(src_wages - ret_wages) > _RECONCILE_TOLERANCE_MINOR:
                r.warnings.append(
                    f"Wages on W-2s ({_fmt(src_wages)}) differ from the tax return "
                    f"({_fmt(ret_wages)}) by {_fmt(abs(src_wages - ret_wages))}. Income shown "
                    "is from the source documents; check for a missing or corrected form."
                )
        if any(c in _ESTIMATE_CATEGORIES for c in r.liability):
            r.warnings.append(
                "The ordinary vs preferential federal tax split is an estimate, not a printed figure."
            )
        if corrected[key]:
            r.warnings.append(
                f"{corrected[key]} form(s) are marked corrected; a superseded original imported "
                "as well would be counted twice."
            )
        out[key] = r
    return out


def _merge(parts: list[_Resolved]) -> _Resolved:
    if len(parts) == 1:
        return parts[0]
    m = _Resolved()
    bases = {p.basis for p in parts}
    m.basis = bases.pop() if len(bases) == 1 else "mixed"
    for p in parts:
        for d_out, d_in in (
            (m.income, p.income),
            (m.memo, p.memo),
            (m.withheld, p.withheld),
            (m.fica, p.fica),
            (m.liability, p.liability),
        ):
            for cat, amount in d_in.items():
                d_out[cat] = d_out.get(cat, 0) + amount
        for attr in ("payments", "refund", "owed"):
            value = getattr(p, attr)
            if value is not None:
                setattr(m, attr, (getattr(m, attr) or 0) + value)
        m.derived = m.derived or p.derived
        m.documents += p.documents
        m.forms += p.forms
        for w in p.warnings:
            if w not in m.warnings:
                m.warnings.append(w)
    return m


def _rate(numerator: int | None, denominator: int) -> float | None:
    if numerator is None or denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def _finalize(year: int, user_id: int | None, r: _Resolved) -> TaxYearSummary:
    income_by_category: dict[IncomeCategory, int] = {
        c: r.income.get(c, 0) for c in INCOME_CATEGORIES
    }
    total_income = sum(v for c, v in income_by_category.items() if c not in MEMO_INCOME_CATEGORIES)
    withheld: dict[TaxCategory, int] = {c: r.withheld.get(c, 0) for c in _WITHHELD}
    fica: dict[TaxCategory, int] = {c: r.fica.get(c, 0) for c in _FICA}
    liability: dict[TaxCategory, int] = {c: r.liability[c] for c in _LIABILITY if c in r.liability}

    fed_withheld = withheld["federal_income_tax_withheld"]
    federal = liability.get("total_federal_tax")
    federal_for_all_in = federal if federal is not None else fed_withheld
    state = liability.get("state_income_tax_liability")
    state_for_all_in = state if state is not None else withheld["state_income_tax_withheld"]
    all_in_numerator = (
        federal_for_all_in
        + state_for_all_in
        + withheld["local_income_tax_withheld"]
        + sum(fica.values())
    )
    has_any_tax = bool(federal is not None or any(withheld.values()) or any(fica.values()))
    return TaxYearSummary(
        tax_year=year,
        user_id=user_id,
        income_basis=r.basis,
        income_by_category=income_by_category,
        memo_by_category=dict(r.memo),
        total_income_minor=total_income,
        withheld=withheld,
        fica=fica,
        liability=liability,
        payments_minor=r.payments,
        refund_minor=r.refund,
        amount_owed_minor=r.owed,
        refund_or_owed_derived=r.derived,
        federal_effective_rate=_rate(federal, total_income),
        all_in_rate=_rate(all_in_numerator if has_any_tax else None, total_income),
        withholding_rate=_rate(fed_withheld if any(withheld.values()) else None, total_income),
        document_count=r.documents,
        form_count=r.forms,
        warnings=list(r.warnings),
    )


def run_tax_summary(session: Session, query: TaxQuery) -> list[TaxYearSummary]:
    """Summaries per tax year (and per user when ``query.per_user``), newest year first.

    Raises:
        ValueError: unsupported currency, tax year outside 1990..2100, or a non-int id.
    """
    _validate(query)
    resolved = _resolve(
        _income_rows(session, query), _tax_rows(session, query), _form_rows(session, query)
    )
    out: list[TaxYearSummary] = []
    if query.per_user:
        for (uid, year), r in resolved.items():
            out.append(_finalize(year, uid, r))
        out.sort(key=lambda s: (-s.tax_year, s.user_id or 0))
        return out
    by_year: dict[int, list[_Resolved]] = defaultdict(list)
    for (_uid, year), r in sorted(resolved.items()):
        by_year[year].append(r)
    single_user = (
        query.user_ids[0] if query.user_ids is not None and len(query.user_ids) == 1 else None
    )
    for year in sorted(by_year, reverse=True):
        out.append(_finalize(year, single_user, _merge(by_year[year])))
    return out


def list_tax_years(session: Session, user_ids: list[int] | None) -> list[int]:
    """Distinct tax years that have at least one imported form, newest first."""
    stmt = select(TaxForm.tax_year).distinct().order_by(TaxForm.tax_year.desc())
    if user_ids is not None:
        stmt = stmt.where(TaxForm.user_id.in_(user_ids))
    return [int(y) for y in session.scalars(stmt)]


def list_tax_documents(
    session: Session, *, user_ids: list[int] | None, tax_year: int | None
) -> list[TaxDocument]:
    """Tax documents (any status), newest year first then newest id first."""
    stmt = select(TaxDocument).order_by(
        TaxDocument.tax_year.desc().nulls_last(), TaxDocument.id.desc()
    )
    if user_ids is not None:
        stmt = stmt.where(TaxDocument.user_id.in_(user_ids))
    if tax_year is not None:
        stmt = stmt.where(TaxDocument.tax_year == tax_year)
    return list(session.scalars(stmt))


def get_tax_document(session: Session, document_id: int) -> TaxDocument | None:
    """One document with its forms, income items and tax items eagerly loaded."""
    stmt = (
        select(TaxDocument)
        .where(TaxDocument.id == document_id)
        .options(
            selectinload(TaxDocument.forms).selectinload(TaxForm.income_items),
            selectinload(TaxDocument.forms).selectinload(TaxForm.tax_items),
        )
    )
    return session.scalars(stmt).one_or_none()


def run_income_by_payer(session: Session, query: TaxQuery) -> list[IncomePayerRow]:
    """Non-memo income on source forms, per (year, user, payer, form type, category).

    Sorted by year desc, then amount desc. ``payer_name`` is LOCAL ONLY.

    Raises:
        ValueError: as `run_tax_summary`.
    """
    _validate(query)
    stmt = (
        select(
            IncomeItem.tax_year,
            IncomeItem.user_id,
            TaxForm.payer_name,
            TaxForm.form_type,
            IncomeItem.category,
            func.sum(IncomeItem.amount_minor),
        )
        .join(TaxForm, TaxForm.id == IncomeItem.form_id)
        .where(TaxForm.role == "source", IncomeItem.is_memo.is_(False))
        .where(IncomeItem.category.not_in(sorted(MEMO_INCOME_CATEGORIES)))
        .group_by(
            IncomeItem.tax_year,
            IncomeItem.user_id,
            TaxForm.payer_name,
            TaxForm.form_type,
            IncomeItem.category,
        )
    )
    rows = session.execute(stmt.where(*_filters(IncomeItem, query))).all()
    result = [
        IncomePayerRow(
            tax_year=int(y),
            user_id=int(u),
            payer_name=p,
            form_type=f,
            category=cast(IncomeCategory, c),
            amount_minor=int(a or 0),
        )
        for y, u, p, f, c, a in rows
    ]
    result.sort(key=lambda r: (-r.tax_year, -r.amount_minor))
    return result
