/** Fixed per-category income colours (hex: SVG needs concrete values). Distinct from the
 * spending outflow/inflow hues so income never reads as spending. */
export const INCOME_CATEGORY_COLORS: Record<string, string> = {
  salary_wages: "#0284c7",
  interest: "#059669",
  ordinary_dividends: "#7c3aed",
  qualified_dividends: "#a78bfa",
  short_term_capital_gain: "#d97706",
  long_term_capital_gain: "#65a30d",
  self_employment: "#0891b2",
  other: "#64748b",
};

export const CHART_INCOME = "#0284c7";
export const CHART_TAX = "#d97706";

export function incomeColor(category: string): string {
  return INCOME_CATEGORY_COLORS[category] ?? "#64748b";
}

export const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  color: "hsl(var(--card-foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
};
