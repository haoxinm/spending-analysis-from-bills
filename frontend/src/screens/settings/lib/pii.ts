import { apiClient, throwIfError } from "@/api/client";

/** Entries shorter than this are ignored by the server (a stray character must not redact
 * everything). Mirrors `MIN_ENTRY_LENGTH` in `core/pii.py`. */
export const MIN_PII_ENTRY_LENGTH = 2;

export type PiiEntryKind = "digits" | "text";

/** Client-side mirror of `core.pii.classify_entry`: "digits" when the entry has at least four
 * digits and otherwise only phone/number punctuation, else "text". Display only; the server
 * re-classifies every entry itself. */
export function classifyEntry(value: string): PiiEntryKind {
  const text = value.trim();
  const digits = (text.match(/\d/g) ?? []).length;
  return digits >= 4 && /^[\d\s\-.()+/]+$/.test(text) ? "digits" : "text";
}

export function entryKindLabel(value: string): string {
  return classifyEntry(value) === "digits" ? "Number / phone" : "Name / text";
}

/** `POST /settings/pii-test`: mask a pasted sample with the (possibly unsaved) entries. Purely
 * local; the server never sends anything anywhere. */
export async function testPii(text: string, terms: string[]) {
  const { data, error } = await apiClient.POST("/settings/pii-test", { body: { text, terms } });
  throwIfError(error);
  if (!data) throw new Error("pii-test returned no data");
  return data;
}
