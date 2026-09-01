/**
 * Shared type definitions for the admin dashboard.
 * Kept in a separate file to avoid a circular import between
 * page.tsx (Server Component) and AdminTables.tsx (Client Component).
 *
 * Field names MUST match the actual column names returned by the SQL views:
 *   - admin_spot_summary  → SpotSummaryRow
 *   - (bid_events joined with spots, flattened in page.tsx) → BidEventRow
 */

export type SpotSummaryRow = {
  spot_id: string;
  display_name: string;          // SQL view column: display_name
  current_highest_total: number; // SQL view column: current_highest_total
  current_winner_url: string | null;
  total_spot_revenue: number;    // SQL view column: total_spot_revenue
  total_bids_on_spot: number;    // SQL view column: total_bids_on_spot
};

export type BidEventRow = {
  id: string;
  created_at: string;
  region_name: string;   // flattened from spots.display_name in page.tsx
  advertiser_url: string;
  amount_charged: number;
  new_total: number;
};
