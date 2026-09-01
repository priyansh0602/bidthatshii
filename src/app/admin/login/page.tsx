'use client';

/**
 * /admin/login — Email + password login for the admin dashboard.
 *
 * Uses Supabase Auth's signInWithPassword() directly from the browser.
 * On success, Supabase writes its own httpOnly session cookies (sb-*) and
 * middleware validates them on subsequent requests via @supabase/ssr.
 *
 * The public anon key is intentionally used here — signInWithPassword() is
 * designed to be called client-side with the anon key. The service_role key
 * is never involved in login; it is only used server-side for admin RPC calls.
 *
 * Session length is controlled in Supabase dashboard:
 *   Authentication → Settings → JWT expiry & Token refresh interval.
 */

import { useState, FormEvent } from 'react';
import { createBrowserClient } from '@supabase/ssr';

// NOTE: We use createBrowserClient from @supabase/ssr (NOT createClient from
// @supabase/supabase-js). This is critical: createBrowserClient stores the
// auth session in cookies, which the middleware's createServerClient can read
// on the very next request. Using plain createClient would store the session
// in localStorage instead — invisible to the server/middleware — causing a
// redirect loop even after a successful login.

export default function AdminLoginPage() {
  // createBrowserClient is created inside the component so it is always
  // initialised after the component mounts (client-side), and so that each
  // render uses the same singleton cookie store.
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    console.log('[admin-login] Attempting signInWithPassword for:', email.trim().toLowerCase());

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        console.error('[admin-login] Auth error:', authError.message);
        setError(authError.message);
        return;
      }

      console.log('[admin-login] Login succeeded, user email:', data.user?.email);
      console.log('[admin-login] Session set in cookies — performing full page navigation to /admin');

      // Use a full page navigation (not client-side router.push) so the browser
      // sends the newly-set auth cookies to the server on the very next request.
      // A pure client-side nav via router.push could race with cookie propagation.
      window.location.href = '/admin';
    } catch (err) {
      console.error('[admin-login] Unexpected error:', err);
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#f9fafb',
        color: '#111',
      }}
    >
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '36px 40px',
          width: '100%',
          maxWidth: '360px',
        }}
      >
        <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
          BidThatShii — Admin
        </h1>
        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '28px' }}>
          Sign in with your admin account to continue.
        </p>

        <form onSubmit={handleSubmit}>
          {/* Email */}
          <label
            htmlFor="admin-email"
            style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}
          >
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="admin@example.com"
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 10px',
              fontSize: '14px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: '14px',
            }}
          />

          {/* Password */}
          <label
            htmlFor="admin-password"
            style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}
          >
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 10px',
              fontSize: '14px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: '16px',
            }}
          />

          {error && (
            <p
              style={{
                fontSize: '13px',
                color: '#b91c1c',
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                padding: '8px 12px',
                marginBottom: '14px',
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              display: 'block',
              width: '100%',
              padding: '9px',
              fontSize: '14px',
              fontWeight: 600,
              background: loading ? '#9ca3af' : '#111',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
