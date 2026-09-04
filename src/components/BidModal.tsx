'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import type { Spot } from '@/types/spot';

// Helper to dynamically load the Razorpay checkout script
function loadRazorpayCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) {
      resolve(true);
      return;
    }
    const existingScript = document.getElementById('razorpay-checkout-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.id = 'razorpay-checkout-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

interface BidModalProps {
  spot: Spot | null;
  onClose: () => void;
  onBidSuccess?: () => void;
}

export const BidModal: React.FC<BidModalProps> = ({ spot, onClose, onBidSuccess }) => {
  const [url, setUrl] = useState<string>('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [fetchingLogo, setFetchingLogo] = useState<boolean>(false);
  const [logoFetchAttempted, setLogoFetchAttempted] = useState<boolean>(false);
  // null = not yet checked, true/false = result of reachability check
  const [urlReachable, setUrlReachable] = useState<boolean | null>(null);
  const [urlReachabilityError, setUrlReachabilityError] = useState<string | null>(null);
  // Custom bid amount — defaults to the minimum next price for this spot
  const [bidAmount, setBidAmount] = useState<number>(5);
  const [bidAmountError, setBidAmountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  // Tracks whether the last failure was specifically a rate-limit rejection.
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);

  // Existing contribution this user already has on this spot for the given URL
  const [existingContribution, setExistingContribution] = useState<number>(0);
  const [fetchingContribution, setFetchingContribution] = useState<boolean>(false);

  // Track whether we are mounted in the browser for createPortal SSR safety
  const [isBrowser, setIsBrowser] = useState<boolean>(false);
  useEffect(() => {
    setIsBrowser(true);
  }, []);

  const lastFetchedUrl = useRef<string>('');
  const lastFetchedContribKey = useRef<string>('');

  const currentPrice = spot ? (spot.current_highest_total > 0 ? spot.current_highest_total : 0) : 0;
  const nextPrice = spot
    ? spot.current_highest_total > 0
      ? spot.current_highest_total + (spot.min_increment ?? 1)
      : (spot.starting_price ?? 5)
    : 5;

  // The actual amount the user will be charged = bid total minus what they've already paid
  const youllPay = Math.max(0, bidAmount - existingContribution);

  // Sync bidAmount floor to the current spot's minimum price whenever the spot changes
  useEffect(() => {
    setBidAmount(nextPrice);
    setBidAmountError(null);
    // Reset existing contribution when spot changes so stale data doesn't show
    setExistingContribution(0);
    lastFetchedContribKey.current = '';
  }, [spot?.id, nextPrice]);

  // Fetch the user's existing contribution for this spot+URL combo
  const fetchExistingContribution = async (inputUrl: string) => {
    if (!spot) return;
    const trimmed = inputUrl.trim();
    let normalized = trimmed;
    if (normalized && !normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    if (!normalized || normalized === 'https://' || normalized === 'http://') {
      setExistingContribution(0);
      return;
    }
    const key = `${spot.id}:${normalized}`;
    if (key === lastFetchedContribKey.current) return;
    lastFetchedContribKey.current = key;

    setFetchingContribution(true);
    try {
      const { data } = await supabase
        .from('contributions')
        .select('total_contributed')
        .eq('spot_id', spot.id)
        .eq('advertiser_id_url', normalized)
        .maybeSingle();
      setExistingContribution(data?.total_contributed ?? 0);
    } catch {
      setExistingContribution(0);
    } finally {
      setFetchingContribution(false);
    }
  };

  // Auto-fetch logo AND verify reachability when user finishes typing a URL
  const fetchLogoForUrl = async (inputUrl: string) => {
    const trimmed = inputUrl.trim();
    if (!trimmed || trimmed === 'https://' || trimmed === 'http://') {
      setLogoUrl(null);
      setLogoFetchAttempted(false);
      setUrlReachable(null);
      setUrlReachabilityError(null);
      return;
    }

    if (trimmed === lastFetchedUrl.current) return;
    lastFetchedUrl.current = trimmed;

    setFetchingLogo(true);
    setLogoFetchAttempted(true);
    setUrlReachable(null);
    setUrlReachabilityError(null);

    try {
      const res = await fetch('/api/fetch-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();

      // Update reachability state from API response
      const reachable = Boolean(data?.reachable);
      setUrlReachable(reachable);
      setUrlReachabilityError(data?.error ?? null);

      if (reachable && data?.logoUrl) {
        setLogoUrl(data.logoUrl);
      } else if (reachable) {
        // Reachable but no icon found — use Google fallback
        setLogoUrl(`https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(trimmed)}`);
      } else {
        // Unreachable — clear logo
        setLogoUrl(null);
      }
    } catch {
      // Network error calling our own API — treat as reachability unknown, don't block
      setUrlReachable(null);
      setUrlReachabilityError('Could not verify URL — check your internet connection and try again');
      setLogoUrl(null);
    } finally {
      setFetchingLogo(false);
    }
  };

  const handleBlur = () => {
    if (url.trim()) {
      fetchLogoForUrl(url);
      fetchExistingContribution(url);
    }
  };

  const handleBidAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = parseInt(raw, 10);
    setBidAmount(isNaN(parsed) ? nextPrice : parsed);
    if (!isNaN(parsed) && parsed < nextPrice) {
      setBidAmountError(`Minimum bid is $${nextPrice}`);
    } else {
      setBidAmountError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spot) return;

    // Ensure logo fetch has completed
    if (fetchingLogo) return;

    // Block submission if URL was verified as unreachable
    if (urlReachable === false) return;

    // Block if bid amount is below the minimum
    if (bidAmount < nextPrice) {
      setBidAmountError(`Minimum bid is $${nextPrice}`);
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setIsRateLimited(false);

    try {
      let normalizedUrl = url.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      const targetLogo =
        logoUrl ||
        `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(normalizedUrl)}`;

      // 1. Ensure Razorpay checkout script is loaded
      const scriptLoaded = await loadRazorpayCheckoutScript();
      if (!scriptLoaded) {
        setSubmitting(false);
        setMessage({
          text: 'Could not load Razorpay payment gateway. Please check your connection and try again.',
          success: false,
        });
        return;
      }

      // 2. Create payment order server-side with verified charge delta
      const orderRes = await fetch('/api/create-payment-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotId: spot.id,
          advertiserUrl: normalizedUrl,
          bidAmount,
        }),
      });

      const orderData = await orderRes.json();

      if (!orderRes.ok) {
        setSubmitting(false);
        if (orderRes.status === 429) {
          setIsRateLimited(true);
        }
        setMessage({
          text: orderData.error || 'Failed to create payment order. Please try again.',
          success: false,
        });
        return;
      }

      const { orderId, amount, currency, keyId } = orderData;

      // 3. Configure and open Razorpay Checkout popup
      const rzpOptions = {
        key: keyId,
        amount,
        currency: currency || 'INR',
        name: 'BidThatShii',
        description: `Claim ${spot.display_name}`,
        order_id: orderId,
        handler: async (paymentResponse: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          setSubmitting(true);
          setMessage({
            text: 'Verifying payment and claiming spot…',
            success: true,
          });

          try {
            const verifyRes = await fetch('/api/verify-payment-and-bid', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_payment_id: paymentResponse.razorpay_payment_id,
                razorpay_order_id: paymentResponse.razorpay_order_id,
                razorpay_signature: paymentResponse.razorpay_signature,
                spotId: spot.id,
                advertiserUrl: normalizedUrl,
                logoUrl: targetLogo,
                bidAmount,
              }),
            });

            const verifyData = await verifyRes.json();

            const rateLimited =
              !verifyData.success &&
              typeof verifyData.message === 'string' &&
              verifyData.message.toLowerCase().includes('too many');

            setIsRateLimited(rateLimited);
            setMessage({
              text:
                verifyData.message ||
                (verifyData.success ? 'Region claimed successfully!' : 'Payment verified but claim failed'),
              success: Boolean(verifyData.success),
            });

            if (verifyData.success) {
              if (onBidSuccess) onBidSuccess();
              setTimeout(() => {
                onClose();
              }, 1200);
            }
          } catch (err) {
            setMessage({
              text: err instanceof Error ? err.message : 'Error verifying payment and placing bid.',
              success: false,
            });
          } finally {
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => {
            // User closed/cancelled without paying — return to form without treating as error
            setSubmitting(false);
            setMessage({
              text: 'Payment cancelled. You can try again whenever you are ready.',
              success: false,
            });
          },
        },
        theme: {
          color: '#e11d48',
        },
      };

      const RazorpayConstructor = (window as unknown as {
        Razorpay: new (opts: unknown) => {
          open: () => void;
          on: (event: string, callback: (resp: unknown) => void) => void;
        };
      }).Razorpay;

      const rzp = new RazorpayConstructor(rzpOptions);

      rzp.on('payment.failed', (resp: unknown) => {
        setSubmitting(false);
        const errObj = resp as { error?: { description?: string } };
        setMessage({
          text: errObj?.error?.description || 'Payment was unsuccessful. Please try again.',
          success: false,
        });
      });

      rzp.open();
    } catch (err) {
      setSubmitting(false);
      setMessage({
        text: err instanceof Error ? err.message : 'Error starting payment',
        success: false,
      });
    }
  };

  if (!isBrowser || !spot) return null;

  const modalJsx = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          color: '#0f172a',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '440px',
          padding: '36px 32px 32px',
          boxShadow: '0 32px 64px -12px rgba(0, 0, 0, 0.35)',
          border: '1px solid #e2e8f0',
          position: 'relative',
          zIndex: 10000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close modal"
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            background: '#f1f5f9',
            border: 'none',
            borderRadius: '50%',
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            cursor: 'pointer',
            color: '#64748b',
            lineHeight: 1,
          }}
        >
          ✕
        </button>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#e11d48',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Claim Region
          </span>
          <h2
            style={{
              fontSize: '1.6rem',
              fontWeight: 800,
              marginTop: '4px',
              color: '#0f172a',
              letterSpacing: '-0.02em',
            }}
          >
            {spot.display_name}
          </h2>
        </div>

        {/* Price Stats */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            padding: '16px 18px',
            borderRadius: '14px',
            marginBottom: '20px',
            border: '1px solid #f1f5f9',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {/* Row: Current Price + Minimum Required Total */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                Current Price
              </span>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                ${currentPrice}
              </div>
            </div>
            <div>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                Min Required Total
              </span>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                ${nextPrice}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #e2e8f0' }} />

          {/* Existing contribution row — only shown when > 0 */}
          {existingContribution > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                Your existing contribution
              </span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                −${existingContribution}
              </span>
            </div>
          )}

          {/* You'll Pay — the key delta line */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#fff1f2',
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1.5px solid #fecdd3',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#be123c' }}>
              You'll Pay
            </span>
            <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#e11d48', letterSpacing: '-0.02em' }}>
              {fetchingContribution ? '…' : `$${youllPay}`}
            </span>
          </div>
        </div>

        {/* Current Winner */}
        {spot.current_winner_url && (
          <div
            style={{
              fontSize: '12px',
              color: '#475569',
              marginBottom: '20px',
              backgroundColor: '#f8fafc',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ color: '#94a3b8' }}>Current leader:</span>
            <strong
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '220px',
                display: 'inline-block',
              }}
            >
              {spot.current_winner_url}
            </strong>
          </div>
        )}

        {/* Form: URL Input & Logo Preview */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label
              htmlFor="advertiser-url"
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#475569',
                display: 'block',
                marginBottom: '6px',
              }}
            >
              Your Website URL
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                id="advertiser-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleBlur}
                placeholder="Paste your website link"
                required
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #e2e8f0',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  color: '#0f172a',
                }}
              />
              <button
                type="button"
                onClick={() => fetchLogoForUrl(url)}
                disabled={fetchingLogo || !url.trim()}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#f8fafc',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#334155',
                  flexShrink: 0,
                }}
              >
                {fetchingLogo ? 'Fetching...' : 'Find Logo'}
              </button>
            </div>
          </div>

          {/* Bid Amount Input */}
          <div>
            <label
              htmlFor="bid-amount"
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#475569',
                display: 'block',
                marginBottom: '6px',
              }}
            >
              Your Bid Amount
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
              <span
                style={{
                  padding: '12px 12px',
                  borderRadius: '10px 0 0 10px',
                  border: '1.5px solid #e2e8f0',
                  borderRight: 'none',
                  backgroundColor: '#f8fafc',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: '#64748b',
                  lineHeight: 1,
                }}
              >
                $
              </span>
              <input
                id="bid-amount"
                type="number"
                min={nextPrice}
                step={1}
                value={bidAmount}
                onChange={handleBidAmountChange}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  borderRadius: '0 10px 10px 0',
                  border: `1.5px solid ${bidAmountError ? '#e11d48' : '#e2e8f0'}`,
                  fontSize: '15px',
                  fontWeight: 700,
                  outline: 'none',
                  boxSizing: 'border-box',
                  color: '#0f172a',
                  MozAppearance: 'textfield',
                } as React.CSSProperties}
              />
            </div>
            <div
              style={{
                marginTop: '5px',
                fontSize: '11px',
                color: bidAmountError ? '#e11d48' : '#94a3b8',
                fontWeight: bidAmountError ? 600 : 400,
              }}
            >
              {bidAmountError ?? `Minimum bid: $${nextPrice}`}
            </div>
          </div>

          {/* Logo Preview Area */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: '12px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {fetchingLogo ? (
                <div style={{ width: '16px', height: '16px', border: '2px solid #e2e8f0', borderTopColor: '#e11d48', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              ) : logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url || 'globe')}`;
                  }}
                />
              ) : (
                <span style={{ fontSize: '18px', color: '#94a3b8' }}>🌐</span>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>
                {urlReachable === false ? 'Unreachable' : 'Logo Preview'}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: urlReachable === false ? '#e11d48' : '#0f172a',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {fetchingLogo
                  ? 'Checking URL & fetching logo…'
                  : urlReachable === false
                  ? 'Website could not be reached'
                  : urlReachable === true
                  ? '✓ Website verified & logo ready'
                  : logoFetchAttempted
                  ? 'Logo ready for pin'
                  : 'Enter URL above to verify your site'}
              </span>
            </div>
          </div>

          {/* URL Reachability Error */}
          {urlReachable === false && urlReachabilityError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                fontSize: '13px',
                fontWeight: 500,
                padding: '12px 14px',
                borderRadius: '10px',
                backgroundColor: 'rgba(225, 29, 72, 0.06)',
                color: '#be123c',
                border: '1.5px solid rgba(225, 29, 72, 0.25)',
              }}
            >
              <span style={{ fontSize: '16px', lineHeight: 1.2, flexShrink: 0 }}>⚠️</span>
              <span>
                <strong>Website unreachable:</strong> {urlReachabilityError}.
                {' '}Make sure the URL is publicly accessible and try again.
              </span>
            </div>
          )}

          {/* Bid feedback message */}
          {message && (
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                padding: '10px 14px',
                borderRadius: '10px',
                backgroundColor: message.success
                  ? 'rgba(16, 185, 129, 0.08)'
                  : isRateLimited
                  ? 'rgba(234, 88, 12, 0.08)'
                  : 'rgba(225, 29, 72, 0.08)',
                color: message.success ? '#059669' : isRateLimited ? '#c2410c' : '#e11d48',
                border: `1.5px solid ${
                  message.success ? '#10b981' : isRateLimited ? '#ea580c' : '#e11d48'
                }`,
                textAlign: 'center',
              }}
            >
              {message.success ? '✓ ' : isRateLimited ? '⏱ ' : '✕ '}{message.text}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || fetchingLogo || !url.trim() || urlReachable === false || !!bidAmountError}
            style={{
              width: '100%',
              backgroundColor: urlReachable === false || bidAmountError ? '#94a3b8' : '#e11d48',
              color: '#ffffff',
              border: 'none',
              padding: '14px',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '15px',
              cursor:
                submitting || fetchingLogo || !url.trim() || urlReachable === false || !!bidAmountError
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                submitting || fetchingLogo || !url.trim() || urlReachable === false || !!bidAmountError
                  ? 0.65
                  : 1,
              transition: 'opacity 0.2s, background-color 0.2s',
              letterSpacing: '-0.01em',
            }}
          >
            {submitting
              ? 'Processing…'
              : fetchingLogo
              ? 'Verifying URL…'
              : urlReachable === false
              ? 'Website unreachable — fix URL to claim'
              : bidAmountError
              ? bidAmountError
              : `Pay $${youllPay} to Claim ${spot.display_name}`}
          </button>

          <p
            style={{
              fontSize: '12px',
              color: '#94a3b8',
              textAlign: 'center',
              margin: '12px 0 0 0',
              lineHeight: '1.4',
            }}
          >
            All payments are final. By proceeding, you agree to the{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#64748b', textDecoration: 'underline' }}
            >
              Terms &amp; Policy
            </a>
            .
          </p>
        </form>
      </div>
    </div>
  );

  return createPortal(modalJsx, document.body);
};
