import { DodoPayments } from 'dodopayments';

async function run() {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) {
    throw new Error('DODO_API_KEY is not set in your .env file.');
  }

  console.log('Connecting to Dodo Payments in live_mode...');
  const client = new DodoPayments({
    bearerToken: apiKey,
    environment: 'live_mode',
  });

  // 1. Check existing products in live mode
  try {
    const list = await client.products.list();
    const existing = list.items?.find((p) => p.name?.toLowerCase().includes('spot'));
    if (existing) {
      console.log('\n✓ Found existing product in live mode:');
      console.log('  Product ID:', existing.product_id);
      console.log('  Name:', existing.name);
      console.log('  Currency:', (existing as any).currency);
      console.log('  Pay What You Want:', (existing as any).price_detail?.pay_what_you_want);
      console.log('\n===========================================');
      console.log(`DODO_PRODUCT_ID=${existing.product_id}`);
      console.log('===========================================');
      return;
    }
  } catch (err: any) {
    console.log('Note on listing products:', err?.message || err);
  }

  // 2. Create new product in live mode if not found
  console.log('\nCreating new Spot Bid product in live mode...');
  try {
    const product = await client.products.create({
      name: 'Spot Bid',
      description: 'Bid on a world spot',
      tax_category: 'digital_products',
      price: {
        type: 'one_time_price',
        currency: 'INR',
        price: 100, // min amount: ₹1.00 (100 paise)
        pay_what_you_want: true,
      },
    });

    const prodId = product.product_id;
    console.log('\n✅ Successfully created live product!');
    console.log('  Product ID:', prodId);
    console.log('  Name:', product.name);
    console.log('  Currency: INR');
    console.log('  Pay What You Want: true');
    console.log('\n===========================================');
    console.log(`DODO_PRODUCT_ID=${prodId}`);
    console.log('===========================================');
  } catch (createErr: any) {
    console.error('Error creating product:', createErr?.message || createErr);
  }
}

run().catch((err) => {
  console.error('Script failed:', err.message || err);
  process.exit(1);
});
