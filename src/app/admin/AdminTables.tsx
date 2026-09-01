'use client';

import React, { useState, useMemo } from 'react';
import type { SpotSummaryRow, BidEventRow } from './types';

// ─── Tiny helpers ────────────────────────────────────────────────────────────

function Th({
  children,
  sortKey,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  sortKey: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      style={{
        padding: '8px 12px',
        textAlign: 'left',
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: active ? '#000' : '#555',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        borderBottom: '2px solid #e5e7eb',
        userSelect: 'none',
        background: active ? '#f3f4f6' : 'transparent',
      }}
    >
      {children}
      <span style={{ marginLeft: '4px', fontSize: '10px', opacity: active ? 1 : 0.3 }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      style={{
        padding: '8px 12px',
        fontSize: '13px',
        borderBottom: '1px solid #f0f0f0',
        fontFamily: mono ? 'monospace' : undefined,
        maxWidth: '260px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  );
}

// ─── Spot Summary Table ───────────────────────────────────────────────────────

type SpotSortKey = keyof SpotSummaryRow;

function SpotSummaryTable({ rows }: { rows: SpotSummaryRow[] }) {
  const [sortKey, setSortKey] = useState<SpotSortKey>('current_highest_total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const handleSort = (key: SpotSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const cols: { label: string; key: SpotSortKey }[] = [
    { label: 'Region', key: 'display_name' },
    { label: 'Current Price', key: 'current_highest_total' },
    { label: 'Current Winner', key: 'current_winner_url' },
    { label: 'Revenue', key: 'total_spot_revenue' },
    { label: 'Total Bids', key: 'total_bids_on_spot' },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <Th
                key={c.key}
                sortKey={c.key}
                active={sortKey === c.key}
                dir={sortDir}
                onClick={() => handleSort(c.key)}
              >
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.spot_id} style={{ background: 'transparent' }}>
              <Td>{row.display_name}</Td>
              <Td>
                {(row.current_highest_total ?? 0) > 0 ? (
                  <strong>${(row.current_highest_total ?? 0).toLocaleString()}</strong>
                ) : (
                  <span style={{ color: '#aaa' }}>—</span>
                )}
              </Td>
              <Td mono>
                {row.current_winner_url ? (
                  <a
                    href={row.current_winner_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#1d4ed8', textDecoration: 'none' }}
                    title={row.current_winner_url}
                  >
                    {row.current_winner_url}
                  </a>
                ) : (
                  <span style={{ color: '#aaa', fontFamily: 'system-ui' }}>Unclaimed</span>
                )}
              </Td>
              <Td>${(row.total_spot_revenue ?? 0).toLocaleString()}</Td>
              <Td>{row.total_bids_on_spot ?? 0}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Bid Event History Table ──────────────────────────────────────────────────

type EventSortKey = keyof BidEventRow;

function BidHistoryTable({ rows }: { rows: BidEventRow[] }) {
  const [sortKey, setSortKey] = useState<EventSortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const handleSort = (key: EventSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const cols: { label: string; key: EventSortKey }[] = [
    { label: 'Timestamp', key: 'created_at' },
    { label: 'Region', key: 'region_name' },
    { label: 'Advertiser URL', key: 'advertiser_url' },
    { label: 'Amount Charged', key: 'amount_charged' },
    { label: 'New Total', key: 'new_total' },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <Th
                key={c.key}
                sortKey={c.key}
                active={sortKey === c.key}
                dir={sortDir}
                onClick={() => handleSort(c.key)}
              >
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
                No bid events yet
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={row.id}>
                <Td mono>
                  {new Date(row.created_at).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </Td>
                <Td>{row.region_name}</Td>
                <Td mono>
                  <a
                    href={row.advertiser_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#1d4ed8', textDecoration: 'none' }}
                    title={row.advertiser_url}
                  >
                    {row.advertiser_url}
                  </a>
                </Td>
                <Td>
                  <span style={{ color: '#059669', fontWeight: 600 }}>
                    +${(row.amount_charged ?? 0).toLocaleString()}
                  </span>
                </Td>
                <Td>${(row.new_total ?? 0).toLocaleString()}</Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Combined export ──────────────────────────────────────────────────────────

export function AdminTables({
  spotSummary,
  bidEvents,
}: {
  spotSummary: SpotSummaryRow[];
  bidEvents: BidEventRow[];
}) {
  const divider = (
    <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '36px 0' }} />
  );

  return (
    <>
      <section>
        <h2 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '12px' }}>
          Spot Summary ({spotSummary.length} spots)
        </h2>
        <SpotSummaryTable rows={spotSummary} />
      </section>

      {divider}

      <section style={{ marginBottom: '60px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '12px' }}>
          Recent Bid Events (last {bidEvents.length})
        </h2>
        <BidHistoryTable rows={bidEvents} />
      </section>
    </>
  );
}
