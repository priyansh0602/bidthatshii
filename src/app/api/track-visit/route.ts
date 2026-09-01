import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/track-visit
 *
 * Secure server-side proxy for the `increment_visit_count` Postgres function.
 * The anon/authenticated roles no longer have EXECUTE permission on
 * `increment_visit_count` — only the service_role key (used here) can call it.
 *
 * Body: {} (empty — the real client IP is extracted from request headers
 *            server-side, so the client doesn't need to send an identifier)
 *
 * Response: { total_visits: number } — the updated total after incrementing,
 *           so the caller can update its local state without a separate fetch.
 *
 * Rate-limiting: IP-based via check_rate_limit (5 req / 60 s per IP).
 * If the IP is rate-limited the endpoint still returns 200 with the
 * current total (read from site_stats) so the UI stays correct.
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

/** Reads the current total_visits from site_stats without incrementing. */
async function getCurrentTotalVisits(): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('site_stats')
    .select('total_visits')
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.total_visits as number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);

  // ── 1. Rate limiting ───────────────────────────────────────────────────────
  try {
    const { data: rateLimitData, error: rateLimitError } = await supabaseAdmin.rpc(
      'check_rate_limit',
      {
        p_identifier: clientIp,
        p_action: 'track_visit',
        p_max_requests: 5,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error('[track-visit] Rate limit check error:', rateLimitError.message);
      // Fail open — attempt the increment anyway
    } else if (rateLimitData === false) {
      // Rate limited — return the current total without incrementing
      const currentTotal = await getCurrentTotalVisits();
      return NextResponse.json({ total_visits: currentTotal });
    }
  } catch (err) {
    console.error('[track-visit] Unexpected error during rate limit check:', err);
  }

  // ── 2. Call increment_visit_count via service_role admin client ───────────
  try {
    const { data, error } = await supabaseAdmin.rpc('increment_visit_count', {
      p_identifier: clientIp,
    });

    if (error) {
      console.error('[track-visit] RPC error:', error.message);
      // Return current total as fallback
      const currentTotal = await getCurrentTotalVisits();
      return NextResponse.json({ total_visits: currentTotal });
    }

    // The RPC returns the updated total_visits count directly
    return NextResponse.json({ total_visits: data as number });
  } catch (err) {
    console.error('[track-visit] Unexpected error calling increment_visit_count:', err);
    const currentTotal = await getCurrentTotalVisits();
    return NextResponse.json({ total_visits: currentTotal });
  }
}
