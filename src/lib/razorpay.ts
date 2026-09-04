/**
 * razorpay.ts — SERVER-SIDE ONLY
 *
 * ⚠️ WARNING: This file initialises a Razorpay client instance using RAZORPAY_KEY_ID
 * and RAZORPAY_KEY_SECRET. It must ONLY be used on the server side and NEVER imported
 * into client components or exposed to the browser.
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

import Razorpay from 'razorpay';

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

if (!keyId) {
  console.warn('[razorpay] Warning: RAZORPAY_KEY_ID is not set in environment variables.');
}

if (!keySecret) {
  console.warn('[razorpay] Warning: RAZORPAY_KEY_SECRET is not set in environment variables.');
}

export const razorpay = new Razorpay({
  key_id: keyId || '',
  key_secret: keySecret || '',
});
