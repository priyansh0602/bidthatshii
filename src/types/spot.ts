export interface Spot {
  id: string;
  slug: string;
  display_name: string;
  current_highest_total: number;
  current_winner_id_url: string | null;
  current_winner_url: string | null;
  current_winner_logo_url: string | null;
  min_increment: number;
  starting_price?: number;
  latitude?: number;
  longitude?: number;
  created_at: string;
  updated_at: string;
}
