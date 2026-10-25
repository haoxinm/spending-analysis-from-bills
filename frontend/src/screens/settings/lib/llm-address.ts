import type { LlmSettings } from "./hooks";

type ApiFormat = LlmSettings["api_format"];

const DEFAULT_PATHS: Record<ApiFormat, string> = {
  openai_chat: "/v1/chat/completions",
  openai_responses: "/v1/responses",
  anthropic_messages: "/v1/messages",
};

export function hostnameOf(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Mirrors the backend: localhost, 127.*, ::1 and *.localhost are local; everything else is remote. */
export function isLocalAddress(baseUrl: string): boolean {
  const host = hostnameOf(baseUrl).replace(/^\[|\]$/g, "");
  if (!host) return false;
  return host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.") || host === "::1";
}

/** The URL requests go to: base URL without trailing slash + (path or the format's default path). */
export function resolveUrl(baseUrl: string, format: ApiFormat, path: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return "";
  const custom = path.trim();
  if (custom) return base + (custom.startsWith("/") ? custom : `/${custom}`);
  const def = DEFAULT_PATHS[format];
  if (base.endsWith("/v1") && def.startsWith("/v1")) base = base.slice(0, -3);
  return base + def;
}

