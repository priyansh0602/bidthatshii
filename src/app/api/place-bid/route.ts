import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/place-bid
 *
 * Secure server-side proxy for the `place_bid` Postgres function.
 * The anon/authenticated roles no longer have EXECUTE permission on
 * `place_bid` — only the service_role key (used here) can call it.
 *
 * Body: { spotId, advertiserUrl, logoUrl, paymentReference?, customAmount? }
 *
 * Rate-limiting: checks `check_rate_limit` via the admin client using the
 * real client IP as the identifier (max 5 requests per 60 seconds).
 * IP-based limiting cannot be bypassed by clearing browser storage.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the real client IP from standard reverse-proxy headers.
 * Order of preference: Cloudflare → X-Forwarded-For → X-Real-IP → fallback.
 */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ── 1. Parse body ─────────────────────────────────────────────────────────
  let body: {
    spotId?: unknown;
    advertiserUrl?: unknown;
    logoUrl?: unknown;
    paymentReference?: unknown;
    customAmount?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { spotId, advertiserUrl, logoUrl, paymentReference, customAmount } = body;

  if (!spotId || typeof spotId !== 'string') {
    return NextResponse.json({ error: 'spotId is required.' }, { status: 400 });
  }
  if (!advertiserUrl || typeof advertiserUrl !== 'string') {
    return NextResponse.json({ error: 'advertiserUrl is required.' }, { status: 400 });
  }
  if (!logoUrl || typeof logoUrl !== 'string') {
    return NextResponse.json({ error: 'logoUrl is required.' }, { status: 400 });
  }

  // ── 2. Extract real client IP ──────────────────────────────────────────────
  const clientIp = getClientIp(req);

  // ── 3. Server-side rate limiting via check_rate_limit Postgres function ────
  try {
    const { data: rateLimitData, error: rateLimitError } = await supabaseAdmin.rpc(
      'check_rate_limit',
      {
        p_identifier: clientIp,
        p_action: 'place_bid',
        p_max_requests: 5,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      // Log server-side only; don't leak internals to client
      console.error('[place-bid] Rate limit check error:', rateLimitError.message);
      // Fail open — let the bid through rather than blocking on a rate-limit check failure
    } else if (rateLimitData === false) {
      return NextResponse.json(
        { error: 'Too many requests — please wait a moment and try again.' },
        { status: 429 }
      );
    }
  } catch (err) {
    console.error('[place-bid] Unexpected error during rate limit check:', err);
    // Fail open
  }

  // ── 4. Call place_bid via service_role admin client ────────────────────────
  const rpcParams: Record<string, unknown> = {
    p_spot_id: spotId,
    p_advertiser_url: advertiserUrl,
    p_logo_url: logoUrl,
    p_payment_reference: paymentReference ?? null,
    p_identifier: clientIp,
  };

  if (customAmount !== undefined && customAmount !== null) {
    rpcParams.p_custom_amount = customAmount;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('place_bid', rpcParams);

    if (error) {
      console.error('[place-bid] RPC error:', error.message);
      return NextResponse.json(
        {
          success: false,
          charged: 0,
          new_total: 0,
          new_highest: 0,
          message: error.message,
        },
        { status: 400 }
      );
    }

    const result = Array.isArray(data) ? data[0] : data;

    // Distinguish business-logic failures (success=false) from system errors
    const httpStatus = result?.success ? 200 : 400;

    return NextResponse.json(
      {
        success: Boolean(result?.success),
        charged: Number(result?.charged ?? 0),
        new_total: Number(result?.new_total ?? 0),
        new_highest: Number(result?.new_highest ?? 0),
        message: String(result?.message ?? ''),
      },
      { status: httpStatus }
    );
  } catch (err) {
    console.error('[place-bid] Unexpected error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
