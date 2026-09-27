/**
 * Setting or clearing the LLM provider's API key.
 *
 * The key is Keychain-backed (I7) and **write-only**: `GET /api/settings` never returns it
 * (only `has_key`, §3.7/§3.10), and this screen never displays a previously-saved key.
 *
 * CONTRACT GAP (§0.6 change request): the frozen HTTP surface (§3.12) and the checked-in
 * `openapi.json` have no route to *set* a key — `spend_analyzer.config.set_api_key` /
 * `delete_api_key` exist (P0-2) and are wired into `POST /api/settings/test-llm`, but no
 * router exposes a write endpoint (see the docstring of
 * `src/spend_analyzer/api/routers/settings.py`, which says this explicitly: "Settings UI work
 * is Phase 3"). This module calls the endpoints below, which do not exist yet on `main`:
 *
 *   PUT    /api/settings/api-key   body {provider, api_key} -> 204
 *   DELETE /api/settings/api-key?provider=<provider> -> 204
 *
 * They are not in `schema.d.ts`, so they are called with a plain `fetch` (not the typed
 * `apiClient`) rather than inventing an untyped escape hatch on the shared client, which P3-E
 * does not own. Reported to the orchestrator as a contract change request; until the router
 * gains these routes, both calls resolve as HTTP errors that the UI surfaces via toast.
 */

function readSpendToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const meta = document.querySelector('meta[name="spend-token"]');
  return meta?.getAttribute("content") ?? undefined;
}

function apiKeyUrl(query?: string): string {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL("/api/settings/api-key", origin);
  if (query) url.search = query;
  return url.toString();
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      return String(body.detail);
    }
  } catch {
    // fall through to the status-based message below
  }
  return `${response.status} ${response.statusText}`;
}

function jsonHeaders(): HeadersInit {
  const token = readSpendToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { "X-Spend-Token": token } : {}),
  };
}

/** Writes a new API key for `provider` to the Keychain. Never resolves with the key's value. */
export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  const response = await fetch(apiKeyUrl(), {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
}

/** Removes the stored API key for `provider` from the Keychain. */
export async function clearApiKey(provider: string): Promise<void> {
  const response = await fetch(apiKeyUrl(`provider=${encodeURIComponent(provider)}`), {
    method: "DELETE",
    headers: jsonHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
}
