/**
 * supabaseAdmin.ts — SERVER-SIDE ONLY
 *
 * ⚠️  WARNING: This file initialises a Supabase client with the SERVICE ROLE
 * key, which bypasses Row Level Security and has full database access.
 *
 * NEVER import this file in:
 *   - Any component marked 'use client'
 *   - Any file that can be bundled into the browser (pages, hooks, non-route lib files)
 *
 * This file MUST only be imported from:
 *   - Next.js API route handlers  (/src/app/api/[name]/route.ts)
 *   - Server Actions
 *   - Other server-only modules
 *
 * If you are unsure, add `import 'server-only'` at the top of your file and
 * Next.js will throw a build error if it is ever imported client-side.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('[supabaseAdmin] Missing NEXT_PUBLIC_SUPABASE_URL environment variable.');
}
if (!serviceRoleKey) {
  throw new Error('[supabaseAdmin] Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
}

/**
 * Supabase admin client — uses the service_role key.
 * Has full database access; bypasses RLS.
 * NEVER expose this client or its key to the browser.
 */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    // Disable automatic session/token persistence — this client is stateless
    // per-request in an API route context.
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
