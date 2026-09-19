/**
 * dodo.ts — SERVER-SIDE ONLY
 *
 * ⚠️ WARNING: This file initializes the Dodo Payments client instance using DODO_API_KEY.
 * It must ONLY be used on the server side and NEVER imported into client components or
 * exposed to the browser.
 *
 * NEVER import this file in:
 *   - Any component marked 'use client'
 *   - Any client-side utility, hook, or browser bundle
 *
 * This file MUST only be imported from:
 *   - Next.js API route handlers (/src/app/api/[name]/route.ts)
 *   - Server Actions / Server Components
 *   - Other server-only modules
 */

import { DodoPayments } from 'dodopayments';

const apiKey = process.env.DODO_API_KEY;
const isLive =
  process.env.DODO_MODE === 'live' ||
  process.env.NEXT_PUBLIC_DODO_MODE === 'live' ||
  process.env.DODO_ENVIRONMENT === 'live_mode';

if (!apiKey) {
  console.warn('[dodo] Warning: DODO_API_KEY is not set in environment variables.');
}

export const DODO_PRODUCT_ID =
  process.env.DODO_PRODUCT_ID || 'pdt_0Nnuliu6JfJU3ZJVjXmZW';

export const dodo = new DodoPayments({
  bearerToken: apiKey || '',
  environment: isLive ? 'live_mode' : 'test_mode',
  webhookKey: process.env.DODO_WEBHOOK_SECRET || null,
});
