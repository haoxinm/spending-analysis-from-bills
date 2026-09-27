import type { LayoutSpecObject } from "./spec-types";

/**
 * A tiny, deliberately partial YAML reader/writer for layout specs — not a general YAML
 * implementation. `frontend/package.json` is frozen for this WP (Phase 3 common brief: "you may
 * not change package.json"), so a real YAML library is not an option; this module covers exactly
 * the shape `layout_spec.schema.json` uses and that `stringifySpec` below produces:
 *
 * - block mappings (`key: value`, one per line, indented) and block sequences (`- item`)
 * - flow collections (`{a: 1, b: [2, 3]}`) for a single value, nested arbitrarily
 * - quoted (`"..."`, `'...'`) and bare scalar strings, numbers, booleans, `null`/`~`
 * - `#` line comments (outside quotes) and blank lines
 *
 * It does **not** support YAML anchors/aliases, tags, block scalars (`|`, `>`), multi-document
 * streams, or flow-sequence items that are themselves multi-line mappings. A pasted spec using
 * those constructs fails to parse here and falls back to "validate on save" (the backend still
 * runs `yaml.safe_load`, a full parser) — see this screen's report for that trade-off.
 *
 * The backend reads specs with `yaml.safe_load`, a real parser, so `stringifySpec`'s output (a
 * mix of block mappings and flow collections, matching the P1-H example) is always valid input
 * for it. `parseYamlish` below is only this screen's own best-effort reader, used to validate a
 * spec (built here or pasted) before it is ever sent to the server: it tries `JSON.parse` first
 * (a quick path for anyone who pastes plain JSON, itself valid YAML), then falls back to the
 * block/flow reader for classic indented YAML.
 */

export class YamlParseError extends Error {}

// ---------------------------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------------------------

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function stringifyScalar(value: unknown): string {
  if (typeof value === "string") return quoteString(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === null || value === undefined) return "null";
  throw new YamlParseError(`cannot stringify scalar of type ${typeof value}`);
}

function stringifyFlow(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stringifyFlow).join(", ")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    return `{${entries.map(([k, v]) => `${k}: ${stringifyFlow(v)}`).join(", ")}}`;
  }
  return stringifyScalar(value);
}

/** True when every value in this object is a scalar or an array of scalars — i.e. it reads
 * fine as one flow-style line rather than needing its own indented block. */
function isFlowFriendly(value: Record<string, unknown>): boolean {
  return Object.values(value).every(
    (v) => v === null || typeof v !== "object" || (Array.isArray(v) && v.every((x) => typeof x !== "object")),
  );
}

function stringifyBlock(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          // Every layout-spec list-of-mappings (columns, patterns) is short and flat enough to
          // read well as one flow-style line per item — and it keeps this module's parser simple.
          return `${pad}- ${stringifyFlow(item)}`;
        }
        return `${pad}- ${stringifyFlow(item)}`;
      })
      .join("\n");
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    return entries
      .map(([key, v]) => {
        if (v !== null && typeof v === "object" && !Array.isArray(v) && !isFlowFriendly(v as never)) {
          return `${pad}${key}:\n${stringifyBlock(v, indent + 1)}`;
        }
        if (Array.isArray(v) && v.some((x) => x !== null && typeof x === "object")) {
          return `${pad}${key}:\n${stringifyBlock(v, indent + 1)}`;
        }
        return `${pad}${key}: ${stringifyFlow(v)}`;
      })
      .join("\n");
  }
  return `${pad}${stringifyScalar(value)}`;
}

/** Renders a spec object as the fixed-shape YAML this module can always read back (§2f.1, P1-H
 * example). Top-level key order follows the spec's own field order for readability. */
export function stringifySpec(spec: LayoutSpecObject): string {
  return `${stringifyBlock(spec, 0)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------------------------

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
      return line.slice(0, i);
    }
  }
  return line;
}

interface Line {
  indent: number;
  content: string;
}

function toLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    const withoutComment = stripComment(raw.replace(/\r$/, ""));
    const trimmed = withoutComment.trim();
    if (trimmed === "") continue;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    lines.push({ indent, content: trimmed });
  }
  return lines;
}

function skipWs(s: string, pos: number): number {
  let p = pos;
  while (p < s.length && /\s/.test(s[p] ?? "")) p += 1;
  return p;
}

function coerceScalar(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return null;
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) || (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) {
    return unquote(t);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

function unquote(t: string): string {
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      throw new YamlParseError(`malformed double-quoted string: ${t}`);
    }
  }
  return t.slice(1, -1).replace(/''/g, "'");
}

function parseQuoted(s: string, pos: number): [string, number] {
  const quote = s[pos];
  let end = pos + 1;
  while (end < s.length) {
    if (quote === '"' && s[end] === "\\") {
      end += 2;
      continue;
    }
    if (s[end] === quote) {
      if (quote === "'" && s[end + 1] === "'") {
        end += 2;
        continue;
      }
      break;
    }
    end += 1;
  }
  if (end >= s.length) throw new YamlParseError(`unterminated quoted string starting at ${pos}`);
  return [unquote(s.slice(pos, end + 1)), end + 1];
}

function readBareToken(s: string, pos: number): [string, number] {
  let end = pos;
  while (end < s.length && !",]}:".includes(s[end] ?? "")) end += 1;
  return [s.slice(pos, end), end];
}

function parseFlow(s: string, pos: number): [unknown, number] {
  const p = skipWs(s, pos);
  const ch = s[p];
  if (ch === "{") return parseFlowObject(s, p);
  if (ch === "[") return parseFlowArray(s, p);
  if (ch === '"' || ch === "'") return parseQuoted(s, p);
  const [token, next] = readBareToken(s, p);
  return [coerceScalar(token), next];
}

function parseFlowArray(s: string, pos: number): [unknown[], number] {
  let p = skipWs(s, pos + 1);
  const items: unknown[] = [];
  if (s[p] === "]") return [items, p + 1];
  for (;;) {
    const [value, next] = parseFlow(s, p);
    items.push(value);
    p = skipWs(s, next);
    if (s[p] === ",") {
      p = skipWs(s, p + 1);
      continue;
    }
    if (s[p] === "]") return [items, p + 1];
    throw new YamlParseError(`expected ',' or ']' at position ${p} in: ${s}`);
  }
}

function parseFlowObject(s: string, pos: number): [Record<string, unknown>, number] {
  let p = skipWs(s, pos + 1);
  const obj: Record<string, unknown> = {};
  if (s[p] === "}") return [obj, p + 1];
  for (;;) {
    let key: string;
    if (s[p] === '"' || s[p] === "'") {
      const [k, next] = parseQuoted(s, p);
      key = k;
      p = next;
    } else {
      const [k, next] = readBareToken(s, p);
      key = k.trim();
      p = next;
    }
    p = skipWs(s, p);
    if (s[p] !== ":") throw new YamlParseError(`expected ':' after key '${key}' at position ${p}`);
    p = skipWs(s, p + 1);
    const [value, next] = parseFlow(s, p);
    obj[key] = value;
    p = skipWs(s, next);
    if (s[p] === ",") {
      p = skipWs(s, p + 1);
      continue;
    }
    if (s[p] === "}") return [obj, p + 1];
    throw new YamlParseError(`expected ',' or '}' at position ${p} in: ${s}`);
  }
}

function parseInlineValue(text: string): unknown {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    const [value, next] = parseFlow(t, 0);
    if (skipWs(t, next) !== t.length) {
      throw new YamlParseError(`unexpected trailing content after flow value: ${t}`);
    }
    return value;
  }
  return coerceScalar(t);
}

/** Splits `content` on the first top-level `:` (not inside quotes/brackets), for a `key: value`
 * block-mapping line. Returns `null` when there is no such colon (a bare block-sequence item). */
function splitMappingLine(content: string): { key: string; rest: string } | null {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (!inSingle && !inDouble) {
      if (ch === "{" || ch === "[") depth += 1;
      else if (ch === "}" || ch === "]") depth -= 1;
      else if (ch === ":" && depth === 0 && (content[i + 1] === undefined || content[i + 1] === " ")) {
        const rawKey = content.slice(0, i).trim();
        const key = rawKey.startsWith('"') || rawKey.startsWith("'") ? unquote(rawKey) : rawKey;
        return { key, rest: content.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

interface Cursor {
  i: number;
}

function parseBlockMapping(lines: Line[], cursor: Cursor, indent: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  while (cursor.i < lines.length && (lines[cursor.i]?.indent ?? -1) === indent) {
    const line = lines[cursor.i];
    if (line === undefined || line.content.startsWith("- ") || line.content === "-") break;
    const split = splitMappingLine(line.content);
    if (split === null) {
      throw new YamlParseError(`expected 'key: value' at: ${line.content}`);
    }
    cursor.i += 1;
    if (split.rest === "") {
      const next = lines[cursor.i];
      if (next !== undefined && next.indent > indent) {
        obj[split.key] = parseBlockAt(lines, cursor, next.indent);
      } else {
        obj[split.key] = null;
      }
    } else {
      obj[split.key] = parseInlineValue(split.rest);
    }
  }
  return obj;
}

function parseBlockSequence(lines: Line[], cursor: Cursor, indent: number): unknown[] {
  const items: unknown[] = [];
  while (cursor.i < lines.length && (lines[cursor.i]?.indent ?? -1) === indent) {
    const line = lines[cursor.i];
    if (line === undefined || !(line.content.startsWith("- ") || line.content === "-")) break;
    const rest = line.content === "-" ? "" : line.content.slice(2).trimStart();
    if (rest === "") {
      cursor.i += 1;
      const next = lines[cursor.i];
      items.push(next !== undefined && next.indent > indent ? parseBlockAt(lines, cursor, next.indent) : null);
      continue;
    }
    const split = splitMappingLine(rest);
    if (split !== null) {
      // `- key: value` starting an inline block mapping: rewrite this line to look like an
      // ordinary mapping line at a virtual indent (dash + one space) and let
      // `parseBlockMapping` consume it plus any further-indented sibling keys.
      lines[cursor.i] = { indent: indent + 2, content: rest };
      items.push(parseBlockMapping(lines, cursor, indent + 2));
      continue;
    }
    cursor.i += 1;
    items.push(parseInlineValue(rest));
  }
  return items;
}

function parseBlockAt(lines: Line[], cursor: Cursor, indent: number): unknown {
  const line = lines[cursor.i];
  if (line === undefined) return null;
  if (line.content.startsWith("- ") || line.content === "-") {
    return parseBlockSequence(lines, cursor, indent);
  }
  return parseBlockMapping(lines, cursor, indent);
}

/**
 * Parses `text` into a plain JS value. Tries `JSON.parse` first (JSON is valid YAML, and is
 * exactly what `stringifySpec` emits for a flow-only document), then falls back to the
 * block/flow reader above for classic indented YAML. Throws `YamlParseError` on anything neither
 * can read — including any of the unsupported constructs in this module's file-level docstring.
 */
export function parseYamlish(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON — fall through to the YAML-ish block reader.
  }
  const lines = toLines(text);
  if (lines.length === 0) return null;
  const cursor: Cursor = { i: 0 };
  const value = parseBlockAt(lines, cursor, lines[0]?.indent ?? 0);
  if (cursor.i !== lines.length) {
    throw new YamlParseError(`could not parse the remainder starting at: ${lines[cursor.i]?.content}`);
  }
  return value;
}
