/** Parses "1-3,5" into sorted unique page numbers within 1..max; null if malformed/out of range. */
export function parsePageRanges(text: string, max: number): number[] | null {
  const pages = new Set<number>();
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(trimmed);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end < start || end > max) return null;
    for (let n = start; n <= end; n += 1) pages.add(n);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Formats [1,2,3,5] as "1-3,5". */
export function formatPageRanges(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] as number) + 1) j += 1;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(",");
}
