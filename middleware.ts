import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { safeRedirect } from '@/lib/safeRedirect'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: any) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  // Refresh the auth session if it exists
  const { data: { session } } = await supabase.auth.getSession()

  // Protect dashboard routes
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!session) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }
  }

  // League administration. Signing in is only the doorway — whether this person
  // administers the league they are asking about is decided by
  // requireLeagueRole() in the API routes, which is the thing that actually
  // enforces. This just stops a signed-out visitor reaching the shell at all.
  //
  // Note /league/invite/* is deliberately NOT protected: an invited coach has
  // no account yet, and the invitation screen has to render for them.
  if (request.nextUrl.pathname.startsWith('/league-admin')) {
    if (!session) {
      return NextResponse.redirect(
        new URL(`/auth/login?redirect=${encodeURIComponent(request.nextUrl.pathname)}`, request.url)
      )
    }
  }

  // BenchCoach Academy: purchased courses. Signing in is the doorway; the
  // course pages and APIs decide access from the enrollment, server-side.
  // Deliberately NOT the /dashboard gate — a course buyer needs no team and
  // no subscription.
  if (request.nextUrl.pathname.startsWith('/learn')) {
    if (!session) {
      const back = request.nextUrl.pathname + request.nextUrl.search
      return NextResponse.redirect(new URL(`/auth/login?redirect=${encodeURIComponent(back)}`, request.url))
    }
  }

  // Redirect logged-in users away from auth pages — back to where they were
  // going (a course, an invitation) when that is a same-site path.
  if (request.nextUrl.pathname.startsWith('/auth')) {
    if (session) {
      const to = safeRedirect(request.nextUrl.searchParams.get('redirect'), '/dashboard')
      return NextResponse.redirect(new URL(to, request.url))
    }
  }

  return response
}

// 🔥 THIS IS THE FIX - Only run middleware on protected routes
export const config = {
  matcher: [
    // '/' is deliberately absent. The marketing home is public and needs no
    // session, so running middleware there only costs a round trip. It was
    // listed from 2026-09-11 to 2026-09-21 while the sign-in page stood in as
    // the front door during coach testing (c79a88d); that block is gone.
    '/dashboard/:path*',
    '/auth/:path*',
    '/onboarding/:path*',
    '/league-admin/:path*',
    '/learn/:path*',
    '/learn',
  ],
}
