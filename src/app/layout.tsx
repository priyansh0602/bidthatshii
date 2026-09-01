import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BidThatShii - Cumulative Bidding Auction Platform',
  description: 'BidThatShii — real-time cumulative bidding auction. Own a piece of Earth.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
