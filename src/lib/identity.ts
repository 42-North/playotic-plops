/**
 * Pseudonymous browser identity used ONLY for contributions and votes.
 *
 * - Created lazily, the first time the visitor submits something. Browsing never creates it.
 * - 32 random bytes from the Web Crypto API; no device fingerprinting.
 * - Sent only to the Playotic Plops backend, which stores an HMAC of it, never the token itself.
 * - Clearing site data or switching browsers creates a new identity (documented on the privacy page).
 */
const KEY = 'playotic-plops.contributor-token.v1';
let memoryFallback: string | null = null;

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Existing token, if any. Never creates one. */
export function peekToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

export function getOrCreateToken(): string {
  const existing = peekToken();
  if (existing) return existing;
  const t = newToken();
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Storage blocked: keep it for this tab only.
  }
  memoryFallback = t;
  return t;
}

/** Lets a visitor drop their identity (privacy page). Future contributions start a new one. */
export function forgetToken(): void {
  memoryFallback = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
