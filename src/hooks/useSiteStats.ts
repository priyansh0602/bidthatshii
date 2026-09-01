import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
// NOTE: getClientIdentifier is intentionally NOT imported here.
// Visit counting now routes through /api/track-visit (server-side)
// where rate limiting is enforced via the real client IP address.

/**
 * Custom React hook for tracking the site's total visit count.
 *
 * On the first call within a browser session (guarded by sessionStorage so
 * React Strict Mode's double-invocation and normal re-renders never fire it
 * twice), it calls `supabase.rpc('increment_visit_count')` to record the
 * visit and retrieve the updated total.
 *
 * It also subscribes to Supabase Realtime postgres_changes on the
 * `site_stats` table so the displayed number updates live whenever ANY
 * user's visit increments it — no refresh required.
 *
 * Returns:
 *   - `totalVisits` — the current visit count (null while loading)
 *   - `visitsLoading` — true until the initial RPC / fetch response arrives
 */

const SESSION_KEY = 'af_visit_counted';

export function useSiteStats() {
  // null = not yet loaded; number = resolved count
  const [totalVisits, setTotalVisits] = useState<number | null>(null);
  const [visitsLoading, setVisitsLoading] = useState<boolean>(true);

  // Prevents the RPC from firing more than once even if the effect runs
  // twice (React Strict Mode) before sessionStorage is written.
  const hasIncremented = useRef<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    // Unique suffix per mount — same pattern as useRealtimeSpots — so React
    // Strict Mode's cleanup + re-mount never reuses a channel that is still
    // in SUBSCRIBED state inside Supabase's internal registry.
    const mountId = Math.random().toString(36).substring(2, 8);
    const channelName = `site-stats-realtime-${mountId}`;

    console.log(`[useSiteStats] Mounting with channel: ${channelName}`);

    // ── 1. Increment once per browser session ─────────────────────────────
    const initVisitCount = async () => {
      const alreadyCounted =
        hasIncremented.current ||
        (typeof sessionStorage !== 'undefined' &&
          sessionStorage.getItem(SESSION_KEY) === '1');

      if (alreadyCounted) {
        // Session already counted — just fetch the current total without
        // incrementing so the number stays correct after soft-navigations.
        console.log('[useSiteStats] Session already counted — fetching current total only');
        try {
          const { data, error } = await supabase
            .from('site_stats')
            .select('total_visits')
            .limit(1)
            .single();

          if (error) {
            console.error('[useSiteStats] Fetch-only error:', error.message);
          } else if (data && isMounted) {
            console.log('[useSiteStats] Fetched total_visits (no increment):', data.total_visits);
            setTotalVisits(data.total_visits as number);
          }
        } catch (err) {
          console.error('[useSiteStats] Exception during fetch-only:', err);
        } finally {
          if (isMounted) setVisitsLoading(false);
        }
        return;
      }

      // Mark as incremented immediately (in-memory) so the Strict Mode
      // second invocation skips before sessionStorage is written.
      hasIncremented.current = true;

      console.log('[useSiteStats] New session — calling /api/track-visit');
      try {
        // Route through the server-side API route so rate limiting uses the
        // real client IP (not a client-controlled session UUID) and the
        // service_role key is kept server-side only.
        const response = await fetch('/api/track-visit', { method: 'POST' });
        const json = await response.json();
        const total = json?.total_visits;

        if (typeof total === 'number') {
          console.log('[useSiteStats] /api/track-visit returned total_visits:', total);
          if (isMounted) {
            setTotalVisits(total);
          }
          // Persist the flag so subsequent re-renders / soft-navigations in
          // the same browser tab don't increment again.
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(SESSION_KEY, '1');
          }
        } else {
          console.warn('[useSiteStats] /api/track-visit returned unexpected shape:', json);
        }
      } catch (err) {
        console.error('[useSiteStats] Exception calling /api/track-visit:', err);
      } finally {
        if (isMounted) setVisitsLoading(false);
      }
    };

    initVisitCount();

    // ── 2. Subscribe to realtime changes on `site_stats` ─────────────────
    const statsChannel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'site_stats',
        },
        (payload) => {
          if (!isMounted) return;
          const updated = payload.new as { total_visits?: number };
          if (typeof updated.total_visits === 'number') {
            console.log('[useSiteStats] Realtime UPDATE — new total_visits:', updated.total_visits);
            setTotalVisits(updated.total_visits);
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[useSiteStats] channel (${channelName}) status:`, status, err || '');
        if (status === 'SUBSCRIBED') {
          console.log('[useSiteStats] ✅ site_stats realtime channel SUBSCRIBED — live updates active');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[useSiteStats] ⚠️ site_stats realtime channel reached status: ${status}`);
        }
      });

    // ── 3. Cleanup ────────────────────────────────────────────────────────
    return () => {
      isMounted = false;
      console.log(`[useSiteStats] Unmounting — removing channel: ${channelName}`);
      supabase.removeChannel(statsChannel);
    };
  }, []);

  return { totalVisits, visitsLoading };
}
