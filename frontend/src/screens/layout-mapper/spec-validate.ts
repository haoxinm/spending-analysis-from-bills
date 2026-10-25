import {
  ACCOUNT_TYPES,
  COLUMN_TYPES,
  KIND_HINTS,
  MONEY_ROLES,
  SECTIONS_MODES,
  SIGN_CONVENTIONS,
  YEAR_INFERENCES,
  type SpecFieldError,
} from "./spec-types";

/** Mirrors `layout_spec.py::MAX_PATTERN_LENGTH` (§6.4). */
export const MAX_PATTERN_LENGTH = 200;

/** Mirrors `layout_spec.py::_NESTED_QUANTIFIER_RE` — a group with a quantifier, itself
 * quantified (e.g. `(a+)+`), the classic catastrophic-backtracking shape (§6.4). */
const NESTED_QUANTIFIER_RE = /\([^()]*[+*][^()]*\)[+*]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function checkPattern(text: unknown, field: string, errors: SpecFieldError[]): void {
  if (!isNonEmptyString(text)) {
    errors.push({ field, message: "must be a non-empty string" });
    return;
  }
  if (text.length > MAX_PATTERN_LENGTH) {
    errors.push({ field, message: `exceeds ${MAX_PATTERN_LENGTH} characters` });
    return;
  }
  if (NESTED_QUANTIFIER_RE.test(text)) {
    errors.push({ field, message: "nested quantifiers (e.g. '(a+)+') are not allowed" });
    return;
  }
  try {
    void new RegExp(text, "i"); // only checking that the pattern compiles
  } catch (exc) {
    errors.push({ field, message: `invalid regex: ${String(exc)}` });
  }
}

/**
 * Validates an already-parsed spec value (from the manual builder, or from `parseYamlish` on a
 * pasted spec) against the same rules `layout_spec.schema.json` and `_build_doc` enforce
 * server-side. Returns every problem found — never just the first (a spec is rejected as a
 * whole, never partially applied).
 *
 * This is a best-effort client-side mirror, not the authority: the backend interpreter is. See
 * this module's file-level docstring for why it exists anyway.
 */
export function validateSpec(data: unknown): SpecFieldError[] {
  const errors: SpecFieldError[] = [];

  if (!isPlainObject(data)) {
    return [{ field: "<root>", message: "must be a mapping (object)" }];
  }

  if (!isNonEmptyString(data.id) || !/^[a-z][a-z0-9_]*$/.test(data.id)) {
    errors.push({ field: "id", message: "must be a lowercase snake_case identifier" });
  }
  if (!Number.isInteger(data.version) || (data.version as number) < 1) {
    errors.push({ field: "version", message: "must be an integer >= 1" });
  }
  if (!ACCOUNT_TYPES.includes(data.account_type as never)) {
    errors.push({ field: "account_type", message: `must be one of ${ACCOUNT_TYPES.join(", ")}` });
  }
  if (data.currency !== undefined && (typeof data.currency !== "string" || data.currency.length !== 3)) {
    errors.push({ field: "currency", message: "must be a 3-letter currency code" });
  }

  // --- detect ---
  const detect = data.detect;
  if (!isPlainObject(detect)) {
    errors.push({ field: "detect", message: "is required" });
  } else {
    if (!isFiniteNumber(detect.score) || detect.score < 0 || detect.score > 1) {
      errors.push({ field: "detect.score", message: "must be a number between 0 and 1" });
    }
    for (const key of ["all_of", "any_of"] as const) {
      const value = detect[key];
      if (value !== undefined) {
        if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
          errors.push({ field: `detect.${key}`, message: "must be an array of non-empty strings" });
        } else if (value.some((t) => t.length > MAX_PATTERN_LENGTH)) {
          errors.push({
            field: `detect.${key}`,
            message: `each term must be at most ${MAX_PATTERN_LENGTH} characters`,
          });
        }
      }
    }
  }

  // --- columns ---
  const columns = data.columns;
  if (!Array.isArray(columns) || columns.length === 0) {
    errors.push({ field: "columns", message: "at least one column is required" });
  } else {
    const seenNames = new Set<string>();
    let hasPostedDate = false;
    let hasDescription = false;
    const roles = new Set<string>();
    let hasMoney = false;

    columns.forEach((col, i) => {
      const path = `columns[${i}]`;
      if (!isPlainObject(col)) {
        errors.push({ field: path, message: "must be a mapping" });
        return;
      }
      const name = col.name;
      if (!isNonEmptyString(name)) {
        errors.push({ field: `${path}.name`, message: "is required" });
      } else {
        if (seenNames.has(name)) {
          errors.push({ field: `${path}.name`, message: `duplicate column name '${name}'` });
        }
        seenNames.add(name);
        if (name === "posted_date") hasPostedDate = true;
        if (name === "description") hasDescription = true;
      }

      const x0 = col.x0;
      const x1 = col.x1;
      if (!isFiniteNumber(x0) || !isFiniteNumber(x1)) {
        errors.push({ field: path, message: "x0 and x1 must be numbers" });
      } else if (x0 >= x1) {
        errors.push({ field: path, message: `x0 (${x0}) must be less than x1 (${x1})` });
      }

      const colType = col.type;
      if (!COLUMN_TYPES.includes(colType as never)) {
        errors.push({ field: `${path}.type`, message: `must be one of ${COLUMN_TYPES.join(", ")}` });
      }
      if (colType === "date") {
        const formats = col.formats;
        if (!Array.isArray(formats) || formats.length === 0 || !formats.every(isNonEmptyString)) {
          errors.push({ field: `${path}.formats`, message: "date columns require at least one format" });
        }
      }
      if (colType === "money") {
        hasMoney = true;
        roles.add((col.role as string | undefined) ?? "amount");
      }
      if (col.role !== undefined) {
        if (!MONEY_ROLES.includes(col.role as never)) {
          errors.push({ field: `${path}.role`, message: `must be one of ${MONEY_ROLES.join(", ")}` });
        } else if (colType !== "money") {
          errors.push({ field: `${path}.role`, message: "role is only valid on money columns" });
        }
      }
    });

    if (!hasPostedDate) errors.push({ field: "columns", message: "a 'posted_date' column is required" });
    if (!hasDescription) errors.push({ field: "columns", message: "a 'description' column is required" });
    if (!hasMoney) errors.push({ field: "columns", message: "at least one money column is required" });
    else if (roles.has("amount") && (roles.has("debit") || roles.has("credit"))) {
      errors.push({ field: "columns", message: "cannot mix an 'amount' column with debit/credit columns" });
    }
  }

  // --- sections ---
  const sections = data.sections;
  if (sections !== undefined) {
    if (!isPlainObject(sections)) {
      errors.push({ field: "sections", message: "must be a mapping" });
    } else {
      if (sections.mode !== undefined && !SECTIONS_MODES.includes(sections.mode as never)) {
        errors.push({ field: "sections.mode", message: `must be one of ${SECTIONS_MODES.join(", ")}` });
      }
      const patterns = sections.patterns;
      if (patterns !== undefined) {
        if (!Array.isArray(patterns)) {
          errors.push({ field: "sections.patterns", message: "must be an array" });
        } else {
          patterns.forEach((p, i) => {
            const path = `sections.patterns[${i}]`;
            if (!isPlainObject(p)) {
              errors.push({ field: path, message: "must be a mapping" });
              return;
            }
            checkPattern(p.match, `${path}.match`, errors);
            const hints = ["kind_hint", "outflow_kind_hint", "inflow_kind_hint"] as const;
            if (!hints.some((h) => p[h] !== undefined)) {
              errors.push({
                field: path,
                message: "must set kind_hint, outflow_kind_hint, or inflow_kind_hint",
              });
            }
            for (const h of hints) {
              if (p[h] !== undefined && !KIND_HINTS.includes(p[h] as never)) {
                errors.push({ field: `${path}.${h}`, message: `must be one of ${KIND_HINTS.join(", ")}` });
              }
            }
          });
        }
      }
      if (sections.terminator !== undefined) {
        checkPattern(sections.terminator, "sections.terminator", errors);
      }
      const exclude = sections.exclude_tables;
      if (exclude !== undefined) {
        if (!Array.isArray(exclude)) {
          errors.push({ field: "sections.exclude_tables", message: "must be an array" });
        } else {
          exclude.forEach((t, i) => checkPattern(t, `sections.exclude_tables[${i}]`, errors));
        }
      }
    }
  }

  // --- sign ---
  const sign = data.sign;
  if (sign !== undefined) {
    if (!isPlainObject(sign)) {
      errors.push({ field: "sign", message: "must be a mapping" });
    } else {
      for (const key of ["outflow", "inflow"] as const) {
        if (sign[key] !== undefined && !SIGN_CONVENTIONS.includes(sign[key] as never)) {
          errors.push({ field: `sign.${key}`, message: `must be one of ${SIGN_CONVENTIONS.join(", ")}` });
        }
      }
    }
  }

  if (data.year_inference !== undefined && !YEAR_INFERENCES.includes(data.year_inference as never)) {
    errors.push({ field: "year_inference", message: `must be one of ${YEAR_INFERENCES.join(", ")}` });
  }

  const totals = data.totals;
  if (totals !== undefined && !isPlainObject(totals)) {
    errors.push({ field: "totals", message: "must be a mapping" });
  }

  const accountMask = data.account_mask;
  if (accountMask !== undefined) {
    if (!isPlainObject(accountMask)) {
      errors.push({ field: "account_mask", message: "must be a mapping" });
    } else {
      checkPattern(accountMask.pattern, "account_mask.pattern", errors);
    }
  }

  const fx = data.fx;
  if (fx !== undefined) {
    if (!isPlainObject(fx)) {
      errors.push({ field: "fx", message: "must be a mapping" });
    } else {
      checkPattern(fx.pattern, "fx.pattern", errors);
      for (const key of ["amount_group", "currency_group", "rate_group"] as const) {
        const value = fx[key];
        const isValidIndex = typeof value === "number" && Number.isInteger(value) && value >= 1;
        if (!(isNonEmptyString(value) || isValidIndex)) {
          errors.push({ field: `fx.${key}`, message: "must be a non-empty group name or a 1-based group index" });
        }
      }
    }
  }

  return errors;
}
