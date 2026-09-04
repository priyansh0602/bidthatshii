'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRealtimeSpots } from '@/hooks/useRealtimeSpots';
import { usePresence } from '@/hooks/usePresence';
import { useSiteStats } from '@/hooks/useSiteStats';
import { Globe } from '@/components/Globe';
import { BidModal } from '@/components/BidModal';
import { trackClick } from '@/lib/supabase';
import type { Spot } from '@/types/spot';

interface ActionFigureClientProps {
  /**
   * Server-rendered initial spots data (fetched with a 5-second revalidation
   * cache on the server). This eliminates the client-side loading state on first
   * paint. The realtime subscription in useRealtimeSpots takes over immediately
   * after hydration and keeps data fully live thereafter.
   */
  initialSpots: Spot[];
}

export default function ActionFigureClient({ initialSpots }: ActionFigureClientProps) {
  const { spots, clicksMap, loading } = useRealtimeSpots(initialSpots);
  const { watchingCount } = usePresence();
  const { totalVisits, visitsLoading } = useSiteStats();

  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const isModalOpen = selectedSpot !== null;

  // Log Globe mount/unmount state whenever modal opens or closes
  useEffect(() => {
    if (isModalOpen) {
      console.log('[page] Modal opened — Globe is now UNMOUNTED. Selected spot:', selectedSpot?.display_name);
    } else {
      console.log('[page] Modal closed — Globe is now MOUNTED.');
    }
  }, [isModalOpen]);

  // Sort spots by current_highest_total descending for "The auction, live." feed
  const sortedSpots = useMemo(() => {
    return [...spots].sort((a, b) => b.current_highest_total - a.current_highest_total);
  }, [spots]);

  // Redirect to advertiser URL and track click
  const handleLogoClick = (e: React.MouseEvent, spot: Spot) => {
    e.preventDefault();
    e.stopPropagation();
    if (!spot.current_winner_url) return;

    const advertiserId = spot.current_winner_id_url || spot.current_winner_url;
    trackClick(spot.id, advertiserId);

    let targetUrl = spot.current_winner_url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenClaimModal = (e: React.MouseEvent, spot: Spot) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedSpot(spot);
  };

  return (
    <main style={styles.container}>
      {/* Top Bar */}
      <nav style={styles.topBar}>
        <div style={styles.presenceBadge}>
          <span style={styles.greenDot} />
          <span>{watchingCount} watching</span>
        </div>

        <div style={styles.brandName}>BidThatShii</div>

        <div style={styles.visitorCounter}>
          {visitsLoading ? (
            <span style={styles.visitsSkeleton}>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
          ) : (
            <span>{totalVisits !== null ? totalVisits.toLocaleString() : '—'} total visits</span>
          )}
        </div>
      </nav>

      {/* Main Headline */}
      <section style={styles.heroSection}>
        <h1 style={styles.title}>Your Earth. Your Logo.</h1>
        <p style={styles.subtitle}>
          Own a Piece of Earth
        </p>
      </section>

      {/* 3D Earth Globe — unmounted while modal is open so drei <Html> pins
          cannot escape the canvas stacking context and overlap the modal */}
      <section style={styles.globeSection}>
        {loading ? (
          <div style={styles.loadingContainer}>
            <div style={styles.spinner} />
            <p style={{ fontSize: '14px', color: '#64748b' }}>Loading 3D Earth &amp; Realtime Spots...</p>
          </div>
        ) : !isModalOpen ? (
          <Globe spots={spots} onSelectSpot={(spot) => setSelectedSpot(spot)} />
        ) : (
          /* Placeholder height keeps layout stable while globe is unmounted */
          <div style={{ width: '100%', height: 'clamp(440px, 68vh, 680px)' }} />
        )}
      </section>

      {/* Live Auction Feed Section */}
      <section style={styles.feedSection}>
        <div style={styles.feedHeader}>
          <div style={styles.liveIndicator}>
            <span style={styles.redDot} />
            <h2 style={styles.feedTitle}>The auction, live.</h2>
          </div>
          <span style={styles.feedCount}>{spots.length} Regions</span>
        </div>

        <div style={styles.feedList}>
          {sortedSpots.map((spot) => {
            const isClaimed = Boolean(spot.current_winner_url || spot.current_winner_id_url);
            const currentPrice = spot.current_highest_total > 0 ? spot.current_highest_total : 0;
            const nextPrice =
              spot.current_highest_total > 0
                ? spot.current_highest_total + (spot.min_increment ?? 1)
                : (spot.starting_price ?? 5);

            const clicks =
              (clicksMap[`${spot.id}:${spot.current_winner_id_url}`] ?? clicksMap[spot.id]) || 0;

            return (
              <div key={spot.id} style={styles.feedRow}>
                {/* Winner Logo Thumbnail — clickable if claimed */}
                <div
                  onClick={(e) => isClaimed && handleLogoClick(e, spot)}
                  style={{
                    ...styles.logoContainer,
                    cursor: isClaimed ? 'pointer' : 'default',
                  }}
                  title={isClaimed ? `Visit ${spot.current_winner_url}` : 'Unclaimed'}
                >
                  {isClaimed && spot.current_winner_logo_url ? (
                    <img
                      src={spot.current_winner_logo_url}
                      alt={spot.display_name}
                      style={styles.logoImg}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(spot.current_winner_url || 'globe')}`;
                      }}
                    />
                  ) : (
                    <div style={styles.logoPlaceholder}>
                      {spot.display_name.charAt(0)}
                    </div>
                  )}
                </div>

                {/* Region Info */}
                <div style={styles.regionInfo}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={styles.regionName}>{spot.display_name}</h3>
                    {isClaimed && (
                      <span style={styles.clickBadge}>
                        {clicks} {clicks === 1 ? 'click' : 'clicks'}
                      </span>
                    )}
                  </div>

                  {isClaimed ? (
                    <span
                      onClick={(e) => handleLogoClick(e, spot)}
                      style={styles.winnerLink}
                      title={`Visit ${spot.current_winner_url}`}
                    >
                      {spot.current_winner_url || spot.current_winner_id_url} ↗
                    </span>
                  ) : (
                    <p style={styles.unclaimedText}>Unclaimed</p>
                  )}
                </div>

                {/* Pricing */}
                <div style={styles.priceContainer}>
                  <span style={styles.priceLabel}>Current</span>
                  <span style={styles.priceValue}>${currentPrice}</span>
                </div>

                {/* Action Button: Opens Bid Modal */}
                <button
                  type="button"
                  onClick={(e) => handleOpenClaimModal(e, spot)}
                  style={styles.claimBtn}
                >
                  Claim ${nextPrice}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <p>
          BidThatShii • Real-Time Earth Cumulative Auction •{' '}
          <a href="/terms" style={styles.footerLink}>
            Terms &amp; Policy
          </a>
        </p>
      </footer>

      {/* Bid Modal */}
      {selectedSpot && (
        <BidModal
          spot={selectedSpot}
          onClose={() => setSelectedSpot(null)}
        />
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '24px 20px 60px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    minHeight: '100vh',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '16px',
    borderBottom: '1px solid #f1f5f9',
  },
  presenceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#059669',
    backgroundColor: '#ecfdf5',
    padding: '4px 10px',
    borderRadius: '20px',
    border: '1px solid #a7f3d0',
  },
  greenDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
  },
  brandName: {
    fontSize: '16px',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#0f172a',
  },
  visitorCounter: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#64748b',
  },
  visitsSkeleton: {
    display: 'inline-block',
    backgroundColor: '#e2e8f0',
    borderRadius: '4px',
    color: 'transparent',
    animation: 'pulse 1.4s ease-in-out infinite',
    userSelect: 'none',
  },
  heroSection: {
    textAlign: 'center',
    marginTop: '12px',
  },
  title: {
    fontSize: '3rem',
    fontWeight: 900,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '1.1rem',
    color: '#64748b',
    maxWidth: '560px',
    margin: '0 auto',
    lineHeight: 1.5,
  },
  globeSection: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 'clamp(440px, 68vh, 680px)',
    width: '100%',
  },
  loadingContainer: {
    textAlign: 'center',
    padding: '60px 20px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #e2e8f0',
    borderTopColor: '#e11d48',
    borderRadius: '50%',
    margin: '0 auto 16px auto',
    animation: 'spin 1s linear infinite',
  },
  feedSection: {
    marginTop: '24px',
  },
  feedHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  liveIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  redDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#e11d48',
  },
  feedTitle: {
    fontSize: '1.5rem',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#0f172a',
  },
  feedCount: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#64748b',
  },
  feedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  feedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '14px 18px',
    borderRadius: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  logoContainer: {
    width: '38px',
    height: '38px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: {
    width: '38px',
    height: '38px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '1px solid #cbd5e1',
    transition: 'transform 0.15s',
  },
  logoPlaceholder: {
    width: '38px',
    height: '38px',
    borderRadius: '50%',
    backgroundColor: '#f1f5f9',
    color: '#475569',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '14px',
    border: '1px solid #e2e8f0',
  },
  regionInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  regionName: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#0f172a',
  },
  clickBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    padding: '2px 8px',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
  },
  winnerLink: {
    fontSize: '12px',
    color: '#2563eb',
    cursor: 'pointer',
    textDecoration: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  unclaimedText: {
    fontSize: '12px',
    color: '#94a3b8',
  },
  priceContainer: {
    textAlign: 'right',
    paddingRight: '12px',
  },
  priceLabel: {
    fontSize: '10px',
    color: '#94a3b8',
    textTransform: 'uppercase',
    display: 'block',
  },
  priceValue: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
  },
  claimBtn: {
    backgroundColor: '#e11d48',
    color: '#ffffff',
    border: 'none',
    padding: '10px 18px',
    borderRadius: '8px',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'transform 0.15s, background-color 0.15s',
    flexShrink: 0,
  },
  footer: {
    marginTop: '40px',
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: '13px',
    borderTop: '1px solid #f1f5f9',
    paddingTop: '24px',
  },
  footerLink: {
    color: '#64748b',
    textDecoration: 'underline',
    fontWeight: 500,
    transition: 'color 0.15s ease',
  },
};
