import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/verify-payment-and-bid
 *
 * Verifies Razorpay payment signature server-side using HMAC SHA256 and RAZORPAY_KEY_SECRET.
 * Rejects the request if signature verification fails and does NOT proceed with placing the bid.
 * On success, invokes the `place_bid` Postgres function via the service_role admin client.
 *
 * Request body:
 *   { razorpay_payment_id, razorpay_order_id, razorpay_signature, spotId, advertiserUrl, logoUrl, bidAmount }
 */

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body: {
    razorpay_payment_id?: unknown;
    razorpay_order_id?: unknown;
    razorpay_signature?: unknown;
    spotId?: unknown;
    advertiserUrl?: unknown;
    logoUrl?: unknown;
    bidAmount?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const {
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    spotId,
    advertiserUrl,
    logoUrl,
    bidAmount,
  } = body;

  if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string') {
    return NextResponse.json({ error: 'razorpay_payment_id is required.' }, { status: 400 });
  }
  if (!razorpay_order_id || typeof razorpay_order_id !== 'string') {
    return NextResponse.json({ error: 'razorpay_order_id is required.' }, { status: 400 });
  }
  if (!razorpay_signature || typeof razorpay_signature !== 'string') {
    return NextResponse.json({ error: 'razorpay_signature is required.' }, { status: 400 });
  }
  if (!spotId || typeof spotId !== 'string') {
    return NextResponse.json({ error: 'spotId is required.' }, { status: 400 });
  }
  if (!advertiserUrl || typeof advertiserUrl !== 'string') {
    return NextResponse.json({ error: 'advertiserUrl is required.' }, { status: 400 });
  }
  if (!logoUrl || typeof logoUrl !== 'string') {
    return NextResponse.json({ error: 'logoUrl is required.' }, { status: 400 });
  }

  // ── 2. Verify Razorpay signature ───────────────────────────────────────────
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    console.error('[verify-payment-and-bid] RAZORPAY_KEY_SECRET is not set.');
    return NextResponse.json(
      { error: 'Server payment configuration error.' },
      { status: 500 }
    );
  }

  const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(razorpay_signature, 'utf8');

  const isSignatureValid =
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer);

  if (!isSignatureValid) {
    console.warn('[verify-payment-and-bid] Signature verification failed.', {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
    });
    return NextResponse.json(
      {
        success: false,
        charged: 0,
        new_total: 0,
        new_highest: 0,
        message: 'Payment verification failed: Invalid signature.',
      },
      { status: 400 }
    );
  }

  // ── 3. Extract client IP & rate limiting ────────────────────────────────────
  const clientIp = getClientIp(req);

  try {
    const { data: rateLimitData, error: rateLimitError } = await supabaseAdmin.rpc(
      'check_rate_limit',
      {
        p_identifier: clientIp,
        p_action: 'place_bid',
        p_max_requests: 10,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error('[verify-payment-and-bid] Rate limit check error:', rateLimitError.message);
    } else if (rateLimitData === false) {
      return NextResponse.json(
        { error: 'Too many requests — please wait a moment and try again.' },
        { status: 429 }
      );
    }
  } catch (err) {
    console.error('[verify-payment-and-bid] Unexpected error during rate limit check:', err);
  }

  // ── 4. Call place_bid via service_role admin client ────────────────────────
  const rpcParams: Record<string, unknown> = {
    p_spot_id: spotId,
    p_advertiser_url: advertiserUrl,
    p_logo_url: logoUrl,
    p_payment_reference: razorpay_payment_id,
    p_identifier: clientIp,
  };

  if (bidAmount !== undefined && bidAmount !== null) {
    rpcParams.p_custom_amount = Number(bidAmount);
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('place_bid', rpcParams);

    if (error) {
      console.error('[verify-payment-and-bid] RPC error:', error.message);
      return NextResponse.json(
        {
          success: false,
          charged: 0,
          new_total: 0,
          new_highest: 0,
          message: error.message,
        },
        { status: 400 }
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    const httpStatus = result?.success ? 200 : 400;

    return NextResponse.json(
      {
        success: Boolean(result?.success),
        charged: Number(result?.charged ?? 0),
        new_total: Number(result?.new_total ?? 0),
        new_highest: Number(result?.new_highest ?? 0),
        message: String(result?.message ?? ''),
      },
      { status: httpStatus }
    );
  } catch (err) {
    console.error('[verify-payment-and-bid] Unexpected error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while placing your bid. Please contact support with payment ID: ' + razorpay_payment_id },
      { status: 500 }
    );
  }
}
