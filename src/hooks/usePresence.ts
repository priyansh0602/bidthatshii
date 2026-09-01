import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Custom React hook for tracking live visitor presence count via Supabase Realtime Presence.
 *
 * ALL browser tabs must join the SAME fixed channel name ("site-presence") so they can see
 * each other in the shared presence state. The unique identity per tab is the sessionId used
 * as the presence key in channel.track() — the channel name itself must NOT be unique per tab.
 *
 * React Strict Mode double-invocation is handled by making the cleanup synchronous:
 * supabase.removeChannel() is called immediately (not inside a Promise .then()), so the
 * channel is removed from Supabase's internal registry before the second invocation runs
 * supabase.channel() again, ensuring a fresh channel is created on each real mount.
 */
export function usePresence() {
  const [watchingCount, setWatchingCount] = useState<number>(1);

  // We keep a ref to the channel so the cleanup function always has access to the
  // exact same channel object that was created in this particular effect invocation.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Each TAB gets a unique session key so it appears as a distinct presence entry.
    // This MUST stay unique per tab — but the CHANNEL NAME must stay fixed and shared.
    const sessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `session_${Math.random().toString(36).substring(2, 9)}`;

    console.log('[usePresence] Mounting. Session ID (presence key):', sessionId);

    // FIXED shared channel name — all tabs must use the identical string.
    const channel = supabase.channel('site-presence', {
      config: {
        presence: {
          key: sessionId,
        },
      },
    });

    channelRef.current = channel;

    const syncPresenceCount = () => {
      if (!isMounted) return;
      const state = channel.presenceState();
      console.log('[usePresence] Syncing presence state:', state);

      let totalCount = 0;
      Object.keys(state).forEach((key) => {
        const presences = state[key];
        totalCount += Array.isArray(presences) ? presences.length : 1;
      });

      console.log(`[usePresence] Total watching count: ${totalCount}`);
      setWatchingCount(totalCount > 0 ? totalCount : 1);
    };

    // Register all presence event listeners BEFORE subscribe()
    channel
      .on('presence', { event: 'sync' }, () => {
        console.log('[usePresence] sync event');
        syncPresenceCount();
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('[usePresence] join event — key:', key, newPresences);
        syncPresenceCount();
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('[usePresence] leave event — key:', key, leftPresences);
        syncPresenceCount();
      });

    // subscribe() is called last, after all .on() handlers
    channel.subscribe(async (status, err) => {
      console.log('[usePresence] Channel status:', status, err || '');
      if (status === 'SUBSCRIBED') {
        console.log('[usePresence] ✅ SUBSCRIBED. Tracking session:', sessionId);
        try {
          const trackStatus = await channel.track({
            online_at: new Date().toISOString(),
            session_id: sessionId,
          });
          console.log('[usePresence] track() response:', trackStatus);
          syncPresenceCount();
        } catch (trackErr) {
          console.error('[usePresence] track() error:', trackErr);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn(`[usePresence] ⚠️ Channel reached status: ${status}`);
      }
    });

    return () => {
      isMounted = false;
      console.log('[usePresence] Cleanup — removing channel for session:', sessionId);

      // IMPORTANT: call removeChannel() SYNCHRONOUSLY (not inside a Promise.then()).
      // This ensures the channel is removed from Supabase's internal registry immediately,
      // so that React Strict Mode's second invocation of supabase.channel('site-presence')
      // gets a genuinely fresh channel object rather than the stale subscribed one.
      // untrack() fires-and-forgets so the server knows we left, but we don't wait for it.
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

  return { watchingCount };
}
