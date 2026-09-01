import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Spot } from '@/types/spot';

/**
 * Custom React hook for fetching and subscribing to real-time updates on `spots` and `contributions` (clicks).
 *
 * Uses unique channel names per mount (via a random suffix) to prevent React Strict Mode's
 * double-invocation from reusing the same channel name after cleanup, which causes Supabase
 * to silently drop the second subscription without reaching SUBSCRIBED status.
 */
export function useRealtimeSpots() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [clicksMap, setClicksMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    // Unique suffix per mount so React Strict Mode double-invocations never reuse
    // the same channel name on a channel that was already subscribed + removed.
    const mountId = Math.random().toString(36).substring(2, 8);
    const spotsChannelName = `spots-realtime-${mountId}`;
    const contribsChannelName = `contributions-realtime-${mountId}`;

    console.log(`[useRealtimeSpots] Mounting with channels: ${spotsChannelName}, ${contribsChannelName}`);

    // 1. Initial fetch of spots and contribution click counts
    const fetchInitialData = async () => {
      setLoading(true);
      console.log('[useRealtimeSpots] Starting initial data fetch...');
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
    };

    fetchInitialData();

    // 2. Subscribe to Supabase Realtime postgres_changes for `spots`
    const spotsChannel = supabase
      .channel(spotsChannelName)
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
        console.log(`[useRealtimeSpots] spots channel (${spotsChannelName}) status:`, status, err || '');
        if (status === 'SUBSCRIBED') {
          console.log('[useRealtimeSpots] ✅ Spots realtime channel SUBSCRIBED — live updates active');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[useRealtimeSpots] ⚠️ Spots realtime channel reached status: ${status}. Live updates may not work.`);
        }
      });

    // 3. Subscribe to Supabase Realtime postgres_changes for `contributions` to update clicks live
    const contribsChannel = supabase
      .channel(contribsChannelName)
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
        console.log(`[useRealtimeSpots] contributions channel (${contribsChannelName}) status:`, status, err || '');
        if (status === 'SUBSCRIBED') {
          console.log('[useRealtimeSpots] ✅ Contributions realtime channel SUBSCRIBED');
        }
      });

    // 4. Cleanup on unmount
    return () => {
      isMounted = false;
      console.log(`[useRealtimeSpots] Unmounting — removing channels: ${spotsChannelName}, ${contribsChannelName}`);
      supabase.removeChannel(spotsChannel);
      supabase.removeChannel(contribsChannel);
    };
  }, []);

  return { spots, clicksMap, loading };
}
