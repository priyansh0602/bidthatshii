export interface PlaceBidResult {
  success: boolean;
  charged: number;
  new_total: number;
  new_highest: number;
  message: string;
}

/**
 * Places a bid on a spot by calling the server-side `/api/place-bid` route,
 * which in turn calls the `place_bid` Postgres function via the Supabase
 * service_role key.
 *
 * The browser no longer calls Supabase directly — anon/authenticated execute
 * permission on `place_bid` has been revoked. Rate limiting is enforced
 * server-side based on the real client IP address.
 *
 * Keeps the same public signature so BidModal.tsx requires no changes.
 */
export async function placeBid(
  spotId: string,
  advertiserUrl: string,
  logoUrl: string,
  paymentReference?: string,
  customAmount?: number
): Promise<PlaceBidResult> {
  try {
    const body: Record<string, unknown> = {
      spotId,
      advertiserUrl,
      logoUrl,
      paymentReference: paymentReference ?? null,
    };

    if (customAmount !== undefined && customAmount !== null) {
      body.customAmount = customAmount;
    }

    const response = await fetch('/api/place-bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (response.status === 429) {
      return {
        success: false,
        charged: 0,
        new_total: 0,
        new_highest: 0,
        message: data.error ?? 'Too many requests. Please wait a moment and try again.',
      };
    }

    if (!response.ok && !('success' in data)) {
      return {
        success: false,
        charged: 0,
        new_total: 0,
        new_highest: 0,
        message: data.error ?? 'An unexpected error occurred.',
      };
    }

    return {
      success: Boolean(data.success),
      charged: Number(data.charged ?? 0),
      new_total: Number(data.new_total ?? 0),
      new_highest: Number(data.new_highest ?? 0),
      message: String(data.message ?? ''),
    };
  } catch (err) {
    console.error('[placeBid] Network or parse error:', err);
    return {
      success: false,
      charged: 0,
      new_total: 0,
      new_highest: 0,
      message: 'Network error — please check your connection and try again.',
    };
  }
}

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
