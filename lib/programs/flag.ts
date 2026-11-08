// Development Programs are behind one flag, off by default, so the code can be
// merged and deployed before migration 085 is applied and nothing changes for
// anyone. Turn it on per environment: NEXT_PUBLIC_DEVELOPMENT_PROGRAMS=on
// (public because the nav and chat button read it in the browser too).

export function programsEnabled(env?: Record<string, string | undefined>): boolean {
  // The literal `process.env.NEXT_PUBLIC_…` is what Next inlines into the
  // browser bundle. Reading it through a passed-around `process.env` object
  // works on the server and silently reads undefined in the browser.
  const v = env ? env.NEXT_PUBLIC_DEVELOPMENT_PROGRAMS : process.env.NEXT_PUBLIC_DEVELOPMENT_PROGRAMS
  return String(v || '').toLowerCase() === 'on'
}
