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

// ---------------------------------------------------------------------------
// Image validation helper: verifies URL returns valid image with non-zero size
// ---------------------------------------------------------------------------
function isValidImageBuffer(buf: ArrayBuffer, contentType: string): boolean {
  if (!buf || buf.byteLength === 0) return false;
  const lowerType = contentType.toLowerCase();
  if (lowerType.startsWith('image/')) return true;

  if (lowerType === 'application/octet-stream' && buf.byteLength >= 4) {
    const bytes = new Uint8Array(buf.slice(0, 4));
    // ICO: 00 00 01 00
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return true;
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
    // JPG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
    // GIF: 47 49 46
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  }
  return false;
}

async function verifyImageUrl(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (isPrivateOrLoopback(parsed.hostname)) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    clearTimeout(timer);

    // Google favicon service returns 404 with a valid default globe PNG when domain is unindexed
    const isGoogleService = url.includes('google.com/s2/favicons');
    const isOkStatus = (res.status >= 200 && res.status < 400) || (isGoogleService && res.status === 404);
    if (!isOkStatus) return false;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return false;
    }

    const buf = await res.arrayBuffer();
    return isValidImageBuffer(buf, contentType);
  } catch {
    return false;
  }
}

function extractIconCandidatesFromHtml(html: string, origin: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (rawHref: string | undefined | null) => {
    if (!rawHref) return;
    const trimmed = rawHref.trim();
    if (!trimmed || trimmed.startsWith('data:')) return;
    try {
      const resolved = new URL(trimmed, origin).href;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        candidates.push(resolved);
      }
    } catch {}
  };

  // 1. Apple touch icon
  const appleMatches = html.matchAll(/<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["']/gi);
  for (const m of appleMatches) addCandidate(m[1]);
  const appleMatchesRev = html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["']/gi);
  for (const m of appleMatchesRev) addCandidate(m[1]);

  // 2. Standard icons
  const iconMatches = html.matchAll(/<link[^>]+rel=["'](?:shortcut |alternate )?icon["'][^>]+href=["']([^"']+)["']/gi);
  for (const m of iconMatches) addCandidate(m[1]);
  const iconMatchesRev = html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut |alternate )?icon["']/gi);
  for (const m of iconMatchesRev) addCandidate(m[1]);

  // 3. OpenGraph images
  const ogMatches = html.matchAll(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/gi);
  for (const m of ogMatches) addCandidate(m[1]);
  const ogMatchesRev = html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/gi);
  for (const m of ogMatchesRev) addCandidate(m[1]);

  // 4. Twitter images
  const twitterMatches = html.matchAll(/<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi);
  for (const m of twitterMatches) addCandidate(m[1]);
  const twitterMatchesRev = html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image["']/gi);
  for (const m of twitterMatchesRev) addCandidate(m[1]);

  return candidates;
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
    const domain = parsedUrl.hostname;

    // ---------------------------------------------------------------------------
    // Step 1: Reachability check + HTML fetch
    // ---------------------------------------------------------------------------
    let reachable = false;
    let reachabilityError: string | undefined;
    let htmlContent: string | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(parsedUrl.href, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
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
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          htmlContent = await res.text();
        }
      } else if (res.status === 403) {
        // 403 typically indicates bot protection (e.g. Cloudflare) rather than missing site.
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

    // If unreachable, return immediately
    if (!reachable) {
      return NextResponse.json<FetchLogoResponse>({
        logoUrl: null,
        found: false,
        reachable: false,
        error: reachabilityError,
      });
    }

    // ---------------------------------------------------------------------------
    // Step 2: Build airtight prioritized candidate list
    //
    // 1. Extracted icons from HTML (<link rel="icon">, apple-touch-icon, og:image)
    // 2. {origin}/favicon.ico
    // 3. Google Favicon Service (domain & domain_url fallbacks)
    // ---------------------------------------------------------------------------
    const candidateList: string[] = [];

    if (htmlContent) {
      const extracted = extractIconCandidatesFromHtml(htmlContent, origin);
      for (const cand of extracted) {
        candidateList.push(cand);
      }
    }

    // Direct root favicon guess
    candidateList.push(`${origin}/favicon.ico`);

    // Google Favicon Service fallbacks
    candidateList.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
    candidateList.push(`https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(origin)}`);

    // ---------------------------------------------------------------------------
    // Step 3: Verify candidate returns a valid image (correct mime type & non-zero size)
    // ---------------------------------------------------------------------------
    let verifiedLogoUrl: string | null = null;

    for (const candidate of candidateList) {
      if (!candidate) continue;
      const isValid = await verifyImageUrl(candidate);
      if (isValid) {
        verifiedLogoUrl = candidate;
        break;
      }
    }

    // ---------------------------------------------------------------------------
    // Step 4: Final safety net placeholder (stored locally in /public)
    // ---------------------------------------------------------------------------
    if (!verifiedLogoUrl) {
      verifiedLogoUrl = '/default-globe.svg';
    }

    return NextResponse.json<FetchLogoResponse>({
      logoUrl: verifiedLogoUrl,
      found: true,
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
