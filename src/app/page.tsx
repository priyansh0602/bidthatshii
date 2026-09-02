/**
 * page.tsx — Server Component (no 'use client' directive)
 *
 * Performs the initial spots fetch ON THE SERVER with a 5-second revalidation
 * window ({ next: { revalidate: 5 } }). This means:
 *   - The very first page load is served with SSR-rendered spot data — no
 *     client-side loading spinner for the initial render.
 *   - Subsequent requests within the same 5-second window are served from
 *     Next.js's server-side cache, reducing round-trips to Supabase.
 *   - After hydration, the realtime subscription in useRealtimeSpots takes over
 *     and keeps data fully live — the cache only applies to the SSR paint.
 *
 * Gracefully falls back to an empty array if the fetch fails; the client
 * component will then do a full client-side fetch as it did before.
 */

import ActionFigureClient from './ActionFigureClient';
import type { Spot } from '@/types/spot';

/**
 * Fetches the initial list of spots server-side with a short revalidation cache.
 * Uses the Supabase REST API directly via fetch() so Next.js can intercept and
 * cache the response. The anon key is safe to use here because RLS allows reads.
 *
 * revalidate: 5 — Next.js will serve a cached version for up to 5 seconds before
 * revalidating in the background (stale-while-revalidate semantics).
 */
async function fetchInitialSpots(): Promise<Spot[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[page] Missing Supabase env vars — skipping server-side spots fetch');
    return [];
  }

  try {
    // Supabase REST endpoint for the spots table, ordered alphabetically.
    const url = `${supabaseUrl}/rest/v1/spots?select=*&order=display_name.asc`;

    const res = await fetch(url, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      // 5-second revalidation window: cached on the server, revalidated in
      // the background when stale. Only applies to this server-side fetch —
      // the realtime subscription that runs after hydration is always live.
      next: { revalidate: 5 },
    });

    if (!res.ok) {
      console.error(`[page] Supabase REST fetch failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    console.log(`[page] Server-side spots fetch OK — ${Array.isArray(data) ? data.length : 0} rows (cached, revalidate: 5s)`);
    return Array.isArray(data) ? (data as Spot[]) : [];
  } catch (err) {
    console.error('[page] Exception during server-side spots fetch:', err);
    return [];
  }
}

export default async function ActionFigurePage() {
  // This fetch is cached by Next.js for up to 5 seconds server-side.
  const initialSpots = await fetchInitialSpots();

  return <ActionFigureClient initialSpots={initialSpots} />;
}
