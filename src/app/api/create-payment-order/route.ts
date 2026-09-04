import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { razorpay } from '@/lib/razorpay';
import { convertUsdToInrPaise } from '@/lib/currency';

/**
 * POST /api/create-payment-order
 *
 * Recalculates the required charge delta server-side and creates a Razorpay Order.
 * Never trusts the client-provided bidAmount without validation against current spot state.
 *
 * Request body: { spotId, advertiserUrl, bidAmount }
 * Response: { orderId, amount, currency: 'INR', keyId }
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

    // ── 4. Create Razorpay Order (convert USD delta to INR paise) ──────────
    const amountInPaise = convertUsdToInrPaise(delta);

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `bid_${spotId.slice(0, 8)}_${Date.now()}`.slice(0, 40),
      notes: {
        spotId,
        advertiserUrl: normalizedUrl,
        bidAmountUsd: String(numericBidAmount),
        deltaUsd: String(delta),
        inrPaise: String(amountInPaise),
      },
    });

    const keyId =
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ||
      process.env.RAZORPAY_KEY_ID ||
      '';

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      keyId,
    });
  } catch (err: unknown) {
    const errorDetails =
      err && typeof err === 'object'
        ? JSON.stringify(err, Object.getOwnPropertyNames(err))
        : String(err);
    console.error('[create-payment-order] Error creating order:', errorDetails);
    return NextResponse.json(
      { error: 'Failed to create payment order. Please try again.' },
      { status: 500 }
    );
  }
}
