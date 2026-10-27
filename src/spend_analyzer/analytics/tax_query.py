"""Income and tax aggregation over the `tax_*` tables (plan 4b).

**All tax SQL lives here.** Routers and the CLI call `run_tax_summary` / `list_tax_years` /
`list_tax_documents` / `get_tax_document` / `run_income_by_payer`; none builds its own query.
Every user-supplied value (user ids, tax years, currency) is validated and then bound as a
parameter. There is no caller-chosen identifier (no group-by input), so nothing needs an allow-list.

Units and signs (D6): all amounts are integer minor units (cents), USD only. Income is the amount
as received (a net capital loss is negative); tax amounts are non-negative magnitudes.

**Source vs return (D4).** W-2 / 1099 forms (role ``source``) and the 1040 (role ``return``)
describe the same income, so they are never added together. Per (user, tax year):

- *A 1040 exists* (``income_basis`` ``"return"``): total income AND the income category breakdown
  come from the return. It is authoritative and already applies the $3,000 capital-loss limit.
  Withholding (federal, state, local) and FICA come from the source forms, because the 1040 does not
  carry FICA or state figures; federal withholding falls back to the return's line 25d only when no
  source form carries it. Source-form sums are compared with the return per category (wages,
  interest, dividends, net capital result, self-employment, other income); a difference of more than
  $1 raises a reconciliation warning ("... is $X less than the return reports - some forms may not
  be imported"). ``other`` only warns when the source forms exceed the return, because the return's
  line 4b-6b/8 figures include items (pensions, benefits) that have no supported source form.
- *Several 1040s for the same user and year*: only the latest one (highest form id) is used, with a
  warning; they are never summed. Other return forms (state returns) still contribute their
  liability.
- *No 1040* (``"source_documents"``): income comes from the source forms. The combined net capital
  result (short plus long term) is floored at -$3,000 (the filing-status-independent limit; married
  filing separately is really -$1,500, which cannot be known without a return) and a warning notes
  the carryover. The loss categories are reduced so the categories still sum to the total.
- Neither: ``"none"``. Across users ``"mixed"`` when their bases differ.
- Liability, payments and refund/owed always come from the return.

**Memo items (D5).** ``qualified_dividends`` and any item stored with ``is_memo`` are excluded from
``total_income_minor``. ``qualified_dividends`` is still listed in ``income_by_category`` (flagged
via ``memo_by_category``); other memo items (e.g. tax-exempt interest) appear only in
``memo_by_category["tax_exempt"]``.

**Rates** (rounded to 4 dp, ``None`` when the denominator ``total_income_minor`` is <= 0 or the
numerator is unavailable):

- ``federal_effective_rate`` = ``total_federal_tax`` (return) / total income;
- ``withholding_rate`` = federal income tax withheld (sources) / total income;
- ``all_in_rate`` = (federal tax [return's total tax less the part of its Additional Medicare Tax
  already counted in W-2 box 6 Medicare, if a return is present; else federal withheld]
  + state tax [state liability if present, else state withheld] + local withheld
  + Social Security + Medicare) / total income. The Additional Medicare Tax (Schedule 2 line 11) is
  withheld by employers inside W-2 box 6, so the liability part excludes
  ``min(additional_medicare_tax, medicare_tax)`` to avoid counting the same 0.9% twice.

**Refund / owed.** Taken from the return when printed (``refund`` is the refund actually received:
line 35a, else line 34 less line 36). If the return prints neither but has
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

from sqlalchemy import ColumnElement, case, func, select
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


#: Form id for return forms (so only the latest 1040 counts), 0 for source forms (summed together).
_RETURN_FORM_KEY = case((TaxForm.role == "return", TaxForm.id), else_=0)


def _income_rows(session: Session, query: TaxQuery) -> list[Any]:
    stmt = (
        select(
            IncomeItem.user_id,
            IncomeItem.tax_year,
            TaxForm.role,
            TaxForm.form_type,
            _RETURN_FORM_KEY,
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
            _RETURN_FORM_KEY,
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
            TaxForm.form_type,
            _RETURN_FORM_KEY,
            TaxItem.category,
            func.sum(TaxItem.amount_minor),
        )
        .join(TaxForm, TaxForm.id == TaxItem.form_id)
        .group_by(
            TaxItem.user_id,
            TaxItem.tax_year,
            TaxForm.role,
            TaxForm.form_type,
            _RETURN_FORM_KEY,
            TaxItem.category,
        )
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


def _return_rows(session: Session, query: TaxQuery) -> list[Any]:
    """(user, year, latest 1040 form id, number of 1040 forms) per (user, year)."""
    stmt = (
        select(TaxForm.user_id, TaxForm.tax_year, func.max(TaxForm.id), func.count(TaxForm.id))
        .where(TaxForm.form_type == "1040")
        .group_by(TaxForm.user_id, TaxForm.tax_year)
    )
    stmt = stmt.where(TaxForm.user_id.in_(query.user_ids)) if query.user_ids is not None else stmt
    if query.tax_years is not None:
        stmt = stmt.where(TaxForm.tax_year.in_(query.tax_years))
    return list(session.execute(stmt).all())


_Key = tuple[int, int]
#: Reconciliation groups: (label for warnings, source categories, return categories).
_RECONCILE: tuple[tuple[str, tuple[str, ...], bool], ...] = (
    ("W-2 wages", ("salary_wages",), False),
    ("1099 interest", ("interest",), False),
    ("1099 dividends", ("ordinary_dividends",), False),
    ("1099-B net capital gain", ("short_term_capital_gain", "long_term_capital_gain"), False),
    ("1099 self-employment income", ("self_employment",), False),
    ("other 1099 income", ("other",), True),
)
_CAPITAL_CATEGORIES: tuple[str, ...] = ("short_term_capital_gain", "long_term_capital_gain")
#: Annual limit on a net capital loss deducted against other income (single / joint filers).
_CAPITAL_LOSS_LIMIT_MINOR = 300_000


def _limit_capital_loss(income: dict[str, int]) -> int:
    """Raise net capital loss categories in `income` so their sum is at least -$3,000.

    Returns the amount carried over (minor units, >= 0). The most negative category is reduced first;
    the categories still sum to the limited result.
    """
    net = sum(income.get(c, 0) for c in _CAPITAL_CATEGORIES)
    carryover = max(-net - _CAPITAL_LOSS_LIMIT_MINOR, 0)
    remaining = carryover
    for cat in sorted(_CAPITAL_CATEGORIES, key=lambda c: income.get(c, 0)):
        value = income.get(cat, 0)
        if remaining <= 0 or value >= 0:
            continue
        take = min(remaining, -value)
        income[cat] = value + take
        remaining -= take
    return carryover


def _reconcile(
    r: _Resolved, src_income: dict[str, int], ret_income: dict[str, int], *, has_source: bool
) -> None:
    """Warn per category when source-form sums differ from the return by more than $1."""
    if not has_source:
        return
    src = dict(src_income)
    _limit_capital_loss(src)  # the return already applies the limit; compare like with like
    for label, cats, only_excess in _RECONCILE:
        src_sum = sum(src.get(c, 0) for c in cats)
        ret_sum = sum(ret_income.get(c, 0) for c in cats)
        diff = src_sum - ret_sum
        if abs(diff) <= _RECONCILE_TOLERANCE_MINOR:
            continue
        if diff < 0 and not only_excess:
            r.warnings.append(
                f"{label} is {_fmt(-diff)} less than the return reports - some forms may not be "
                "imported. Income shown is from the return."
            )
        elif diff > 0:
            r.warnings.append(
                f"{label} is {_fmt(diff)} more than the return reports - a corrected or duplicate "
                "form may have been imported. Income shown is from the return."
            )


def _resolve(
    income_rows: list[Any],
    tax_rows: list[Any],
    form_rows: list[Any],
    return_rows: list[Any],
) -> dict[_Key, _Resolved]:
    latest_return: dict[_Key, int] = {}
    return_count: dict[_Key, int] = {}
    for user_id, year, latest_id, n_returns in return_rows:
        latest_return[(user_id, year)] = int(latest_id)
        return_count[(user_id, year)] = int(n_returns)

    def counted(key: _Key, role: str, form_type: str, form_id: int) -> bool:
        """Source forms always count; only the latest 1040 counts; other returns always do."""
        return role == "source" or form_type != "1040" or latest_return.get(key) == form_id

    keys: set[_Key] = set()
    src_income: dict[_Key, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    src_memo: dict[_Key, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    ret_income: dict[_Key, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    ret_memo: dict[_Key, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for user_id, year, role, form_type, form_id, category, is_memo, total in income_rows:
        key = (user_id, year)
        keys.add(key)
        if role == "source":
            income, memo = src_income[key], src_memo[key]
        elif form_type == "1040":  # state returns never feed income (they restate the 1040)
            if not counted(key, role, form_type, form_id):
                continue
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

    src_tax: dict[_Key, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    ret_tax: dict[_Key, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for user_id, year, role, form_type, form_id, category, total in tax_rows:
        key = (user_id, year)
        keys.add(key)
        if not counted(key, role, form_type, form_id):
            continue
        (src_tax if role == "source" else ret_tax)[key][category] += int(total or 0)

    docs: dict[_Key, int] = defaultdict(int)
    forms: dict[_Key, int] = defaultdict(int)
    corrected: dict[_Key, int] = defaultdict(int)
    has_source: set[_Key] = set()
    for user_id, year, role, n_forms, n_docs, n_corrected in form_rows:
        key = (user_id, year)
        keys.add(key)
        forms[key] += int(n_forms)
        docs[key] += int(n_docs)
        corrected[key] += int(n_corrected or 0)
        if role == "source":
            has_source.add(key)

    out: dict[_Key, _Resolved] = {}
    for key in keys:
        r = _Resolved(documents=docs[key], forms=forms[key])
        has_return = key in latest_return
        src_cat_tax = src_tax[key]
        ret = ret_tax[key]
        if has_return:
            r.basis = "return"
            income, memo = ret_income[key], ret_memo[key]
            if return_count[key] > 1:
                r.warnings.append(
                    f"{return_count[key]} Form 1040 returns were imported for this year; only the "
                    "most recently imported one is used. Delete the others if they were "
                    "superseded."
                )
            if key not in has_source:
                r.warnings.append(
                    "No W-2/1099 source documents were imported for this year; income comes from "
                    "the tax return, and federal withholding from its line 25d."
                )
            _reconcile(r, src_income[key], ret_income[key], has_source=key in has_source)
        elif key in has_source:
            r.basis = "source_documents"
            income, memo = src_income[key], src_memo[key]
            carryover = _limit_capital_loss(income)
            if carryover > 0:
                r.warnings.append(
                    f"Net capital loss exceeds the $3,000 annual limit; only $3,000 is counted "
                    f"and {_fmt(carryover)} is a carryover to later years. Import the Form 1040 "
                    "for the exact figure."
                )
        else:
            income, memo = {}, {}
        for cat, amount in income.items():
            r.income[cat] += amount
        for cat, amount in memo.items():
            r.memo[cat] += amount

        for cat in _WITHHELD:
            r.withheld[cat] = src_cat_tax.get(cat, 0)
        for cat in _FICA:
            r.fica[cat] = src_cat_tax.get(cat, 0)
        fed = "federal_income_tax_withheld"
        if has_return and "federal_income_tax_withheld" in ret:
            if fed not in src_cat_tax:
                r.withheld[fed] = ret[fed]
            elif abs(src_cat_tax[fed] - ret[fed]) > _RECONCILE_TOLERANCE_MINOR:
                r.warnings.append(
                    f"Federal tax withheld on source forms ({_fmt(src_cat_tax[fed])}) differs from "
                    f"the return's line 25d ({_fmt(ret[fed])}). Withholding shown is from the "
                    "source forms."
                )

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
    federal_for_all_in = fed_withheld
    if federal is not None:
        # W-2 box 6 already includes the 0.9% Additional Medicare Tax an employer withheld.
        double_counted = min(liability.get("additional_medicare_tax", 0), fica["medicare_tax"])
        federal_for_all_in = federal - double_counted
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
        _income_rows(session, query),
        _tax_rows(session, query),
        _form_rows(session, query),
        _return_rows(session, query),
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
