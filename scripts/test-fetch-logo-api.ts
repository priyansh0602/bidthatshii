import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/fetch-logo/route';

async function testApi() {
  const testSites = [
    { name: 'SplitTs (HTML icon present, favicon.ico 404)', url: 'https://split-ts.vercel.app' },
    { name: 'Example.com (Minimal: no HTML icon, no favicon.ico -> Google Fallback)', url: 'https://example.com' },
    { name: 'Hacker News (SVG icon)', url: 'https://news.ycombinator.com' },
    { name: 'GitHub (PNG favicon)', url: 'https://github.com' },
    { name: 'Unreachable / Nonexistent Domain', url: 'https://nonexistent-domain-xyz-987123.org' },
  ];

  console.log('--- Testing /api/fetch-logo POST Handler ---\n');

  for (const site of testSites) {
    console.log(`Testing: [${site.name}] -> ${site.url}`);
    const req = new NextRequest('http://localhost:3000/api/fetch-logo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '127.0.0.1',
      },
      body: JSON.stringify({ url: site.url }),
    });

    const res = await POST(req);
    const data = await res.json();
    console.log('  Status:', res.status);
    console.log('  Response:', JSON.stringify(data, null, 2));
    console.log('');
  }
}

testApi().catch(console.error);
