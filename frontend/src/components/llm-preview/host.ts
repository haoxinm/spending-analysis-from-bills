/** `https://api.example.com/v1` -> `api.example.com` (the input when it is not a URL). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
