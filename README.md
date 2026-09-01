# BidThatShii

**BidThatShii** is a real-time cumulative-bidding auction platform where advertisers compete to place their logo on one of 15 named regions of an interactive 3D Earth globe. The highest cumulative bidder for each region wins — their logo appears on that region's pin and links out to their website. Bids are cumulative: you only pay the *difference* needed to become the new highest bidder, not the full amount again, so early bidders are rewarded and competition stays tight. All bids, presence counts, and spot updates propagate instantly to every connected browser via Supabase Realtime — no refresh required.

---

## Features

- **Interactive 3D Earth globe** — 360° rotatable globe built with Three.js / react-three-fiber, with 15 biddable regions rendered as clickable pins at real-world lat/lng coordinates
- **Cumulative delta-payment bidding** — bidders pay only the increment above their existing contribution; early bidders are protected and cannot be fully displaced cheaply
- **Real-time updates** — all spot state (current winner, price, logo) broadcasts via Supabase Realtime `postgres_changes`; every open tab updates live without polling
- **Live visitor presence counter** — Supabase Realtime Presence tracks connected browser tabs and shows a live "X watching" count in the nav bar
- **Automatic logo/favicon discovery** — `POST /api/fetch-logo` server-side fetches the submitted URL, parses HTML for `<link rel="icon">` / Open Graph images, and falls back to the Google favicon service; SSRF protection blocks private IP ranges and localhost
- **URL reachability verification** — before a bid is accepted the submitted URL is checked for reachability server-side; unreachable URLs are rejected with a clear error
- **Click tracking** — clicks on winning advertiser logos are counted per-spot per-advertiser via `POST /api/track-click` and displayed as a live badge in the auction feed
- **Visit counting** — unique browser sessions are counted via `POST /api/track-visit` and displayed as a running total in the nav bar
- **Admin dashboard** — password-protected (Supabase Auth, email + password, single authorized email) read-only dashboard showing total revenue, per-region summary, and a sortable bid event history
- **IP-based rate limiting on all write actions** — bidding, click tracking, and visit counting all route through server-side Next.js API routes; rate limits are enforced against the real client IP (extracted from `cf-connecting-ip` / `x-forwarded-for` headers), not a client-controllable session identifier
- **Atomic, concurrency-safe bidding** — the `place_bid` Postgres function runs inside a transaction with row-level locking; simultaneous bids cannot produce double-charges or inconsistent state
- **Service-role key isolation** — the Supabase `service_role` key is only ever used server-side in `/src/lib/supabaseAdmin.ts`; the browser only receives the public anon key

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 14](https://nextjs.org/) (App Router, server components + API routes) |
| Language | TypeScript |
| UI | React 18 |
| 3D Globe | [Three.js](https://threejs.org/) via [react-three-fiber](https://docs.pmnd.rs/react-three-fiber) + [@react-three/drei](https://github.com/pmndrs/drei) |
| Database | [Supabase](https://supabase.com/) — hosted PostgreSQL with Row Level Security |
| Auth | Supabase Auth (email + password, restricted to a single admin email) |
| Realtime | Supabase Realtime (`postgres_changes` + Presence) |
| Styling | Vanilla CSS-in-JS (React inline `style` props) — no Tailwind or CSS framework |
| Validation | [Zod](https://zod.dev/) |

---

## Project Structure

```
/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout — metadata, global CSS
│   │   ├── page.tsx                # Main page — globe, auction feed, presence bar
│   │   ├── globals.css             # Minimal global reset
│   │   ├── admin/
│   │   │   ├── page.tsx            # Admin dashboard (Server Component)
│   │   │   ├── AdminTables.tsx     # Sortable spot summary + bid history tables
│   │   │   ├── LogoutButton.tsx    # Client component — calls supabase.auth.signOut()
│   │   │   ├── types.ts            # Admin-specific TypeScript types
│   │   │   └── login/
│   │   │       └── page.tsx        # Admin login page (email + password)
│   │   └── api/
│   │       ├── fetch-logo/         # POST — server-side logo/favicon discovery + SSRF guard
│   │       ├── place-bid/          # POST — rate-limited, service-role bid placement
│   │       ├── track-click/        # POST — rate-limited click counter
│   │       └── track-visit/        # POST — rate-limited visit counter
│   ├── components/
│   │   ├── Globe.tsx               # Three.js canvas, Earth sphere, region pins
│   │   ├── RegionPin.tsx           # Per-spot 3D pin with winner logo or placeholder
│   │   └── BidModal.tsx            # Bid flow modal — URL input, logo preview, bid submission
│   ├── hooks/
│   │   ├── useRealtimeSpots.ts     # Fetches spots + subscriptions to realtime changes
│   │   ├── usePresence.ts          # Live viewer count via Supabase Realtime Presence
│   │   └── useSiteStats.ts         # Visit counter — calls /api/track-visit once per session
│   ├── lib/
│   │   ├── supabase.ts             # Public anon Supabase client (browser-safe)
│   │   ├── supabaseAdmin.ts        # Service-role Supabase client (server-only — never import in client components)
│   │   ├── bids.ts                 # placeBid() and trackClick() — fetch wrappers for API routes
│   │   └── getClientIdentifier.ts  # Legacy session UUID helper (kept for reference; no longer used for rate limiting)
│   ├── middleware.ts               # Protects /admin — validates Supabase Auth session + ADMIN_EMAIL gate
│   └── types/
│       └── spot.ts                 # Spot interface matching the `spots` Postgres table
├── supabase/
│   ├── config.toml                 # Supabase CLI project config
│   ├── functions/
│   │   └── health/                 # Edge Function — health check returning { status: "ok", ... }
│   └── migrations/
│       └── 20260830000000_init.sql # Phase 0 scaffolding (the full schema lives in Supabase directly)
├── .env.example                    # Environment variable template — copy to .env
├── .gitignore
└── package.json
```

> **Note on migrations:** The full production schema (tables, RLS policies, Postgres functions, views) was applied directly to the Supabase project. Only the initial scaffolding migration is tracked in `supabase/migrations/`. If you are setting up a new Supabase project from scratch, the schema will need to be recreated manually or via a dump from the existing project.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in real values. **Never commit `.env`** — it is git-ignored.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Your Supabase project URL (safe to expose to the browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key (safe to expose to the browser; subject to RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key — **server-side only**; bypasses RLS; never sent to the browser |
| `ADMIN_EMAIL` | ✅ | Email address of the single Supabase Auth user allowed to access `/admin` |
| `ADMIN_PASSWORD` | ⚠️ | Legacy shared-password field from the old auth system — no longer used for login; can be removed |
| `ADMIN_SESSION_SECRET` | ⚠️ | Legacy HMAC signing secret from the old cookie-based auth — no longer used; can be removed |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A [Supabase](https://supabase.com/) project with the BidThatShii schema applied (see note above)
- The admin Supabase Auth user created in your Supabase project (Authentication → Users → Add user)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/bidthatshii.git
cd bidthatshii

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and fill in your Supabase credentials and ADMIN_EMAIL

# 4. Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.  
The admin dashboard is at [http://localhost:3000/admin](http://localhost:3000/admin) — requires valid Supabase Auth credentials.

### Supabase Setup Notes

- **Disable sign-ups** in Supabase dashboard → Authentication → Settings → "Enable email signup" (off) so only the manually created admin user can ever have an account
- **Revoke anon execute permissions** on `place_bid`, `increment_click`, and `increment_visit_count` so they can only be called via the service role key (server-side API routes):
  ```sql
  REVOKE EXECUTE ON FUNCTION place_bid FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION increment_click FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION increment_visit_count FROM anon, authenticated;
  ```
- **Session length** is configured in Supabase dashboard → Authentication → Settings → JWT expiry & Token refresh interval (no code change needed)

---

## Key Architectural Decisions

### Why bidding, click tracking, and visit counting go through server-side API routes

In early versions, these actions called `supabase.rpc()` directly from the browser using the public anon key. The problem: anyone could use the anon key from outside the app to call `place_bid` directly — bypassing rate limits entirely (since the old limits relied on session UUIDs stored in `sessionStorage`, which are trivially clearable). The fix:

1. The `place_bid`, `increment_click`, and `increment_visit_count` Postgres functions have their `EXECUTE` permission **revoked from `anon` and `authenticated`** — they can only be called via the `service_role` key
2. Three Next.js API routes (`/api/place-bid`, `/api/track-click`, `/api/track-visit`) act as the only allowed callers, using the service-role client server-side
3. Rate limiting in these routes is enforced against the **real client IP** extracted from request headers (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`) — a server-verified value that a browser cannot spoof

### URL normalization before identity matching

When a bidder submits a URL, it is normalized (scheme added if missing, trailing slashes stripped, lowercased) before being stored and compared. This ensures that `example.com`, `http://example.com`, and `https://example.com/` all resolve to the same advertiser identity. Without normalization, the same advertiser could accidentally create multiple independent contributions to the same spot, or be unable to reclaim their existing bid.

### The cumulative-payment bidding mechanic

Each spot tracks a `current_highest_total` — the total amount the leading bidder has cumulatively paid. When you place a bid, you specify a target total (must be ≥ `current_highest_total + min_increment`). The `place_bid` function looks up how much you have already contributed to this spot from your URL. **You are only charged the difference** (`your target total` − `your existing contribution`). This means:

- If you are already the highest bidder and someone outbids you, you can reclaim the top spot by paying only the increment above theirs — you do not lose your prior contribution
- Early bidders are incentivised to bid higher upfront to reduce future top-up costs
- All calculations happen inside a single Postgres transaction with row-level locking, preventing race conditions under simultaneous bids

---

## Known Limitations / Not Yet Implemented

- **No payment gating** — bids are currently **free** (no Stripe or other payment processor is connected). This is a pre-launch status. The bidding mechanic, rate limiting, and atomic accounting are fully implemented, but no real money is collected or charged. **Do not launch publicly with real advertiser expectations until payment is integrated.**
- **No content moderation** — submitted advertiser URLs are checked for reachability and basic SSRF safety, but logo images and destination URLs are not reviewed for inappropriate content beyond that
- **Admin panel has no 2FA** — the admin dashboard is protected by Supabase Auth (email + password) with a single-email gate in middleware, but no second factor is enforced
- **In-memory rate limiting on `/api/fetch-logo`** — this route uses a simple in-memory request log rather than the Postgres-backed `check_rate_limit` function used by the other routes; in a multi-instance deployment (e.g. Vercel serverless functions with concurrent cold starts), this limiter will not be shared across instances
- **Full schema not tracked as migrations** — the production Supabase schema was applied directly to the project rather than being fully codified as versioned migration files; a fresh environment requires a manual schema setup

---

## License

License TBD — all rights reserved until a license is chosen.
