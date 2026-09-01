import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/track-click
 *
 * Secure server-side proxy for the `increment_click` Postgres function.
 * The anon/authenticated roles no longer have EXECUTE permission on
 * `increment_click` — only the service_role key (used here) can call it.
 *
 * Body: { spotId, advertiserUrl }
 *
 * Fire-and-forget semantics: always returns 200 to the client so that
 * a click tracking failure never blocks navigation. Errors are logged
 * server-side only.
 *
 * Rate-limiting: IP-based via check_rate_limit (5 req / 60 s per IP).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  let body: { spotId?: unknown; advertiserUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    // Fire-and-forget: return 200 even for malformed requests (just log)
    console.error('[track-click] Invalid JSON body');
    return NextResponse.json({ ok: true });
  }

  const { spotId, advertiserUrl } = body;

  if (!spotId || !advertiserUrl) {
    console.error('[track-click] Missing spotId or advertiserUrl');
    return NextResponse.json({ ok: true });
  }

  // ── 2. Extract real client IP ──────────────────────────────────────────────
  const clientIp = getClientIp(req);

  // ── 3. Rate limiting ───────────────────────────────────────────────────────
  try {
    const { data: rateLimitData, error: rateLimitError } = await supabaseAdmin.rpc(
      'check_rate_limit',
      {
        p_identifier: clientIp,
        p_action: 'track_click',
        p_max_requests: 5,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error('[track-click] Rate limit check error:', rateLimitError.message);
      // Fail open
    } else if (rateLimitData === false) {
      // Rate limited — silently accept from the client's perspective
      // (no need to surface this; clicks are fire-and-forget)
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    console.error('[track-click] Unexpected error during rate limit check:', err);
  }

  // ── 4. Call increment_click via service_role admin client ─────────────────
  try {
    const { error } = await supabaseAdmin.rpc('increment_click', {
      p_spot_id: spotId,
      p_advertiser_id_url: advertiserUrl,
      p_identifier: clientIp,
    });

    if (error) {
      console.error('[track-click] RPC error:', error.message);
    }
  } catch (err) {
    console.error('[track-click] Unexpected error calling increment_click:', err);
  }

  // Always return 200 — click tracking failure must never block the user
  return NextResponse.json({ ok: true });
}
