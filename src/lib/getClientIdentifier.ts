/**
 * getClientIdentifier.ts
 *
 * Returns a stable, per-browser-session identifier to use as a rate-limiting
 * key when calling Supabase RPC functions (place_bid, increment_click,
 * increment_visit_count).
 *
 * IMPORTANT — LIMITATION:
 * This is NOT a true IP-based rate limit. Because BidThatShii calls Supabase
 * directly from the browser (client-side) rather than routing through a
 * Next.js API route, we have no access to the real client IP at the point of
 * the RPC call. A UUID stored in sessionStorage is a practical substitute that
 * provides basic abuse protection against a single browser session hammering
 * the API. A determined user can bypass it by clearing sessionStorage or
 * opening a private window. For true IP-based enforcement the bids / tracking
 * calls would need to be proxied through a server-side API route (similar to
 * /api/fetch-logo) where `request.headers` exposes the real IP.
 */

const SESSION_ID_KEY = 'af_session_id';

/**
 * Returns the session identifier, creating and persisting a new UUID v4 on
 * the first call within a browser session.
 *
 * Safe to call in SSR/Edge contexts — falls back to a runtime-generated
 * one-off string if sessionStorage is unavailable (server-side rendering,
 * private-mode restrictions, etc.).
 */
export function getClientIdentifier(): string {
  if (typeof sessionStorage === 'undefined') {
    // SSR or restricted environment — return a non-persistent placeholder.
    // Server-side rendering should not normally reach RPC calls, but this
    // guard prevents a hard crash just in case.
    return 'ssr-unknown';
  }

  const existing = sessionStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;

  // Generate a UUID v4 using the Web Crypto API (available in all modern
  // browsers and Node >= 14.17 / Edge runtimes).
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : // Fallback for very old environments
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });

  sessionStorage.setItem(SESSION_ID_KEY, id);
  return id;
}
