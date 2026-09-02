import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Spot } from '@/types/spot';

/**
 * Custom React hook for fetching and subscribing to real-time updates on `spots` and `contributions` (clicks).
 *
 * Uses SHARED, fixed channel names so all connected browser tabs share the same
 * Supabase Realtime subscription multiplexed over a single WebSocket connection,
 * reducing load on Supabase's Realtime service.
 *
 * React Strict Mode double-invocation is handled by calling removeChannel() SYNCHRONOUSLY
 * in the cleanup function (not inside a Promise .then()), mirroring the pattern used in
 * usePresence.ts. This ensures the channel is removed from Supabase's internal registry
 * before the second invocation runs supabase.channel() again.
 */

// Fixed shared channel names — all tabs use the same channel so Supabase
// can multiplex their subscriptions over a single connection.
const SPOTS_CHANNEL_NAME = 'spots-realtime-shared';
const CONTRIBS_CHANNEL_NAME = 'contributions-realtime-shared';

export function useRealtimeSpots(initialSpots?: Spot[]) {
  const [spots, setSpots] = useState<Spot[]>(initialSpots ?? []);
  const [clicksMap, setClicksMap] = useState<Record<string, number>>({});
  // If initialSpots were provided by the server, skip the client-side loading state.
  const [loading, setLoading] = useState<boolean>(!initialSpots || initialSpots.length === 0);

  useEffect(() => {
    let isMounted = true;

    console.log(`[useRealtimeSpots] Mounting with channels: ${SPOTS_CHANNEL_NAME}, ${CONTRIBS_CHANNEL_NAME}`);

    // 1. Initial fetch of spots and contribution click counts.
    // If the server already provided initialSpots, only fetch contributions (clicks map) —
    // the spots data is already populated, so no need to re-fetch on the client.
    const fetchInitialData = async () => {
      if (!initialSpots || initialSpots.length === 0) {
        // No server-provided data — fetch everything client-side.
        setLoading(true);
        console.log('[useRealtimeSpots] No initialSpots — starting full client-side data fetch...');
        try {
          const [spotsRes, contribsRes] = await Promise.all([
            supabase.from('spots').select('*').order('display_name', { ascending: true }),
            supabase.from('contributions').select('spot_id, advertiser_id_url, clicks'),
          ]);

          if (spotsRes.error) {
            console.error('[useRealtimeSpots] Spots fetch error:', spotsRes.error.message);
          } else {
            console.log(`[useRealtimeSpots] Initial spots fetch OK — ${spotsRes.data?.length ?? 0} rows`);
          }

          if (spotsRes.data && isMounted) {
            setSpots(spotsRes.data as Spot[]);
          }

          if (contribsRes.data && isMounted) {
            const map: Record<string, number> = {};
            contribsRes.data.forEach((c) => {
              if (c.spot_id) {
                if (c.advertiser_id_url) {
                  map[`${c.spot_id}:${c.advertiser_id_url}`] = c.clicks || 0;
                }
                map[c.spot_id] = (map[c.spot_id] || 0) + (c.clicks || 0);
              }
            });
            setClicksMap(map);
          }
        } catch (err) {
          console.error('[useRealtimeSpots] Exception during initial fetch:', err);
        } finally {
          if (isMounted) {
            setLoading(false);
            console.log('[useRealtimeSpots] Initial fetch complete, loading = false');
          }
        }
      } else {
        // Server provided initialSpots — only fetch contributions (clicks map).
        console.log(`[useRealtimeSpots] initialSpots provided (${initialSpots.length} spots) — fetching contributions only`);
        try {
          const contribsRes = await supabase
            .from('contributions')
            .select('spot_id, advertiser_id_url, clicks');

          if (contribsRes.data && isMounted) {
            const map: Record<string, number> = {};
            contribsRes.data.forEach((c) => {
              if (c.spot_id) {
                if (c.advertiser_id_url) {
                  map[`${c.spot_id}:${c.advertiser_id_url}`] = c.clicks || 0;
                }
                map[c.spot_id] = (map[c.spot_id] || 0) + (c.clicks || 0);
              }
            });
            setClicksMap(map);
          }
        } catch (err) {
          console.error('[useRealtimeSpots] Exception fetching contributions:', err);
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      }
    };

    fetchInitialData();

    // 2. Subscribe to Supabase Realtime postgres_changes for `spots`
    const spotsChannel = supabase
      .channel(SPOTS_CHANNEL_NAME)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'spots',
        },
        (payload) => {
          console.log('[useRealtimeSpots] spots postgres_changes payload received:', payload.eventType, payload);
          if (!isMounted) return;

          if (payload.eventType === 'UPDATE') {
            const updatedSpot = payload.new as Spot;
            console.log('[useRealtimeSpots] Applying UPDATE to spot:', updatedSpot.id, updatedSpot.display_name);
            setSpots((prevSpots) =>
              prevSpots.map((spot) =>
                spot.id === updatedSpot.id ? { ...spot, ...updatedSpot } : spot
              )
            );
          } else if (payload.eventType === 'INSERT') {
            const newSpot = payload.new as Spot;
            setSpots((prevSpots) => [...prevSpots, newSpot]);
          } else if (payload.eventType === 'DELETE') {
            const deletedSpot = payload.old as Partial<Spot>;
            setSpots((prevSpots) =>
              prevSpots.filter((spot) => spot.id !== deletedSpot.id)
            );
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[useRealtimeSpots] spots channel (${SPOTS_CHANNEL_NAME}) status:`, status, err || '');
        if (status === 'SUBSCRIBED') {
          console.log('[useRealtimeSpots] ✅ Spots realtime channel SUBSCRIBED — live updates active');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[useRealtimeSpots] ⚠️ Spots realtime channel reached status: ${status}. Live updates may not work.`);
        }
      });

    // 3. Subscribe to Supabase Realtime postgres_changes for `contributions` to update clicks live
    const contribsChannel = supabase
      .channel(CONTRIBS_CHANNEL_NAME)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contributions',
        },
        (payload) => {
          if (!isMounted) return;

          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const c = payload.new as { spot_id: string; advertiser_id_url: string; clicks: number };
            if (c.spot_id) {
              console.log('[useRealtimeSpots] contributions UPDATE/INSERT — updating clicks for spot:', c.spot_id, 'clicks:', c.clicks);
              setClicksMap((prev) => ({
                ...prev,
                [`${c.spot_id}:${c.advertiser_id_url}`]: c.clicks || 0,
                [c.spot_id]: c.clicks || 0,
              }));
            }
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[useRealtimeSpots] contributions channel (${CONTRIBS_CHANNEL_NAME}) status:`, status, err || '');
        if (status === 'SUBSCRIBED') {
          console.log('[useRealtimeSpots] ✅ Contributions realtime channel SUBSCRIBED');
        }
      });

    // 4. Cleanup on unmount.
    // IMPORTANT: call removeChannel() SYNCHRONOUSLY (not inside a Promise.then()).
    // This ensures the channel is removed from Supabase's internal registry immediately
    // so React Strict Mode's second invocation of supabase.channel() gets a fresh
    // channel object rather than the stale subscribed one — same pattern as usePresence.ts.
    return () => {
      isMounted = false;
      console.log(`[useRealtimeSpots] Unmounting — removing channels: ${SPOTS_CHANNEL_NAME}, ${CONTRIBS_CHANNEL_NAME}`);
      supabase.removeChannel(spotsChannel);
      supabase.removeChannel(contribsChannel);
    };
  }, []);

  return { spots, clicksMap, loading };
}
