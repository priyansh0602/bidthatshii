export interface Contribution {
  id: string;
  spot_id: string;
  advertiser_id_url: string;
  advertiser_url: string;
  logo_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  clicks?: number;
  total_contributed: number;
  updated_at: string;
}
