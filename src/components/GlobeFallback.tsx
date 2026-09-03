'use client';

import React from 'react';

/**
 * Shown in place of the 3D globe when WebGL context creation fails —
 * e.g. hardware acceleration disabled, sandboxed iframes, older devices.
 * Keeps the globe section's reserved height so layout stays stable.
 */
export const GlobeFallback: React.FC = () => {
  return (
    <div style={styles.wrapper}>
      {/* Globe icon placeholder */}
      <div style={styles.iconRing}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="24" cy="24" r="20" stroke="#cbd5e1" strokeWidth="2" />
          <ellipse cx="24" cy="24" rx="8" ry="20" stroke="#cbd5e1" strokeWidth="2" />
          <line x1="4" y1="24" x2="44" y2="24" stroke="#cbd5e1" strokeWidth="2" />
          <line x1="8" y1="14" x2="40" y2="14" stroke="#cbd5e1" strokeWidth="1.5" />
          <line x1="8" y1="34" x2="40" y2="34" stroke="#cbd5e1" strokeWidth="1.5" />
        </svg>
      </div>

      <h2 style={styles.heading}>3D view isn't available in your browser</h2>
      <p style={styles.body}>
        Your browser has hardware acceleration disabled, which is required to render
        the interactive globe. You can enable it in your browser&apos;s advanced settings —
        or simply continue below to browse and bid on regions.
      </p>
      <p style={styles.hint}>
        All auction features work normally without the 3D view.
      </p>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: '100%',
    maxWidth: '900px',
    height: 'clamp(440px, 68vh, 680px)',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    textAlign: 'center',
    padding: '40px 24px',
    backgroundColor: '#f8fafc',
    borderRadius: '16px',
    border: '1px solid #e2e8f0',
  },
  iconRing: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    backgroundColor: '#f1f5f9',
    border: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8px',
  },
  heading: {
    fontSize: '1.15rem',
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
    margin: 0,
  },
  body: {
    fontSize: '14px',
    color: '#64748b',
    maxWidth: '440px',
    lineHeight: 1.6,
    margin: 0,
  },
  hint: {
    fontSize: '13px',
    color: '#94a3b8',
    margin: 0,
    fontWeight: 500,
  },
};
