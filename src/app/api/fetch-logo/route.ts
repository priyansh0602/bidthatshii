import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/fetch-logo
 *
 * Verifies that a submitted URL is reachable (basic SSRF protection included),
 * then attempts to discover a logo/favicon for it.
 *
 * Response shape:
 *   { logoUrl: string | null, found: boolean, reachable: boolean, error?: string }
 */

// ---------------------------------------------------------------------------
// In-memory rate limiter
//
// Limits each client (identified by IP) to RATE_LIMIT_MAX_REQUESTS requests
// within a RATE_LIMIT_WINDOW_MS rolling window.
//
// NOTE: This in-memory store is intentionally simple and works well for a
// single Next.js development server instance. It will NOT be reliable across
// multiple serverless function instances (e.g. Vercel / AWS Lambda) because
// each cold-started instance maintains its own isolated memory — a client
// could saturate one instance while other instances have zero state for them.
// At deploy time, consider replacing this with a shared store such as
// Upstash Redis (@upstash/ratelimit) or a Vercel KV-backed counter.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds

/** Maps an identifier string to an array of request timestamps (ms). */
const requestLog = new Map<string, number[]>();

/**
 * Returns true when the identifier has exceeded the rate limit.
 * Mutates requestLog to record the current request timestamp.
 */
function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Retrieve and prune timestamps outside the current window.
  const timestamps = (requestLog.get(identifier) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    // Store the pruned list (without the new request) so the window stays accurate.
    requestLog.set(identifier, timestamps);
    return true;
  }

  // Record this request and persist.
  timestamps.push(now);
  requestLog.set(identifier, timestamps);
  return false;
}

/**
 * Extracts the best-effort client IP from Next.js request headers.
 * Falls back to a generic key so the limiter still works even when no IP
 * header is present (e.g. local development without a reverse proxy).
 */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// SSRF protection: block private / loopback / non-http(s) hostnames
// ---------------------------------------------------------------------------
function isPrivateOrLoopback(hostname: string): boolean {
  // Strip IPv6 brackets
  const host = hostname.replace(/^\[|\]$/g, '');

  // Loopback and localhost
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.localhost')) return true;

  // IPv4 private / link-local ranges
  const ipv4 = host.split('.').map(Number);
  if (ipv4.length === 4 && ipv4.every((n) => !isNaN(n))) {
    const [a, b] = ipv4;
    if (a === 10) return true;                             // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12
    if (a === 192 && b === 168) return true;               // 192.168.0.0/16
    if (a === 169 && b === 254) return true;               // 169.254.0.0/16 link-local
    if (a === 0) return true;                              // 0.x.x.x
    if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64.0.0/10 carrier-grade NAT
  }

  // metadata service addresses (AWS, GCP, Azure)
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return true;

  return false;
}

function isAllowedProtocol(protocol: string): boolean {
  return protocol === 'https:' || protocol === 'http:';
}

type FetchLogoResponse = {
  logoUrl: string | null;
  found: boolean;
  reachable: boolean;
  error?: string;
};

export async function POST(req: NextRequest) {
  // --- Rate limiting ---
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return NextResponse.json<FetchLogoResponse>(
      {
        logoUrl: null,
        found: false,
        reachable: false,
        error: 'Too many logo fetch requests — please wait a moment and try again',
      },
      { status: 429 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    let rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';

    if (!rawUrl) {
      return NextResponse.json<FetchLogoResponse>({
        logoUrl: null,
        found: false,
        reachable: false,
        error: 'No URL provided',
      });
    }

    // Auto-prefix https:// if no protocol given
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      rawUrl = `https://${rawUrl}`;
    }

    // --- Parse & validate URL ---
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return NextResponse.json<FetchLogoResponse>({
        logoUrl: null,
        found: false,
        reachable: false,
        error: 'Invalid URL format',
      });
    }

    // Require http or https
    if (!isAllowedProtocol(parsedUrl.protocol)) {
      return NextResponse.json<FetchLogoResponse>({
        logoUrl: null,
        found: false,
        reachable: false,
        error: 'Only http:// and https:// URLs are allowed',
      });
    }

    // Require a recognisable public hostname (must contain a dot)
    if (!parsedUrl.hostname || !parsedUrl.hostname.includes('.')) {
      return NextResponse.json<FetchLogoResponse>({
        logoUrl: null,
        found: false,
        reachable: false,
        error: 'URL must have a valid public hostname (e.g. example.com)',
      });
    }

    // SSRF: block private / loopback addresses
    if (isPrivateOrLoopback(parsedUrl.hostname)) {
      return NextResponse.json<FetchLogoResponse>({
        logoUrl: null,
        found: false,
        reachable: false,
        error: 'Private, local, or reserved addresses are not allowed',
      });
    }

    const origin = parsedUrl.origin;

    // Helper to resolve relative URLs to absolute
    const resolveUrl = (href: string): string => {
      try {
        return new URL(href, origin).href;
      } catch {
        return href;
      }
    };

    // ---------------------------------------------------------------------------
    // Step 1: Reachability check + HTML fetch (combined in one request)
    //
    // Status handling:
    //   - 200–399  → reachable; parse HTML for icons
    //   - 403      → reachable (bot-protection, not a missing site); no HTML
    //   - other 4xx/5xx → unreachable (bad gateway, not found, etc.)
    //   - throws   → unreachable (DNS error, timeout, connection refused)
    //
    // We send realistic browser headers so bot-protection systems (Cloudflare,
    // Akamai, etc.) are less likely to block the request.  The old bot-named
    // User-Agent string ("BidThatShiiBot/1.0") was sufficient reason for many
    // WAFs to immediately return 403.
    // ---------------------------------------------------------------------------
    let reachable = false;
    let discoveredLogoUrl: string | null = null;
    let reachabilityError: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(parsedUrl.href, {
        signal: controller.signal,
        headers: {
          // Mimic a Chrome 124 desktop browser on Windows — realistic enough to
          // pass most bot-protection heuristics without being deceptive.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          // sec-fetch headers are sent by Chrome; their absence is a common bot signal.
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
      });
      clearTimeout(timeoutId);

      if (res.status >= 200 && res.status < 400) {
        reachable = true;

        // Attempt to parse HTML for icon links
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          const html = await res.text();

          // Priority 1: apple-touch-icon
          const appleIconMatch =
            html.match(/<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["']/i) ||
            html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["']/i);

          // Priority 2: link rel="icon" or rel="shortcut icon"
          const iconMatch =
            html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i) ||
            html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i);

          // Priority 3: og:image
          const ogImageMatch =
            html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

          const candidate = appleIconMatch?.[1] || iconMatch?.[1] || ogImageMatch?.[1];
          if (candidate) {
            discoveredLogoUrl = resolveUrl(candidate.trim());
          }
        }
      } else if (res.status === 403) {
        // 403 typically means "this site exists but is blocking bots/scrapers."
        // Treat the site as reachable so users aren't incorrectly told their
        // real, live website is unreachable.  We won't have HTML to parse, so
        // logo discovery will fall through to the favicon.ico / Google fallback.
        reachable = true;
      } else {
        reachabilityError = `Site returned HTTP ${res.status}`;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('aborted') || message.includes('timeout')) {
        reachabilityError = 'Request timed out — the site did not respond within 5 seconds';
      } else {
        reachabilityError = 'Could not reach the URL — check that it is publicly accessible';
      }
    }

    // If unreachable, return immediately without a logo
    if (!reachable) {
      return NextResponse.json<FetchLogoResponse>({
        logoUrl: null,
        found: false,
        reachable: false,
        error: reachabilityError,
      });
    }

    // ---------------------------------------------------------------------------
    // Step 2: Fallback to /favicon.ico if no icon found in HTML
    // ---------------------------------------------------------------------------
    if (!discoveredLogoUrl) {
      const defaultFavicon = `${origin}/favicon.ico`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const favRes = await fetch(defaultFavicon, {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (favRes.ok) {
          discoveredLogoUrl = defaultFavicon;
        }
      } catch {
        // favicon.ico HEAD request failed — fall through to Google fallback
      }
    }

    // ---------------------------------------------------------------------------
    // Step 3: Google Favicon Service as final fallback (always returns an image)
    // ---------------------------------------------------------------------------
    if (!discoveredLogoUrl) {
      discoveredLogoUrl = `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(origin)}`;
    }

    return NextResponse.json<FetchLogoResponse>({
      logoUrl: discoveredLogoUrl,
      found: Boolean(discoveredLogoUrl),
      reachable: true,
    });
  } catch {
    return NextResponse.json<FetchLogoResponse>({
      logoUrl: null,
      found: false,
      reachable: false,
      error: 'Unexpected server error',
    });
  }
}
