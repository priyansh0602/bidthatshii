import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { dodo } from '@/lib/dodo';

/**
 * POST /api/verify-payment-and-bid
 *
 * Verifies Dodo payment status server-side using the Dodo Payments SDK.
 * Rejects the request if the payment has not succeeded and does NOT proceed with placing the bid.
 * On success, invokes the `place_bid` Postgres function via the service_role admin client.
 *
 * Request body:
 *   { paymentId?, sessionId?, spotId, advertiserUrl, logoUrl, bidAmount? }
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
    paymentId?: unknown;
    payment_id?: unknown;
    sessionId?: unknown;
    session_id?: unknown;
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

  const paymentId = (body.paymentId || body.payment_id) as string | undefined;
  const sessionId = (body.sessionId || body.session_id) as string | undefined;
  const { spotId, advertiserUrl, logoUrl, bidAmount } = body;

  if (!paymentId && !sessionId) {
    return NextResponse.json(
      { error: 'Either paymentId or sessionId is required.' },
      { status: 400 }
    );
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

  let resolvedPaymentReference = paymentId;
  let isPaymentVerified = false;

  // ── 2. Verify payment status with Dodo Payments ────────────────────────────
  try {
    if (paymentId && paymentId.startsWith('pay_')) {
      const payment = await dodo.payments.retrieve(paymentId);
      if (payment && payment.status === 'succeeded') {
        isPaymentVerified = true;
        resolvedPaymentReference = payment.payment_id;
      } else {
        console.warn('[verify-payment-and-bid] Payment status not succeeded:', payment?.status);
      }
    } else if (sessionId) {
      const session = await dodo.checkoutSessions.retrieve(sessionId);
      if (session.payment_status === 'succeeded') {
        isPaymentVerified = true;
        resolvedPaymentReference = session.payment_id || sessionId;
      } else if (session.payment_id) {
        const payment = await dodo.payments.retrieve(session.payment_id);
        if (payment && payment.status === 'succeeded') {
          isPaymentVerified = true;
          resolvedPaymentReference = payment.payment_id;
        }
      }
    }
  } catch (err: unknown) {
    const errorDetails =
      err && typeof err === 'object'
        ? JSON.stringify(err, Object.getOwnPropertyNames(err))
        : String(err);
    console.error('[verify-payment-and-bid] Error querying Dodo API:', errorDetails);
    return NextResponse.json(
      { error: 'Failed to verify payment with Dodo Payments API.' },
      { status: 502 }
    );
  }

  if (!isPaymentVerified || !resolvedPaymentReference) {
    console.warn('[verify-payment-and-bid] Payment verification failed.', {
      paymentId,
      sessionId,
    });
    return NextResponse.json(
      {
        success: false,
        charged: 0,
        new_total: 0,
        new_highest: 0,
        message: 'Payment verification failed: Payment is not completed or succeeded.',
      },
      { status: 400 }
    );
  }

  // ── 3. Check for existing bid_event (Idempotency) ──────────────────────────
  try {
    const { data: existingBidEvent } = await supabaseAdmin
      .from('bid_events')
      .select('id, spot_id, advertiser_id_url, amount_charged')
      .eq('payment_reference', resolvedPaymentReference)
      .maybeSingle();

    if (existingBidEvent) {
      console.log('[verify-payment-and-bid] Payment already applied to bid_event:', {
        paymentReference: resolvedPaymentReference,
        bidEventId: existingBidEvent.id,
      });
      return NextResponse.json(
        {
          success: true,
          charged: Number(existingBidEvent.amount_charged ?? 0),
          new_total: 0,
          new_highest: 0,
          message: 'Payment already verified and bid placed.',
        },
        { status: 200 }
      );
    }
  } catch (err) {
    console.error('[verify-payment-and-bid] Idempotency check error:', err);
  }

  // ── 4. Extract client IP & rate limiting ────────────────────────────────────
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

  // ── 5. Call place_bid via service_role admin client ────────────────────────
  const rpcParams: Record<string, unknown> = {
    p_spot_id: spotId,
    p_advertiser_url: advertiserUrl,
    p_logo_url: logoUrl,
    p_payment_reference: resolvedPaymentReference,
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
      {
        error:
          'An unexpected error occurred while placing your bid. Please contact support with payment ID: ' +
          resolvedPaymentReference,
      },
      { status: 500 }
    );
  }
}
