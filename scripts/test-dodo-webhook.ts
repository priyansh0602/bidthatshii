/**
 * test-dodo-webhook.ts
 *
 * Automated verification script / unit test for Dodo Payments webhook signatures.
 * Verifies:
 *   1. Valid signatures pass unwrap.
 *   2. Tampered payloads are rejected.
 *   3. Tampered signatures are rejected.
 *   4. Expired timestamps are rejected.
 */

import { DodoPayments } from 'dodopayments';
import { Webhook } from 'standardwebhooks';

async function run() {
  console.log('--- Testing Dodo Payments Webhook Signature Verification ---');

  // Standard Webhooks secrets start with whsec_ followed by base64 key
  const testSecret = 'whsec_' + Buffer.from('unit_test_secret_key_32_bytes_long!').toString('base64');
  const wh = new Webhook(testSecret);
  const client = new DodoPayments({
    bearerToken: 'dummy_token',
    webhookKey: testSecret,
  });

  const payload = JSON.stringify({
    type: 'payment.succeeded',
    data: {
      payment_id: 'pay_test_unit_123',
      status: 'succeeded',
      total_amount: 500,
      currency: 'USD',
      metadata: {
        spotId: 'spot-unit-test',
        advertiserUrl: 'https://testdomain.com',
        bidAmount: '5',
      },
    },
  });

  const msgId = 'msg_test_' + Date.now();
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, payload);

  // Test 1: Valid signature passes
  console.log('\n[Test 1] Testing valid signature...');
  try {
    const unwrapped = client.webhooks.unwrap(payload, {
      headers: {
        'webhook-id': msgId,
        'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
        'webhook-signature': signature,
      },
      key: testSecret,
    });
    if ((unwrapped as any)?.data?.payment_id === 'pay_test_unit_123') {
      console.log('✓ Valid signature correctly verified and payload unwrapped.');
    } else {
      throw new Error('Payload mismatch after unwrap.');
    }
  } catch (err) {
    throw new Error(`Test 1 Failed: Valid signature was rejected: ${err}`);
  }

  // Test 2: Tampered payload is rejected
  console.log('\n[Test 2] Testing tampered payload rejection...');
  try {
    const tamperedPayload = JSON.stringify({
      type: 'payment.succeeded',
      data: { payment_id: 'pay_HACKED_999' },
    });
    client.webhooks.unwrap(tamperedPayload, {
      headers: {
        'webhook-id': msgId,
        'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
        'webhook-signature': signature,
      },
      key: testSecret,
    });
    throw new Error('Test 2 Failed: Tampered payload was NOT rejected!');
  } catch (err: any) {
    if (err.message?.includes('Failed')) throw err;
    console.log('✓ Tampered payload successfully rejected:', err.message);
  }

  // Test 3: Invalid signature string is rejected
  console.log('\n[Test 3] Testing invalid signature rejection...');
  try {
    client.webhooks.unwrap(payload, {
      headers: {
        'webhook-id': msgId,
        'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
        'webhook-signature': 'v1,invalid_signature_bits_here',
      },
      key: testSecret,
    });
    throw new Error('Test 3 Failed: Invalid signature was NOT rejected!');
  } catch (err: any) {
    if (err.message?.includes('Failed')) throw err;
    console.log('✓ Invalid signature successfully rejected:', err.message);
  }

  // Test 4: Expired timestamp is rejected
  console.log('\n[Test 4] Testing expired timestamp rejection...');
  try {
    const oldTimestamp = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    const oldSig = wh.sign(msgId, oldTimestamp, payload);
    client.webhooks.unwrap(payload, {
      headers: {
        'webhook-id': msgId,
        'webhook-timestamp': Math.floor(oldTimestamp.getTime() / 1000).toString(),
        'webhook-signature': oldSig,
      },
      key: testSecret,
    });
    throw new Error('Test 4 Failed: Expired timestamp was NOT rejected!');
  } catch (err: any) {
    if (err.message?.includes('Failed')) throw err;
    console.log('✓ Expired timestamp successfully rejected:', err.message);
  }

  console.log('\n✅ ALL WEBHOOK SIGNATURE TESTS PASSED!');
}

run().catch((err) => {
  console.error('\n❌ WEBHOOK UNIT TEST FAILED:', err);
  process.exit(1);
});
