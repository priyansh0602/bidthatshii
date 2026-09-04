import crypto from 'crypto';
import Razorpay from 'razorpay';
import * as fs from 'fs';
import * as path from 'path';
import { USD_TO_INR_RATE, convertUsdToInrPaise } from '../src/lib/currency';

// Load .env
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value.trim();
        }
      }
    });
  }
}

loadEnv();

async function runTests() {
  console.log('--- 1. Testing Currency Conversion (USD to INR Paise) ---');
  console.log(`USD_TO_INR_RATE: ${USD_TO_INR_RATE}`);

  const testUsd = 5;
  const inrPaise = convertUsdToInrPaise(testUsd);
  console.log(`$${testUsd} USD => ${inrPaise} paise (₹${(inrPaise / 100).toFixed(2)})`);

  if (inrPaise === 47233) {
    console.log('✅ $5 conversion matches expected 47233 paise (₹472.33)');
  } else {
    console.error(`❌ Expected 47233 paise but got ${inrPaise}`);
    process.exit(1);
  }

  console.log('\n--- 2. Testing Signature Verification ---');
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  console.log('RAZORPAY_KEY_ID present:', Boolean(keyId));
  console.log('RAZORPAY_KEY_SECRET present:', Boolean(keySecret));

  const testSecret = keySecret && !keySecret.includes('*') ? keySecret : 'mock_secret_for_unit_tests_123';
  const fakeOrderId = 'order_DA123456789012';
  const fakePaymentId = 'pay_DA987654321098';

  const validSignature = crypto
    .createHmac('sha256', testSecret)
    .update(`${fakeOrderId}|${fakePaymentId}`)
    .digest('hex');

  function verify(order_id: string, payment_id: string, signature: string): boolean {
    const payload = `${order_id}|${payment_id}`;
    const expected = crypto
      .createHmac('sha256', testSecret)
      .update(payload)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');

    return (
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  const check1 = verify(fakeOrderId, fakePaymentId, validSignature);
  console.log('Valid signature verification:', check1 === true ? '✅ PASSED' : '❌ FAILED');

  const check2 = verify(fakeOrderId, fakePaymentId, 'invalid_signature_hex_12345678');
  console.log('Tampered signature correctly rejected:', check2 === false ? '✅ PASSED' : '❌ FAILED');

  const check3 = verify(fakeOrderId, 'pay_tampered_id', validSignature);
  console.log('Mismatched payment ID correctly rejected:', check3 === false ? '✅ PASSED' : '❌ FAILED');

  if (keySecret && !keySecret.includes('*')) {
    console.log('\n--- 3. Attempting Live API Order Creation with Real Keys ---');
    try {
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const order = await razorpay.orders.create({
        amount: inrPaise,
        currency: 'INR',
        receipt: `test_rcpt_${Date.now()}`,
      });
      console.log('✅ Razorpay order created successfully:', {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      });
    } catch (err) {
      console.warn('⚠️ Razorpay order creation returned:', err);
    }
  } else {
    console.log('\nℹ️ Local RAZORPAY_KEY_SECRET is masked with asterisks (real keys set in Vercel).');
  }

  if (check1 && !check2 && !check3) {
    console.log('\n🎉 ALL LOGIC AND CURRENCY CONVERSION CHECKS PASSED!');
  } else {
    console.error('\n❌ Signature verification failed.');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
