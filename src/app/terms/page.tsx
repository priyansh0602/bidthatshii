import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms & Policy — BidThatShii',
  description: 'Terms of service, bidding rules, refund policy, and contact information for BidThatShii.',
};

export default function TermsAndPolicyPage() {
  return (
    <div style={styles.pageWrapper}>
      {/* Top Navigation */}
      <header style={styles.topNav}>
        <Link href="/" style={styles.brandLink}>
          BidThatShii
        </Link>
        <Link href="/" style={styles.backButton}>
          ← Back to Globe
        </Link>
      </header>

      {/* Main Content Card */}
      <main style={styles.container}>
        <div style={styles.headerArea}>
          <div style={styles.badge}>Legal &amp; Policy</div>
          <h1 style={styles.title}>Terms &amp; Policy</h1>
          <p style={styles.lastUpdated}>Last updated: September 4, 2026</p>
        </div>

        <div style={styles.content}>
          {/* Section: What this site does */}
          <section style={styles.section}>
            <h2 style={styles.heading}>What this site does</h2>
            <p style={styles.paragraph}>
              BidThatShii lets you bid to place your logo on a region of an interactive 3D Earth globe.
              Your logo links directly to your website. The highest bidder on each region has their
              logo displayed and clickable until someone else outbids them.
            </p>
          </section>

          {/* Section: How bidding works */}
          <section style={styles.section}>
            <h2 style={styles.heading}>How bidding works</h2>
            <p style={styles.paragraph}>
              Each region starts at a minimum price. When you bid, you pay the difference needed
              to become the highest bidder on that region — not the full price again if you&apos;ve bid
              on that region before. Prices only go up, never down. If someone outbids you, your logo
              is replaced by theirs, but your previous payments are not refunded (see Refund Policy below).
            </p>
          </section>

          {/* Section: How long does my logo stay up? */}
          <section style={styles.section}>
            <h2 style={styles.heading}>How long does my logo stay up?</h2>
            <p style={styles.paragraph}>
              Your logo stays live on its region for as long as you remain the highest bidder — there
              is no time limit. It&apos;s replaced only if someone else outbids you.
            </p>
          </section>

          {/* Section: Refund Policy */}
          <section style={{ ...styles.section, ...styles.highlightBox }}>
            <h2 style={{ ...styles.heading, color: '#991b1b' }}>Refund Policy</h2>
            <p style={styles.paragraph}>
              <strong>All payments are final.</strong> Because you&apos;re paying for immediate digital placement
              (your logo goes live as soon as payment is confirmed), we do not offer refunds once a payment
              has been successfully processed — including if you are later outbid by someone else. Please
              make sure you&apos;re comfortable with your bid amount before completing payment.
            </p>
            <p style={{ ...styles.paragraph, marginTop: '12px' }}>
              If you believe a payment was charged in error (e.g. a technical/duplicate charge), contact us
              at the email below and we&apos;ll look into it.
            </p>
          </section>

          {/* Section: Website submissions */}
          <section style={styles.section}>
            <h2 style={styles.heading}>Website submissions</h2>
            <p style={styles.paragraph}>
              When you submit a URL to link your logo to, you&apos;re responsible for ensuring that link is
              genuine, safe, and something you have the right to link to. We reserve the right to remove
              or refuse a submission at our discretion if it&apos;s found to be unsafe, fraudulent, or unreachable.
            </p>
          </section>

          {/* Section: Payments */}
          <section style={styles.section}>
            <h2 style={styles.heading}>Payments</h2>
            <p style={styles.paragraph}>
              Payments are processed securely through Razorpay. We do not store your card details — all
              payment information is handled directly by Razorpay.
            </p>
          </section>

          {/* Section: Contact */}
          <section style={styles.section}>
            <h2 style={styles.heading}>Contact</h2>
            <p style={styles.paragraph}>
              Questions, concerns, or payment issues? Email{' '}
              <a href="mailto:priyanshheeranandani2@gmail.com" style={styles.link}>
                priyanshheeranandani2@gmail.com
              </a>
              .
            </p>
          </section>

          {/* Disclaimer / Entity Statement */}
          <div style={styles.disclaimerBox}>
            <p style={styles.disclaimerText}>
              This site is operated by an individual, not a registered company. By using this site and completing
              a payment, you agree to the terms above.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <p style={styles.footerText}>
          © {new Date().getFullYear()} BidThatShii • Real-Time Earth Cumulative Auction •{' '}
          <Link href="/" style={styles.footerLink}>
            Home
          </Link>
        </p>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageWrapper: {
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  topNav: {
    maxWidth: '860px',
    width: '100%',
    margin: '0 auto',
    padding: '24px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandLink: {
    fontSize: '18px',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#0f172a',
    textDecoration: 'none',
  },
  backButton: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#475569',
    textDecoration: 'none',
    padding: '8px 14px',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    transition: 'all 0.15s ease',
  },
  container: {
    maxWidth: '860px',
    width: '100%',
    margin: '0 auto',
    padding: '0 20px 48px 20px',
    flex: 1,
  },
  headerArea: {
    marginBottom: '28px',
    textAlign: 'left',
  },
  badge: {
    display: 'inline-block',
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#e11d48',
    backgroundColor: '#ffe4e6',
    padding: '4px 10px',
    borderRadius: '20px',
    marginBottom: '12px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#0f172a',
    margin: '0 0 8px 0',
  },
  lastUpdated: {
    fontSize: '14px',
    color: '#64748b',
    margin: 0,
  },
  content: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    border: '1px solid #e2e8f0',
    padding: '36px 32px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    display: 'flex',
    flexDirection: 'column',
    gap: '28px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  heading: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
  },
  paragraph: {
    fontSize: '15px',
    lineHeight: '1.65',
    color: '#334155',
    margin: 0,
  },
  highlightBox: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '20px',
  },
  link: {
    color: '#e11d48',
    textDecoration: 'underline',
    fontWeight: 600,
  },
  disclaimerBox: {
    marginTop: '12px',
    paddingTop: '20px',
    borderTop: '1px solid #f1f5f9',
  },
  disclaimerText: {
    fontSize: '14px',
    lineHeight: '1.6',
    color: '#64748b',
    fontStyle: 'italic',
    margin: 0,
  },
  footer: {
    padding: '24px 20px',
    textAlign: 'center',
    borderTop: '1px solid #e2e8f0',
    backgroundColor: '#ffffff',
  },
  footerText: {
    fontSize: '13px',
    color: '#64748b',
    margin: 0,
  },
  footerLink: {
    color: '#e11d48',
    textDecoration: 'none',
    fontWeight: 500,
  },
};
