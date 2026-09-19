export {};

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function isPrivateOrLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.localhost')) return true;
  const ipv4 = host.split('.').map(Number);
  if (ipv4.length === 4 && ipv4.every((n) => !isNaN(n))) {
    const [a, b] = ipv4;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return true;
  return false;
}

function isValidImageBuffer(buf: ArrayBuffer, contentType: string): boolean {
  if (!buf || buf.byteLength === 0) return false;
  const lowerType = contentType.toLowerCase();
  if (lowerType.startsWith('image/')) return true;

  if (lowerType === 'application/octet-stream' && buf.byteLength >= 4) {
    const bytes = new Uint8Array(buf.slice(0, 4));
    // ICO
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return true;
    // PNG
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
    // JPG
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
    // GIF
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  }
  return false;
}

async function verifyImageUrl(url: string, timeoutMs = 3500): Promise<boolean> {
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
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    clearTimeout(timer);

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

  return candidates;
}

async function resolveLogoForUrl(rawUrl: string): Promise<{
  chosenUrl: string;
  source: string;
  attempted: { url: string; valid: boolean }[];
}> {
  const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  const origin = parsed.origin;
  const domain = parsed.hostname;

  const candidatePool: { url: string; source: string }[] = [];

  // Step 1: HTML fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(parsed.href, {
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
    clearTimeout(timer);

    if (res.status >= 200 && res.status < 400) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        const html = await res.text();
        const htmlIcons = extractIconCandidatesFromHtml(html, origin);
        for (const iconUrl of htmlIcons) {
          candidatePool.push({ url: iconUrl, source: 'html_tag' });
        }
      }
    }
  } catch {}

  // Step 2: Root /favicon.ico
  candidatePool.push({ url: `${origin}/favicon.ico`, source: 'root_favicon' });

  // Step 3: Google Favicon Service
  candidatePool.push({
    url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    source: 'google_favicon_service',
  });
  candidatePool.push({
    url: `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(origin)}`,
    source: 'google_favicon_service_domain_url',
  });

  const attempted: { url: string; valid: boolean }[] = [];

  for (const item of candidatePool) {
    const valid = await verifyImageUrl(item.url);
    attempted.push({ url: item.url, valid });
    if (valid) {
      return { chosenUrl: item.url, source: item.source, attempted };
    }
  }

  return {
    chosenUrl: '/default-globe.svg',
    source: 'default_placeholder',
    attempted,
  };
}

async function run() {
  const testSites = [
    'https://split-ts.vercel.app',
    'https://example.com', // has NO favicon.ico, no link icon in HTML
    'https://news.ycombinator.com',
    'https://github.com',
  ];

  for (const site of testSites) {
    console.log(`\n==============================================`);
    console.log(`Testing site: ${site}`);
    const result = await resolveLogoForUrl(site);
    console.log(`Chosen logo: ${result.chosenUrl} (source: ${result.source})`);
    console.log(`Candidates tested:`);
    for (const a of result.attempted) {
      console.log(`  [${a.valid ? 'PASS' : 'FAIL'}] ${a.url}`);
    }
  }
}

run();
