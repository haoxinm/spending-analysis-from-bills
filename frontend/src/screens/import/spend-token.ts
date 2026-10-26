/** The per-launch token the server injects as `<meta name="spend-token">`. */
export function readSpendToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const meta = document.querySelector('meta[name="spend-token"]');
  return meta?.getAttribute("content") ?? undefined;
}

/** URL of a page thumbnail. `<img>` cannot send headers, so the token rides in the query. */
export function pageImageUrl(statementId: number, pageNumber: number, width: number): string {
  const params = new URLSearchParams({ width: String(width) });
  const token = readSpendToken();
  if (token) params.set("token", token);
  return `/api/statements/${statementId}/pages/${pageNumber}/image?${params.toString()}`;
}

/** URL of a tax document page thumbnail (token in the query, like statements; `ownerId` is the
 * ownership check). */
export function taxPageImageUrl(documentId: number, pageNumber: number, width: number, ownerId?: number): string {
  const params = new URLSearchParams({ width: String(width) });
  if (ownerId !== undefined) params.set("user_id", String(ownerId));
  const token = readSpendToken();
  if (token) params.set("token", token);
  return `/api/tax/documents/${documentId}/pages/${pageNumber}/image?${params.toString()}`;
}
