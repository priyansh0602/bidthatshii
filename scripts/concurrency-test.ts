import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// 1. Load environment variables from .env if process.env isn't populated
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface PlaceBidResult {
  success: boolean;
  charged: number;
  new_total: number;
  new_highest: number;
  message: string;
}

async function placeBid(
  spotId: string,
  advertiserUrl: string,
  logoUrl: string,
  paymentReference?: string
): Promise<PlaceBidResult> {
  const { data, error } = await supabase.rpc('place_bid', {
    p_spot_id: spotId,
    p_advertiser_url: advertiserUrl,
    p_logo_url: logoUrl,
    p_payment_reference: paymentReference ?? null,
  });

  if (error) {
    return {
      success: false,
      charged: 0,
      new_total: 0,
      new_highest: 0,
      message: error.message,
    };
  }

  const result = Array.isArray(data) ? data[0] : data;

  return {
    success: Boolean(result?.success),
    charged: Number(result?.charged ?? 0),
    new_total: Number(result?.new_total ?? 0),
    new_highest: Number(result?.new_highest ?? 0),
    message: String(result?.message ?? ''),
  };
}

async function runConcurrencyTest() {
  const defaultSpotId = '06b6975e-7c02-4b17-be2d-cbdf101f2e1f';
  const spotId = process.argv[2] || defaultSpotId;

  console.log(`🚀 Starting URL-Based Concurrency Test for Spot ID: ${spotId}`);
  console.log(`🎯 Firing 50 simultaneous placeBid calls with distinct advertiser URLs...`);

  // Generate 50 distinct test advertiser URLs with placeholder logo
  const testBidders = Array.from({ length: 50 }, (_, i) => ({
    url: `https://brand-${Date.now()}-${i + 1}.com`,
    logoUrl: `https://brand-${Date.now()}-${i + 1}.com/logo.png`,
  }));

  // Initial spot query to check baseline total
  const { data: initialSpot } = await supabase
    .from('spots')
    .select('slug, display_name, current_highest_total, current_winner_url')
    .eq('id', spotId)
    .single();

  if (initialSpot) {
    console.log(`📍 Target Spot: ${initialSpot.display_name} (${initialSpot.slug})`);
    console.log(`📊 Baseline Highest Total: $${initialSpot.current_highest_total}`);
    console.log(`👑 Baseline Winner URL: ${initialSpot.current_winner_url || 'None'}`);
  }

  const startTime = Date.now();

  // Launch 50 simultaneous RPC calls
  const promises = testBidders.map((bidder) =>
    placeBid(spotId, bidder.url, bidder.logoUrl)
  );
  const results = await Promise.allSettled(promises);

  const durationMs = Date.now() - startTime;

  let successCount = 0;
  let failureCount = 0;
  const failureReasons: Record<string, number> = {};

  results.forEach((res) => {
    if (res.status === 'fulfilled' && res.value.success) {
      successCount++;
    } else {
      failureCount++;
      const reason =
        res.status === 'fulfilled' ? res.value.message : res.reason?.message || 'Unknown error';
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    }
  });

  // Query spot again to get final state
  const { data: finalSpot } = await supabase
    .from('spots')
    .select('slug, display_name, current_highest_total, current_winner_url')
    .eq('id', spotId)
    .single();

  console.log('\n========================================');
  console.log('🏁 URL-BASED CONCURRENCY TEST SUMMARY');
  console.log('========================================');
  console.log(`⏱️ Duration: ${durationMs} ms`);
  console.log(`✅ Successful Bids: ${successCount}`);
  console.log(`❌ Failed Bids:     ${failureCount}`);
  if (Object.keys(failureReasons).length > 0) {
    console.log('----------------------------------------');
    console.log('📌 Failure Breakdown:');
    Object.entries(failureReasons).forEach(([reason, count]) => {
      console.log(`   • (${count}x) ${reason}`);
    });
  }
  console.log('----------------------------------------');
  console.log(`📈 Final Highest Total: $${finalSpot?.current_highest_total ?? 'N/A'}`);
  console.log(`🏆 Final Winner URL:   ${finalSpot?.current_winner_url ?? 'N/A'}`);
  console.log('========================================\n');
}

runConcurrencyTest().catch((err) => {
  console.error('Fatal error running concurrency test:', err);
  process.exit(1);
});
