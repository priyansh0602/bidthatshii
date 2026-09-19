import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { dodo, DODO_PRODUCT_ID } from '@/lib/dodo';

/**
 * POST /api/create-payment-order
 *
 * Recalculates the required charge delta server-side and creates a Dodo Payments Checkout Session.
 * Never trusts client-provided bidAmount without validation against current spot state.
 *
 * Request body: { spotId, advertiserUrl, bidAmount }
 * Response: { sessionId, checkoutUrl, amount, currency: 'USD', orderId }
 */

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function normalizeUrl(rawUrl: string): string {
  let normalized = rawUrl.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  return normalized;
}

export async function POST(req: NextRequest) {
  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body: {
    spotId?: unknown;
    advertiserUrl?: unknown;
    bidAmount?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { spotId, advertiserUrl, bidAmount } = body;

  if (!spotId || typeof spotId !== 'string') {
    return NextResponse.json({ error: 'spotId is required.' }, { status: 400 });
  }
  if (!advertiserUrl || typeof advertiserUrl !== 'string') {
    return NextResponse.json({ error: 'advertiserUrl is required.' }, { status: 400 });
  }

  const numericBidAmount = Number(bidAmount);
  if (isNaN(numericBidAmount) || numericBidAmount <= 0) {
    return NextResponse.json({ error: 'bidAmount must be a positive number.' }, { status: 400 });
  }

  // ── 2. Rate limiting ───────────────────────────────────────────────────────
  const clientIp = getClientIp(req);

  try {
    const { data: rateLimitData, error: rateLimitError } = await supabaseAdmin.rpc(
      'check_rate_limit',
      {
        p_identifier: clientIp,
        p_action: 'create_payment_order',
        p_max_requests: 10,
        p_window_seconds: 60,
      }
    );

    if (rateLimitError) {
      console.error('[create-payment-order] Rate limit check error:', rateLimitError.message);
    } else if (rateLimitData === false) {
      return NextResponse.json(
        { error: 'Too many requests — please wait a moment and try again.' },
        { status: 429 }
      );
    }
  } catch (err) {
    console.error('[create-payment-order] Unexpected error during rate limit check:', err);
  }

  // ── 3. Validate against current spot state and calculate charge delta ──────
  try {
    const { data: spot, error: spotError } = await supabaseAdmin
      .from('spots')
      .select('id, current_highest_total, min_increment, starting_price')
      .eq('id', spotId)
      .single();

    if (spotError || !spot) {
      return NextResponse.json({ error: 'Spot not found.' }, { status: 404 });
    }

    const currentHighestTotal = Number(spot.current_highest_total ?? 0);
    const minIncrement = Number(spot.min_increment ?? 1);
    const startingPrice = Number(spot.starting_price ?? 5);

    const minRequiredTotal =
      currentHighestTotal > 0 ? currentHighestTotal + minIncrement : startingPrice;

    if (numericBidAmount < minRequiredTotal) {
      return NextResponse.json(
        {
          error: `Bid amount $${numericBidAmount} is below the minimum required bid of $${minRequiredTotal}.`,
        },
        { status: 400 }
      );
    }

    const normalizedUrl = normalizeUrl(advertiserUrl);
    const { data: contrib } = await supabaseAdmin
      .from('contributions')
      .select('total_contributed')
      .eq('spot_id', spotId)
      .eq('advertiser_id_url', normalizedUrl)
      .maybeSingle();

    const existingContribution = Number(contrib?.total_contributed ?? 0);
    const delta = Math.max(0, numericBidAmount - existingContribution);

    if (delta <= 0) {
      return NextResponse.json(
        { error: 'No additional payment required to place this bid.' },
        { status: 400 }
      );
    }

    // ── 4. Create Dodo Payments Checkout Session (USD cents) ─────────────────
    const amountInCents = Math.round(delta * 100);

    const origin =
      req.headers.get('origin') ||
      (req.headers.get('x-forwarded-proto') && req.headers.get('x-forwarded-host')
        ? `${req.headers.get('x-forwarded-proto')}://${req.headers.get('x-forwarded-host')}`
        : req.headers.get('host')
        ? `http://${req.headers.get('host')}`
        : req.nextUrl.origin);

    const returnUrl = `${origin}/?dodo_verify=true&spot_id=${encodeURIComponent(spotId)}&advertiser_url=${encodeURIComponent(normalizedUrl)}`;

    const session = await dodo.checkoutSessions.create({
      product_cart: [
        {
          product_id: DODO_PRODUCT_ID,
          quantity: 1,
          amount: amountInCents,
        },
      ],
      billing_currency: 'USD',
      metadata: {
        spotId,
        advertiserUrl: normalizedUrl,
        bidAmount: String(numericBidAmount),
        deltaUsd: String(delta),
        clientIp,
      },
      return_url: returnUrl,
    });

    return NextResponse.json({
      sessionId: session.session_id,
      checkoutUrl: session.checkout_url,
      amount: delta,
      currency: 'USD',
      orderId: session.session_id,
    });
  } catch (err: unknown) {
    const errorDetails =
      err && typeof err === 'object'
        ? JSON.stringify(err, Object.getOwnPropertyNames(err))
        : String(err);
    console.error('[create-payment-order] Error creating Dodo checkout session:', errorDetails);
    return NextResponse.json(
      { error: 'Failed to create payment session. Please try again.' },
      { status: 500 }
    );
  }
}
