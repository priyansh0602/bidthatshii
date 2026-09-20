
/**
 * Tracks a click on an advertiser's winning spot logo.
 *
 * Fire-and-forget: calls the server-side `/api/track-click` route which uses
 * the service_role key and real IP-based rate limiting. Errors are logged
 * server-side; this function never blocks navigation.
 *
 * NOTE: getClientIdentifier is no longer used here — rate limiting is now
 * enforced server-side based on real IP, not a client-controlled session UUID.
 */
export async function trackClick(spotId: string, advertiserUrl: string): Promise<void> {
  try {
    await fetch('/api/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotId, advertiserUrl }),
    });
  } catch (err) {
    // Fire-and-forget: swallow network errors silently on the client side.
    // Errors are logged server-side via the API route.
    console.error('[trackClick] Failed to call /api/track-click:', err);
  }
}
