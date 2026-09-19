/**
 * test-dodo-checkout.ts
 *
 * Automated verification script for Dodo Payments checkout session creation.
 * Run with: npx tsx scripts/test-dodo-checkout.ts (or node --env-file=.env)
 */

import { DodoPayments } from 'dodopayments';

async function run() {
  console.log('--- [1/2] Verifying Environment Variables ---');
  const apiKey = process.env.DODO_API_KEY;
  const productId = process.env.DODO_PRODUCT_ID || 'pdt_0Nnuliu6JfJU3ZJVjXmZW';

  if (!apiKey) {
    throw new Error('DODO_API_KEY is not set in environment!');
  }
  console.log('✓ DODO_API_KEY is configured:', apiKey.slice(0, 10) + '...');
  console.log('✓ DODO_PRODUCT_ID is set to:', productId);

  const client = new DodoPayments({
    bearerToken: apiKey,
    environment: 'test_mode',
  });

  console.log('\n--- [2/2] Testing Product & Checkout Session Creation ---');
  // 1. Verify product exists
  const product = await client.products.retrieve(productId);
  const priceObj = product.price as { currency?: string; pay_what_you_want?: boolean } | null;
  console.log('✓ Product retrieved successfully:', {
    id: product.product_id,
    name: product.name,
    currency: priceObj?.currency,
    pay_what_you_want: priceObj?.pay_what_you_want,
  });

  // 2. Create test checkout session
  const testAmountCents = 700; // $7.00
  const session = await client.checkoutSessions.create({
    product_cart: [
      {
        product_id: productId,
        quantity: 1,
        amount: testAmountCents,
      },
    ],
    billing_currency: 'USD',
    metadata: {
      spotId: 'test-spot-verif-123',
      advertiserUrl: 'https://example.com',
      bidAmount: '7',
      test: 'true',
    },
    return_url: 'http://localhost:3000/?dodo_verify=true&spot_id=test-spot-verif-123',
  });

  console.log('✓ Checkout session created successfully:');
  console.log('  Session ID:', session.session_id);
  console.log('  Checkout URL:', session.checkout_url);

  if (!session.session_id || !session.checkout_url) {
    throw new Error('Session creation did not return valid session_id or checkout_url');
  }

  console.log('\n✅ CHECKOUT SESSION VERIFICATION PASSED!');
}

run().catch((err) => {
  console.error('\n❌ CHECKOUT SESSION VERIFICATION FAILED:', err);
  process.exit(1);
});
