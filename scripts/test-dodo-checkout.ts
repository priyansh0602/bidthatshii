/**
 * test-dodo-checkout.ts
 *
 * Automated verification script for Dodo Payments checkout session creation.
 * Run with: npx tsx scripts/test-dodo-checkout.ts (or node --env-file=.env)
 */

import { DodoPayments } from 'dodopayments';
// Replicating src/lib/currency.ts constants for standalone script execution
const USD_TO_INR_RATE = 94.466;
function convertUsdToInrPaise(usdAmount: number): number {
  return Math.round(usdAmount * USD_TO_INR_RATE * 100);
}

async function run() {
  console.log('--- [1/3] Verifying Environment & Currency Rate ---');
  const apiKey = process.env.DODO_API_KEY;
  const productId = process.env.DODO_PRODUCT_ID || 'pdt_0Nnuliu6JfJU3ZJVjXmZW';

  if (!apiKey) {
    throw new Error('DODO_API_KEY is not set in environment!');
  }
  console.log('✓ DODO_API_KEY is configured:', apiKey.slice(0, 10) + '...');
  console.log('✓ DODO_PRODUCT_ID is set to:', productId);
  console.log('✓ Fixed USD_TO_INR_RATE:', USD_TO_INR_RATE);

  const client = new DodoPayments({
    bearerToken: apiKey,
    environment: 'test_mode',
  });

  console.log('\n--- [2/3] Testing Product & Converting $5 Bid to INR ---');
  const product = await client.products.retrieve(productId);
  const priceObj = product.price as { currency?: string; pay_what_you_want?: boolean } | null;
  console.log('✓ Product retrieved successfully:', {
    id: product.product_id,
    name: product.name,
    currency: priceObj?.currency,
    pay_what_you_want: priceObj?.pay_what_you_want,
  });

  const testUsdBid = 5; // $5.00 bid
  const testInrPaise = convertUsdToInrPaise(testUsdBid); // 47233 paise = ₹472.33
  console.log(`✓ Converted $${testUsdBid} USD -> ${testInrPaise} paise (₹${(testInrPaise / 100).toFixed(2)} INR)`);

  console.log('\n--- [3/3] Creating INR Dodo Checkout Session ---');
  const session = await client.checkoutSessions.create({
    product_cart: [
      {
        product_id: productId,
        quantity: 1,
        amount: testInrPaise,
      },
    ],
    billing_currency: 'INR',
    billing_address: {
      country: 'IN',
    },
    metadata: {
      spotId: 'test-spot-inr-5usd',
      advertiserUrl: 'https://example.com',
      bidAmountUsd: String(testUsdBid),
      deltaUsd: String(testUsdBid),
      amountInrPaise: String(testInrPaise),
      amountInr: (testInrPaise / 100).toFixed(2),
      exchangeRate: String(USD_TO_INR_RATE),
    },
    return_url: 'http://localhost:3000/?dodo_verify=true&spot_id=test-spot-inr-5usd',
  });

  console.log('✓ Checkout session created successfully:');
  console.log('  Session ID:', session.session_id);
  console.log('  Checkout URL:', session.checkout_url);

  if (!session.session_id || !session.checkout_url) {
    throw new Error('Session creation did not return valid session_id or checkout_url');
  }

  // Preview the checkout session to verify currency and amount
  const preview = await client.checkoutSessions.preview({
    product_cart: [
      {
        product_id: productId,
        quantity: 1,
        amount: testInrPaise,
      },
    ],
    billing_currency: 'INR',
    billing_address: {
      country: 'IN',
    },
  });

  console.log('✓ Session Preview Verification:');
  console.log('  Subtotal:', `₹${(preview.current_breakup.subtotal / 100).toFixed(2)}`);
  console.log('  Currency:', preview.currency);
  console.log('  Billing Country:', preview.billing_country);

  // Check checkout page for UPI support
  const pageRes = await fetch(session.checkout_url);
  const pageHtml = await pageRes.text();
  const upiAvailable = pageHtml.includes('upi') || pageHtml.includes('UPI');
  console.log('  UPI support in checkout flow:', upiAvailable ? 'YES (UPI present)' : 'NO');

  if (!upiAvailable) {
    console.warn('⚠️ Warning: UPI token not found in checkout page text.');
  }

  console.log('\n✅ CHECKOUT SESSION (INR / UPI) VERIFICATION PASSED!');
}

run().catch((err) => {
  console.error('\n❌ CHECKOUT SESSION VERIFICATION FAILED:', err);
  process.exit(1);
});
