import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST /api/razorpay-webhook
 *
 * Backup payment confirmation layer independent of the frontend flow.
 *
 * ARCHITECTURAL NOTE / CURRENT LIMITATION:
 * ----------------------------------------
 * This webhook detects orphaned successful payments (money captured by Razorpay,
 * but no corresponding bid placed in the database) and logs them with high visibility
 * for manual follow-up and reconciliation.
 *
 * It does NOT automatically recover or place the bid because the webhook payload alone
 * does not contain sufficient original bid context (specifically spotId, advertiserUrl,
 * and logoUrl) to safely and deterministically invoke `place_bid` without risking
 * bid mismatches or data corruption.
 *
 * If orphaned payments become a frequent real-world occurrence (e.g. users routinely
 * closing their browser immediately upon payment before the frontend verification RPC completes),
 * the recommended enhancement is:
 *   1. Store a pending bid intent record in a temporary staging table (e.g. `pending_orders`
 *      or `bid_intents`) when the order is created in `/api/create-payment-order`.
 *   2. When this webhook receives `payment.captured` for an unfulfilled bid, look up the
 *      staged intent by `order_id` and automatically invoke `place_bid` to complete the auction flow.
 */

export async function POST(req: NextRequest) {
  // ── 1. Read the raw request body ──────────────────────────────────────────
  // Webhook signature verification requires the exact, unaltered raw payload string.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    console.error('[razorpay-webhook] Failed to read raw request body:', err);
    return NextResponse.json({ error: 'Failed to read request body.' }, { status: 400 });
  }

  // ── 2. Verify Razorpay webhook signature ──────────────────────────────────
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET environment variable is not set.');
    return NextResponse.json(
      { error: 'Webhook secret is not configured on server.' },
      { status: 500 }
    );
  }

  const signature = req.headers.get('x-razorpay-signature');
  if (!signature) {
    console.warn('[razorpay-webhook] Request missing X-Razorpay-Signature header.');
    return NextResponse.json(
      { error: 'Missing webhook signature header.' },
      { status: 400 }
    );
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');

  const isSignatureValid =
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer);

  if (!isSignatureValid) {
    console.warn('[razorpay-webhook] Webhook signature verification failed.');
    return NextResponse.json(
      { error: 'Invalid webhook signature.' },
      { status: 400 }
    );
  }

  // ── 3. Parse event payload ────────────────────────────────────────────────
  let eventPayload: {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          amount?: number;
          currency?: string;
          status?: string;
          email?: string;
          contact?: string;
          notes?: Record<string, unknown>;
          created_at?: number;
        };
      };
    };
  };

  try {
    eventPayload = JSON.parse(rawBody);
  } catch (err) {
    console.error('[razorpay-webhook] Failed to parse JSON event payload:', err);
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400 }
    );
  }

  const eventType = eventPayload?.event;

  // Razorpay requires prompt acknowledgment for all events to avoid retries
  if (eventType !== 'payment.captured') {
    return NextResponse.json(
      { received: true, message: `Ignored unhandled event: ${eventType}` },
      { status: 200 }
    );
  }

  // ── 4. Process payment.captured event ──────────────────────────────────────
  const payment = eventPayload?.payload?.payment?.entity;
  const paymentId = payment?.id;
  const orderId = payment?.order_id;
  const amount = payment?.amount;
  const currency = payment?.currency;

  if (!paymentId) {
    console.warn('[razorpay-webhook] payment.captured event missing payment ID:', eventPayload);
    return NextResponse.json(
      { received: true, warning: 'Payment ID missing from payload.' },
      { status: 200 }
    );
  }

  try {
    // Check whether a bid_event already exists for this payment_reference
    const { data: existingBidEvent, error: dbError } = await supabaseAdmin
      .from('bid_events')
      .select('id, spot_id, advertiser_id_url, amount_charged, created_at')
      .eq('payment_reference', paymentId)
      .maybeSingle();

    if (dbError) {
      console.error('[razorpay-webhook] Database error querying bid_events for payment:', {
        paymentId,
        orderId,
        error: dbError.message,
      });
      // Even if DB query fails, acknowledge 200 to avoid webhook flood from Razorpay
      return NextResponse.json(
        { received: true, error: 'Database check encountered an error.' },
        { status: 200 }
      );
    }

    if (existingBidEvent) {
      // Payment was already successfully handled by /api/verify-payment-and-bid
      console.log('[razorpay-webhook] Payment already applied to bid_event:', {
        paymentId,
        orderId,
        bidEventId: existingBidEvent.id,
        spotId: existingBidEvent.spot_id,
        advertiserUrl: existingBidEvent.advertiser_id_url,
      });

      return NextResponse.json(
        { received: true, status: 'already_processed', bidEventId: existingBidEvent.id },
        { status: 200 }
      );
    }

    // No matching bid_event found — this is an orphaned payment
    console.error(
      '[razorpay-webhook] ⚠️ ORPHANED SUCCESSFUL PAYMENT DETECTED: ' +
      'Payment was captured by Razorpay, but no matching bid_event exists in the database. ' +
      'The user likely closed their browser before the frontend /api/verify-payment-and-bid flow completed. ' +
      'Manual investigation/reconciliation required.',
      {
        paymentId,
        orderId,
        amount,
        currency,
        email: payment?.email,
        contact: payment?.contact,
        notes: payment?.notes,
        capturedAt: payment?.created_at,
        timestamp: new Date().toISOString(),
      }
    );

    return NextResponse.json(
      { received: true, status: 'orphaned_payment_detected', paymentId, orderId },
      { status: 200 }
    );
  } catch (err) {
    console.error('[razorpay-webhook] Unexpected error during payment verification check:', err);
    return NextResponse.json(
      { received: true, error: 'Internal processing error.' },
      { status: 200 }
    );
  }
}
