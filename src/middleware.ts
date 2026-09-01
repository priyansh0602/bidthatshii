/**
 * middleware.ts
 *
 * Protects every route under /admin (except /admin/login itself).
 *
 * Uses @supabase/ssr to read Supabase Auth session cookies in the Edge
 * runtime. The cookie adapter both reads the incoming cookies AND writes
 * any updated cookies (e.g. refreshed access tokens) to the response,
 * which is required for Supabase's automatic token refresh to work correctly
 * in middleware.
 *
 * After confirming a valid session exists, it additionally checks that the
 * session's user email matches ADMIN_EMAIL — defence-in-depth so that even
 * if another Supabase Auth account were somehow created, only the designated
 * admin email can access the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const config = {
  matcher: ['/admin/:path*'],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass /admin/login through without auth — it IS the login page
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next();
  }

  // We need to be able to set cookies on the response (for token refresh),
  // so we create the response object up front and pass it to the adapter.
  let response = NextResponse.next({
    request: req,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write updated cookies (e.g. refreshed access token) to both the
          // request and the response so subsequent middleware and the server
          // component both see the fresh token.
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value)
          );
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() validates the JWT server-side against Supabase's public key.
  // It also triggers a silent refresh if the access token is near expiry.
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const userEmail = user?.email?.trim().toLowerCase();

  // Diagnostic logging — visible in the Next.js server terminal
  console.log('[middleware] getUser result:', {
    userId: user?.id ?? null,
    userEmail: userEmail ?? null,
    getUserError: getUserError?.message ?? null,
    adminEmail: adminEmail ?? '(ADMIN_EMAIL not set)',
    emailMatch: userEmail === adminEmail,
  });

  // No valid session, or session email doesn't match the allowed admin email
  if (!user || !adminEmail || userEmail !== adminEmail) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/admin/login';
    return NextResponse.redirect(loginUrl);
  }

  // Valid session + correct email — allow through.
  // Instruct browsers/CDNs not to cache admin pages so that pressing Back
  // after logout always triggers a fresh server render.
  response.headers.set('Cache-Control', 'no-store, must-revalidate');
  return response;
}
