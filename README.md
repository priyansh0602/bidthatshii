# BidThatShii

**BidThatShii** is a live, real-time bidding platform built around an interactive 3D Earth globe. Users bid to claim a region and place their logo on it — the logo is instantly live and clickable, linking directly to their site. Prices only rise, and returning bidders only pay the difference needed to reclaim the top spot, not the full price again. Live at [https://bidthatshii.live](https://bidthatshii.live).

---

## Live Product

BidThatShii is launched and in active production use at **[https://bidthatshii.live](https://bidthatshii.live)**. This documentation describes the current production architecture and live deployment, not a work-in-progress or planned roadmap.

---

## Key Features

- **360° Rotatable 3D Earth Globe**: Built using Three.js and `@react-three/fiber` with orbital controls, rendering 15 biddable geographic regions pinned at accurate latitude/longitude coordinates with spherical vector math (`latLngToVector3`).
- **Cumulative Delta-Payment Bidding**: Bidders only pay the financial increment required to outbid the current leader (`target_bid - existing_contribution`), protecting previous capital contributions and keeping regional competition intense.
- **Instant Real-Time Synchronization**: All spot price updates, ownership changes, and live clicks broadcast instantaneously across every connected client using Supabase Realtime (`postgres_changes` WebSocket channels) without polling.
- **Live Visitor Presence Counter**: Supabase Realtime Presence (`site-presence` channel) monitors active concurrent browser connections with deduplicated session identifiers and displays a live "watching" badge.
- **Automated Logo & Favicon Discovery**: A server-side discovery pipeline fetches submitted URLs, parses HTML for `<link rel="icon">`, `apple-touch-icon`, `og:image`, and `twitter:image` tags, checks `/favicon.ico`, validates image magic bytes and content types, and cascades to the Google Favicon Service with a guaranteed local fallback (`/default-globe.svg`).
- **URL Reachability Verification & SSRF Protection**: Validates destination URLs with HTTP timeouts and strict server-side request forgery (SSRF) guards that block private IPv4/IPv6 ranges (RFC 1918), loopback interfaces, carrier-grade NAT, and cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`).
- **Logo Click Tracking with Instant Redirect**: Outbound clicks on claimed region pins and cards are asynchronously recorded via `/api/track-click` (backed by the `increment_click` Postgres RPC) before redirecting users to the advertiser's website.
- **Live Global Payments via Dodo Payments**: Seamless checkout supporting international credit/debit cards and Indian UPI. Pricing is displayed in USD while processed in INR paise via Dodo Payments checkout sessions with server-side SDK signature verification and an asynchronous webhook recovery worker.
- **Protected Admin Dashboard**: Read-only internal dashboard (`/admin`) presenting aggregated platform revenue (`admin_total_revenue`), per-region performance breakdowns (`admin_spot_summary`), and sortable historical bid records, secured with Supabase Auth session cookies and strict email allowlisting.
- **Server-Side IP Rate Limiting**: All mutation endpoints (`/api/create-payment-order`, `/api/verify-payment-and-bid`, `/api/track-click`, `/api/track-visit`, and `/api/fetch-logo`) enforce rate limits against real client IPs extracted from proxy headers (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`).
- **Atomic Concurrency-Safe Bidding**: The Postgres `place_bid` stored procedure executes within an isolated transaction utilizing row-level locking (`FOR UPDATE`), ensuring concurrent bids never create race conditions, partial writes, or inconsistent winner states.
- **Graceful WebGL Fallback UI**: Proactive WebGL context probing detects disabled hardware acceleration or unsupported environments, cleanly rendering an interactive fallback interface (`GlobeFallback`) while keeping the entire auction functional.

---

## Tech Stack

| Layer | Technology | Description |
|---|---|---|
| **Framework** | [Next.js 14](https://nextjs.org/) | App Router with React Server Components, dynamic streaming, and Route Handlers |
| **Language** | [TypeScript](https://www.typescriptlang.org/) | End-to-end static typing across database schemas, APIs, and client components |
| **Frontend UI** | [React 18](https://react.dev/) | Client and server components |
| **3D Rendering** | [Three.js](https://threejs.org/) / [R3F](https://docs.pmnd.rs/react-three-fiber) | `@react-three/fiber` and `@react-three/drei` for interactive 3D canvas and orbital scene controls |
| **Database & Auth** | [Supabase](https://supabase.com/) | Hosted PostgreSQL, Row Level Security (RLS), Supabase Auth (`@supabase/ssr`), and Realtime WebSockets |
| **Payments** | [Dodo Payments](https://dodopayments.com/) | Server SDK (`dodopayments`) and checkout overlay client (`dodopayments-checkout`) supporting cards & UPI |
| **Styling** | Vanilla CSS & CSS Variables | Native CSS custom properties (`globals.css`) paired with modular inline style objects — zero CSS frameworks or Tailwind dependencies |
| **Hosting & Edge** | [Vercel](https://vercel.com/) | Edge middleware, serverless functions, and global CDN delivery |

---

## Project Structure

```
bidthatshii/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root HTML layout and global metadata
│   │   ├── page.tsx                  # Server Component: initial cached spots fetch (5s revalidate)
│   │   ├── ActionFigureClient.tsx    # Primary client component: 3D globe, feed, presence, and alerts
│   │   ├── globals.css               # Design tokens (CSS custom properties) and keyframe animations
│   │   ├── admin/
│   │   │   ├── page.tsx              # Admin dashboard Server Component (dynamic, no-store fetch)
│   │   │   ├── AdminTables.tsx       # Client component: sortable region summary and bid event tables
│   │   │   ├── LogoutButton.tsx      # Admin sign-out button
│   │   │   ├── types.ts              # Admin dashboard data interfaces
│   │   │   └── login/
│   │   │       └── page.tsx          # Cookie-based admin authentication using @supabase/ssr
│   │   ├── api/
│   │   │   ├── create-payment-order/ # POST: calculates USD delta, converts to INR paise, creates Dodo session
│   │   │   ├── verify-payment-and-bid/# POST: validates payment with Dodo SDK and executes place_bid RPC
│   │   │   ├── dodo-webhook/         # POST: Standard Webhooks HMAC verification and orphaned bid recovery
│   │   │   ├── fetch-logo/           # POST: SSRF-protected URL verification and icon discovery pipeline
│   │   │   ├── track-click/          # POST: IP-rate-limited proxy to increment_click RPC
│   │   │   └── track-visit/          # POST: IP-rate-limited proxy to increment_visit_count RPC
│   │   └── terms/
│   │       └── page.tsx              # Terms of Service and platform policies
│   ├── components/
│   │   ├── Globe.tsx                 # 3D Earth sphere with orbital controls and WebGL error boundary
│   │   ├── GlobeFallback.tsx         # Non-WebGL fallback message retaining layout geometry
│   │   ├── RegionPin.tsx             # 3D HTML marker positioned via lat/long coordinates with camera culling
│   │   └── BidModal.tsx              # Modal handling URL input, logo preview, delta calculation, and Dodo checkout
│   ├── hooks/
│   │   ├── usePresence.ts            # Manages live connection tracking via Supabase Realtime Presence
│   │   ├── useRealtimeSpots.ts       # Subscribes to spots & contribution click changes via WebSockets
│   │   └── useSiteStats.ts           # Tracks unique session visits and synchronizes live count updates
│   ├── lib/
│   │   ├── bids.ts                   # Client-side fire-and-forget click tracking helper
│   │   ├── currency.ts               # USD-to-INR conversion logic (fixed rate to INR paise)
│   │   ├── dodo.ts                   # Server-only Dodo Payments SDK client instance
│   │   ├── latLngToVector3.ts        # Mathematical projection from latitude/longitude to 3D Cartesian coordinates
│   │   ├── supabase.ts               # Browser-safe public Supabase client (anon key)
│   │   └── supabaseAdmin.ts          # Server-only administrative Supabase client (service_role key)
│   ├── middleware.ts                 # Edge middleware enforcing valid session & ADMIN_EMAIL for /admin
│   └── types/
│       └── spot.ts                   # TypeScript definition matching the `spots` PostgreSQL schema
├── supabase/
│   ├── config.toml                   # Local Supabase CLI configuration
│   ├── functions/
│   │   └── health/                   # Edge Function health-check
│   └── migrations/
│       └── 20260830000000_init.sql   # Initial schema migration
├── scripts/
│   ├── test-dodo-checkout.ts         # Automated test: product retrieval, currency conversion & session creation
│   ├── test-dodo-webhook.ts          # Automated test: HMAC signature validation & payload tampering checks
│   └── test-fetch-logo-api.ts        # Automated test: logo discovery pipeline across diverse domain targets
├── .env.example                      # Template defining required environment variables
├── package.json                      # Project dependencies, build scripts, and metadata
└── tsconfig.json                     # TypeScript compiler configuration
```

---

## Environment Variables

All variables referenced in `.env.example` must be configured for the application to function:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public URL for your Supabase project instance (accessible by the browser). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anonymous API key for client-side queries (enforces Row Level Security). |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret administrative key for server-side operations (bypasses RLS; never exposed to browser). |
| `ADMIN_EMAIL` | Specific email address authorized to access the `/admin` dashboard. |
| `DODO_API_KEY` | Secret API key used by the backend to authenticate with the Dodo Payments API. |
| `DODO_PRODUCT_ID` | Dodo Payments Product ID configured with pay-what-you-want pricing in USD. |
| `NEXT_PUBLIC_DODO_MODE` | Payment operational mode (`test` or `live`) configuring the Dodo Checkout overlay. |
| `DODO_WEBHOOK_SECRET` | Secret key used to verify Standard Webhooks HMAC signatures on incoming Dodo webhook payloads. |

---

## Local Development Setup

### Prerequisites

- **Node.js**: Version 18.17.0 or higher
- **Supabase Project**: An active Supabase project with database schema, functions (`place_bid`, `increment_click`, `increment_visit_count`, `check_rate_limit`), and views (`admin_total_revenue`, `admin_spot_summary`)
- **Dodo Payments Account**: An account with test mode enabled and a pay-what-you-want product configured

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/bidthatshii.git
   cd bidthatshii
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and provide your credentials for Supabase, Dodo Payments, and the administrator email.

4. **Verify payment and API integrations (optional):**
   ```bash
   # Test Dodo checkout session creation and currency conversion
   npx tsx scripts/test-dodo-checkout.ts

   # Test webhook signature verification logic
   npx tsx scripts/test-dodo-webhook.ts

   # Test logo discovery pipeline against live domains
   npx tsx scripts/test-fetch-logo-api.ts
   ```

5. **Start the local development server:**
   ```bash
   npm run dev
   ```

6. **Access the application:**
   - Public Globe & Auction: [http://localhost:3000](http://localhost:3000)
   - Admin Dashboard: [http://localhost:3000/admin](http://localhost:3000/admin) (Log in with the account corresponding to `ADMIN_EMAIL`)

---

## Security & Architecture Notes

### Server-Side API Isolation & Service-Role Client
All state-mutating operations — placing bids, recording advertiser clicks, and incrementing unique visits — execute exclusively through Next.js server-side Route Handlers (`/api/*`). These routes utilize a private `supabaseAdmin` client initialized with `SUPABASE_SERVICE_ROLE_KEY`. Direct browser invocation of sensitive database functions is blocked, ensuring that client-side manipulation of headers, parameters, or session storage cannot bypass business rules.

### Defensive Postgres Grants & Revocations
As a defense-in-depth measure beyond Row Level Security (RLS), public database roles (`anon` and `authenticated`) have had explicit table and function privileges revoked in Postgres:
```sql
REVOKE EXECUTE ON FUNCTION place_bid FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_click FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_visit_count FROM anon, authenticated;
```
Because anonymous and authenticated users cannot invoke these functions directly via the Supabase REST/RPC API, the only execution pathway is through the backend API routes where rate limiting and payment verification are strictly enforced.

### Real Client IP Rate Limiting
Rate limiting does not rely on client-supplied UUIDs or browser cookies, which are easily cleared or spoofed. Instead, the backend extracts the verified client IP from trusted reverse-proxy headers (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`) and evaluates limits via the `check_rate_limit` Postgres RPC.

### URL Normalization for Consistent Identity Matching
Advertiser URLs are systematically sanitized and normalized prior to database storage and contribution checks (converting to lowercase, trimming whitespace, stripping duplicate trailing slashes, and prefixing `https://`). This guarantees that `example.com`, `http://example.com`, and `https://example.com/` resolve to the exact same advertiser identity record, preventing fragmented contribution totals and ensuring returning bidders receive credit for previous payments.

### The Cumulative Delta-Payment Mechanic
Each spot tracks the leader's cumulative investment in `current_highest_total`. When placing a bid, the bidder inputs their target total (which must satisfy `target >= current_highest_total + min_increment`). The system queries the `contributions` table for prior amounts contributed by that specific advertiser URL on that spot:
$$\text{Amount Due} = \max(0, \text{Target Bid} - \text{Existing Contribution})$$
- Returning bidders only pay the difference required to take the lead.
- The `place_bid` stored procedure locks the relevant row in `spots` (`SELECT ... FOR UPDATE`), performs validation, records a `bid_events` audit entry, updates the `contributions` ledger, and assigns the new winner in an atomic transaction.

---

## Known Limitations

- **Automated Content Moderation Only**: Beyond automated SSRF prevention, URL protocol verification, and image header validation, there is no manual human review pipeline or automated NSFW image filtering on submitted advertiser logos and destination links.
- **Single-Email Admin Access**: The administration portal restricts access using a single hardcoded `ADMIN_EMAIL` environment variable checked in Edge middleware, rather than a multi-user Role-Based Access Control (RBAC) permissions matrix.
- **Fixed Currency Exchange Rate**: The USD-to-INR conversion uses a fixed calculation rate (`USD_TO_INR_RATE = 94.466`) in `src/lib/currency.ts` rather than fetching dynamic, real-time FX market rates via a live foreign exchange API.

---

## License

All rights reserved. Proprietary software — see project repository terms for licensing updates.
