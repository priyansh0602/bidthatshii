/**
 * /admin — Read-only internal admin dashboard.
 * Fetches from Supabase views: admin_total_revenue, admin_spot_summary
 * and the bid_events table (joined with spots for region names).
 *
 * Protected by middleware.ts — requires a valid Supabase Auth session
 * whose email matches ADMIN_EMAIL.
 * Renders as a React Server Component for zero client JS on data fetch.
 */
import { createClient } from '@supabase/supabase-js';
import { AdminTables } from './AdminTables';
import { LogoutButton } from './LogoutButton';
import type { SpotSummaryRow, BidEventRow } from './types';

// Force dynamic rendering so this route is never statically generated or
// served from Next.js's route cache.
export const dynamic = 'force-dynamic';

// Also disable Next.js's revalidation cache at the segment level so that
// navigating to /admin always triggers a fresh server render.
export const revalidate = 0;

async function fetchAdminData() {
  // Create the client inside the function (not at module scope) to avoid
  // TS language-server false positives when mixing server/client imports.
  //
  // The `global.fetch` override wraps every fetch the Supabase client makes
  // with `cache: 'no-store'`, bypassing Next.js's extended fetch cache.
  // Without this, Next.js can serve memoised/cached Supabase responses even
  // when `dynamic = 'force-dynamic'` is set, because that flag only controls
  // static generation — not the per-request fetch cache.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
    }
  );

  const [revenueRes, summaryRes, eventsRes] = await Promise.all([
    supabase.from('admin_total_revenue').select('*').single(),
    supabase.from('admin_spot_summary').select('*'),
    supabase
      .from('bid_events')
      .select('id, created_at, advertiser_url, amount_charged, new_total, spots(display_name)')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const totalRevenue: number =
    (revenueRes.data as { total_revenue?: number } | null)?.total_revenue ?? 0;

  const spotSummary: SpotSummaryRow[] = (summaryRes.data ?? []) as SpotSummaryRow[];

  // Flatten spots join from bid_events.
  // Supabase returns joined relations as arrays even for single-row joins,
  // so we cast spots as an array and take the first element.
  const bidEvents: BidEventRow[] = ((eventsRes.data ?? []) as Array<{
    id: string;
    created_at: string;
    advertiser_url: string;
    amount_charged: number;
    new_total: number;
    spots: { display_name: string }[] | null;
  }>).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    region_name: Array.isArray(row.spots) ? (row.spots[0]?.display_name ?? 'Unknown') : 'Unknown',
    advertiser_url: row.advertiser_url,
    amount_charged: row.amount_charged,
    new_total: row.new_total,
  }));

  return { totalRevenue, spotSummary, bidEvents };
}

export default async function AdminPage() {
  let totalRevenue = 0;
  let spotSummary: SpotSummaryRow[] = [];
  let bidEvents: BidEventRow[] = [];
  let fetchError: string | null = null;

  try {
    const data = await fetchAdminData();
    totalRevenue = data.totalRevenue;
    spotSummary = data.spotSummary;
    bidEvents = data.bidEvents;
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
    console.error('[AdminPage] fetchAdminData failed:', fetchError);
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '32px', maxWidth: '1100px', margin: '0 auto', color: '#111' }}>
      {/* Header row: title + logout */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px' }}>BidThatShii — Admin</h1>
          <p style={{ color: '#666', fontSize: '13px', margin: 0 }}>
            Read-only dashboard · Live from Supabase
          </p>
        </div>
        <LogoutButton />
      </div>

      {fetchError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '16px 20px', marginBottom: '28px', color: '#b91c1c', fontSize: '13px' }}>
          <strong>Data fetch error:</strong> {fetchError}
          <br /><br />
          Make sure the <code>admin_total_revenue</code> and <code>admin_spot_summary</code> views and the <code>bid_events</code> table exist in your Supabase project.
        </div>
      )}

      {/* Revenue summary */}
      <section style={{ marginBottom: '36px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '8px' }}>
          Total Revenue
        </h2>
        <div style={{ fontSize: '48px', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>
          ${(totalRevenue ?? 0).toLocaleString()}
        </div>
      </section>

      {/* Spot summary + bid history (client component for sorting) */}
      <AdminTables spotSummary={spotSummary} bidEvents={bidEvents} />
    </main>
  );
}
