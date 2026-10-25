/**
 * Per-viewer conveniences for the Import screen, all `localStorage`-backed and all optional:
 * losing them just means the user re-picks a user or sees one extra confirmation click. Never
 * used for anything the server needs to know (D4's sticky user default and A22's per-issuer
 * skip-confirmation live only here; the server-side "remembered spec" is `issuers.default_spec_id`,
 * §2f.3, set via `ExtractRequest.remember`).
 *
 * Every accessor is wrapped in try/catch (private browsing, blocked storage, SSR) per the
 * artifact/browser-storage rule this app follows generally: storage failures never break render.
 */

const STICKY_USER_KEY = "spend-analyzer:import:sticky-user-id";
const SKIP_CONFIRM_KEY = "spend-analyzer:import:skip-confirm-issuer-ids";

export function getStickyUserId(): number | null {
  try {
    const raw = window.localStorage.getItem(STICKY_USER_KEY);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setStickyUserId(userId: number): void {
  try {
    window.localStorage.setItem(STICKY_USER_KEY, String(userId));
  } catch {
    // Ignore: this is a convenience, not a requirement.
  }
}

function readSkipConfirmIds(): number[] {
  try {
    const raw = window.localStorage.getItem(SKIP_CONFIRM_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === "number");
  } catch {
    return [];
  }
}

/** Whether the "don't ask again" toggle is on for `issuerId` (A22: collapses the confirmation
 * step to zero clicks for a confident proposal from this issuer). */
export function isSkipConfirmForIssuer(issuerId: number): boolean {
  return readSkipConfirmIds().includes(issuerId);
}

export function setSkipConfirmForIssuer(issuerId: number, skip: boolean): void {
  try {
    const current = new Set(readSkipConfirmIds());
    if (skip) {
      current.add(issuerId);
    } else {
      current.delete(issuerId);
    }
    window.localStorage.setItem(SKIP_CONFIRM_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // Ignore: this is a convenience, not a requirement.
  }
}
