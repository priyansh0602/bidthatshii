'use client';

/**
 * LogoutButton — client component for the admin dashboard.
 *
 * Calls supabase.auth.signOut() which clears Supabase's own session cookies
 * (sb-*), then redirects to /admin/login.
 *
 * Rendered inside the Server Component AdminPage so it must be a separate
 * 'use client' file — Server Components cannot contain interactive event
 * handlers.
 */

import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

// Use createBrowserClient (not plain createClient) so signOut() clears the
// same cookie-based session that the middleware's createServerClient reads.
export function LogoutButton() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      style={{
        fontSize: '13px',
        padding: '6px 14px',
        background: 'transparent',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        cursor: 'pointer',
        color: '#374151',
      }}
    >
      Log out
    </button>
  );
}
