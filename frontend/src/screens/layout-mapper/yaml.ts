import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from "yaml";

import type { LayoutSpecObject } from "./spec-types";

/**
 * YAML read/write for layout specs, backed by the `yaml` package (ISC — see `package.json` and
 * the P3-SHELL report) instead of this module's former hand-rolled block/flow reader. `yaml` is
 * a full parser (anchors, block scalars, multi-document streams, everything this module used to
 * degrade on), so a pasted spec that used one of those constructs now parses correctly instead
 * of falling back to "validate on save" only.
 *
 * The backend reads specs with `yaml.safe_load`, a real parser too, so this module's own reader
 * and the server's now agree on exactly the same YAML dialect.
 */

/** Thrown by `parseYamlish` on malformed input — kept as this module's own error type (rather
 * than re-exporting `YAMLParseError` directly) so call sites do not depend on the underlying
 * library's error class. */
export class YamlParseError extends Error {}

/**
 * Renders a spec object as YAML. Top-level key order follows the spec's own field order for
 * readability (`sortMapEntries: false`, the library's default).
 */
export function stringifySpec(spec: LayoutSpecObject): string {
  return stringifyYaml(spec);
}

/**
 * Parses `text` into a plain JS value, via `yaml`'s `parse` (a full YAML 1.2 parser). Throws
 * `YamlParseError` on malformed input.
 */
export function parseYamlish(text: string): unknown {
  try {
    return parseYaml(text);
  } catch (exc) {
    if (exc instanceof YAMLParseError) throw new YamlParseError(exc.message);
    throw exc;
  }
}
