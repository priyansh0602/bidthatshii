import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { dodo } from '@/lib/dodo';

/**
 * POST /api/dodo-webhook
 *
 * Webhook handler for Dodo Payments events (Standard Webhooks format).
 *
 * Verifies webhook signatures using `dodo.webhooks.unwrap`.
 * When `payment.succeeded` is received:
 *   1. Confirms whether the payment was already applied by `/api/verify-payment-and-bid`.
 *   2. If not yet applied, retries with backoff to accommodate race conditions where the
 *      webhook arrives before frontend redirect completion.
 *   3. If metadata contains spotId, advertiserUrl, and logoUrl, automatically fulfills
 *      orphaned bids, or logs high-visibility alerts for manual reconciliation.
 */

interface WebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
  [key: string]: string;
}

export async function POST(req: NextRequest) {
  // ── 1. Read raw request body ──────────────────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    console.error('[dodo-webhook] Failed to read raw request body:', err);
    return NextResponse.json({ error: 'Failed to read request body.' }, { status: 400 });
  }

  // ── 2. Verify webhook signature ───────────────────────────────────────────
  const webhookSecret = process.env.DODO_WEBHOOK_SECRET;

  const webhookId = req.headers.get('webhook-id');
  const webhookTimestamp = req.headers.get('webhook-timestamp');
  const webhookSignature = req.headers.get('webhook-signature');

  let eventPayload: {
    type?: string;
    data?: Record<string, unknown>;
  };

  if (!webhookSecret) {
    console.warn(
      '[dodo-webhook] DODO_WEBHOOK_SECRET is not set in environment variables. Webhook signature verification bypassed for setup testing.'
    );
    try {
      eventPayload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }
  } else {
    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.warn('[dodo-webhook] Missing required webhook verification headers.');
      return NextResponse.json(
        { error: 'Missing webhook headers (webhook-id, webhook-timestamp, or webhook-signature).' },
        { status: 400 }
      );
    }

    try {
      const headers: WebhookHeaders = {
        'webhook-id': webhookId,
        'webhook-timestamp': webhookTimestamp,
        'webhook-signature': webhookSignature,
      };

      eventPayload = dodo.webhooks.unwrap(rawBody, {
        headers,
        key: webhookSecret,
      }) as unknown as { type?: string; data?: Record<string, unknown> };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[dodo-webhook] Signature verification failed:', message);
      return NextResponse.json(
        { error: `Invalid webhook signature: ${message}` },
        { status: 400 }
      );
    }
  }

  const eventType = eventPayload?.type;

  // Acknowledge all unhandled events with HTTP 200
  if (eventType !== 'payment.succeeded') {
    return NextResponse.json(
      { received: true, message: `Ignored event: ${eventType}` },
      { status: 200 }
    );
  }

  // ── 3. Process payment.succeeded event ────────────────────────────────────
  const paymentData = eventPayload?.data || {};
  const paymentId = (paymentData.payment_id || paymentData.id) as string | undefined;
  const metadata = (paymentData.metadata || {}) as Record<string, string>;

  if (!paymentId) {
    console.warn('[dodo-webhook] payment.succeeded event missing payment ID:', paymentData);
    return NextResponse.json(
      { received: true, warning: 'Payment ID missing from payload.' },
      { status: 200 }
    );
  }

  try {
    // Check if bid_event already exists for this payment_reference
    const { data: existingBidEvent, error: dbError } = await supabaseAdmin
      .from('bid_events')
      .select('id, spot_id, advertiser_id_url, amount_charged, created_at')
      .eq('payment_reference', paymentId)
      .maybeSingle();

    if (dbError) {
      console.error('[dodo-webhook] Database error querying bid_events:', {
        paymentId,
        error: dbError.message,
      });
      return NextResponse.json(
        { received: true, error: 'Database check encountered an error.' },
        { status: 200 }
      );
    }

    if (existingBidEvent) {
      console.log('[dodo-webhook] Payment already applied to bid_event:', {
        paymentId,
        bidEventId: existingBidEvent.id,
      });
      return NextResponse.json(
        { received: true, status: 'already_processed', bidEventId: existingBidEvent.id },
        { status: 200 }
      );
    }

    // Schedule background retry check
    console.log(
      `[dodo-webhook] No bid_event found immediately for payment ${paymentId}. Scheduling background verification window...`
    );

    checkOrphanedPaymentWithRetry({
      paymentId,
      metadata,
      paymentData,
    }).catch((err) => {
      console.error('[dodo-webhook] Background check failed:', err);
    });

    return NextResponse.json(
      { received: true, status: 'pending_verification', paymentId },
      { status: 200 }
    );
  } catch (err) {
    console.error('[dodo-webhook] Unexpected error handling payment:', err);
    return NextResponse.json(
      { received: true, error: 'Internal processing error.' },
      { status: 200 }
    );
  }
}

async function checkOrphanedPaymentWithRetry(details: {
  paymentId: string;
  metadata?: Record<string, string>;
  paymentData?: Record<string, unknown>;
}) {
  const { paymentId, metadata } = details;
  const retryDelays = [7000, 8000];

  for (let i = 0; i < retryDelays.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, retryDelays[i]));

    try {
      const { data: bidEvent, error: dbError } = await supabaseAdmin
        .from('bid_events')
        .select('id, spot_id, advertiser_id_url, amount_charged')
        .eq('payment_reference', paymentId)
        .maybeSingle();

      if (dbError) {
        console.error('[dodo-webhook] Retry DB error:', dbError.message);
        continue;
      }

      if (bidEvent) {
        console.log(
          `[dodo-webhook] Payment confirmed via webhook, bid_event found on attempt ${i + 1} — no action needed.`,
          { paymentId, bidEventId: bidEvent.id }
        );
        return;
      }
    } catch (err) {
      console.error('[dodo-webhook] Error during retry check:', err);
    }
  }

  // If still unfulfilled and metadata has spotId and advertiserUrl, attempt auto-recovery
  const spotId = metadata?.spotId;
  const advertiserUrl = metadata?.advertiserUrl;
  const customAmount = metadata?.bidAmount ? Number(metadata.bidAmount) : undefined;
  const logoUrl =
    metadata?.logoUrl ||
    (advertiserUrl
      ? `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(advertiserUrl)}`
      : undefined);

  if (spotId && advertiserUrl && logoUrl) {
    console.log(
      `[dodo-webhook] Attempting automatic bid placement for orphaned payment ${paymentId}...`
    );

    try {
      const rpcParams: Record<string, unknown> = {
        p_spot_id: spotId,
        p_advertiser_url: advertiserUrl,
        p_logo_url: logoUrl,
        p_payment_reference: paymentId,
        p_identifier: 'dodo-webhook-recovery',
      };
      if (customAmount) {
        rpcParams.p_custom_amount = customAmount;
      }

      const { data, error } = await supabaseAdmin.rpc('place_bid', rpcParams);
      if (!error && (Array.isArray(data) ? data[0]?.success : data?.success)) {
        console.log(
          `[dodo-webhook] Successfully recovered orphaned bid via place_bid for payment ${paymentId}.`
        );
        return;
      }
    } catch (recoveryErr) {
      console.error('[dodo-webhook] Recovery attempt failed:', recoveryErr);
    }
  }

  console.error(
    '[dodo-webhook] ⚠️ ORPHANED SUCCESSFUL PAYMENT DETECTED: ' +
      'Payment was captured by Dodo Payments, but no matching bid_event exists in the database ' +
      'after the retry window. Manual investigation required.',
    {
      paymentId,
      metadata,
      timestamp: new Date().toISOString(),
    }
  );
}
