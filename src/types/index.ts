export * from './spot';
export * from './contribution';

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  service: string;
  database: string;
  dbTimestamp?: string;
}

export interface BidPlaceholder {
  id: string;
  spotId: string;
  bidderId: string;
  amount: number;
  currency: string;
  createdAt: string;
}

export interface SpotContribution {
  spotId: string;
  totalContributions: number;
  participantCount: number;
  highestBid: number;
}
