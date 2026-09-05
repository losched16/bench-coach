import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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

  // Redirect logged-in users away from auth pages
  if (request.nextUrl.pathname.startsWith('/auth')) {
    if (session) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

// 🔥 THIS IS THE FIX - Only run middleware on protected routes
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/auth/:path*',
    '/onboarding/:path*',
    '/league-admin/:path*',
  ],
}
