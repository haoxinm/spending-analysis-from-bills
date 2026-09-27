import * as React from "react";

import { cn } from "@/lib/utils";

export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Signed integer minor units (cents). Positive = money leaving the user (I5). */
  minorUnits: number;
  currency?: string;
  /** Prefix a "+" on money coming in (negative `minorUnits`). Off by default: a bare "-" is
   *  the native `Intl` rendering and matches how a statement shows a credit. */
  showPlusForInflow?: boolean;
  /** Render a decorative direction glyph (▲ outflow / ▼ inflow) ahead of the amount, for a
   *  non-colour cue in dense contexts (a chart legend, a dashboard tile). Off by default,
   *  because a table cell should read as an amount, not as an amount plus an icon. */
  showGlyph?: boolean;
  locale?: string;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Renders signed minor units (cents) as a localized currency string.
 *
 * `minorUnits` is positive = outflow (money leaving the user) and negative = inflow (money
 * returning), per I5. This component never flips that sign: a purchase (`1234`) renders as
 * a plain `$12.34` (the ordinary case on a statement), and a refund or payment received
 * (`-1234`) renders as a clearly negative `-$12.34` — distinguishable from an outflow by more
 * than colour alone (the sign itself, an `aria-label` stating the direction for screen
 * readers, and a `data-direction` attribute callers can style against; `showGlyph` adds a
 * visible ▲/▼ marker for contexts, like a legend, where colour is the only other cue).
 *
 * Amounts always render with tabular figures (`tabular-nums`) so a column of them lines up.
 */
export function Money({
  minorUnits,
  currency = "USD",
  showPlusForInflow = false,
  showGlyph = false,
  locale = "en-US",
  className,
  ...props
}: MoneyProps) {
  const direction: "outflow" | "inflow" | "zero" =
    minorUnits > 0 ? "outflow" : minorUnits < 0 ? "inflow" : "zero";
  // Format the magnitude ourselves and prepend our own sign, rather than let `Intl` add its
  // own "-" and risk double-signing when `showPlusForInflow` overrides it.
  const magnitude = getFormatter(locale, currency).format(Math.abs(minorUnits) / 100);
  const sign =
    direction === "inflow" ? (showPlusForInflow ? "+" : "-") : direction === "outflow" ? "" : "";
  const glyph = direction === "outflow" ? "▼" : direction === "inflow" ? "▲" : "";
  const directionLabel =
    direction === "outflow" ? "outflow" : direction === "inflow" ? "inflow" : "no change";

  return (
    <span
      className={cn(
        "tabular-nums",
        direction === "zero"
          ? "text-muted-foreground"
          : direction === "outflow"
            ? "text-outflow"
            : "text-inflow",
        className,
      )}
      data-direction={direction}
      aria-label={`${directionLabel} ${magnitude}`}
      {...props}
    >
      {showGlyph && glyph ? <span aria-hidden="true">{glyph} </span> : null}
      {sign}
      {magnitude}
    </span>
  );
}
