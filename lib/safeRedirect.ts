// Where to send someone after signing in. Same-site paths only: an absolute
// URL, a protocol-relative "//evil.example" or a backslash trick would turn
// the login page into an open redirect.
export function safeRedirect(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || typeof raw !== 'string') return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\r\n\t]/.test(raw)) return fallback
  if (raw.length > 500) return fallback
  return raw
}

/** Academy flows send people back to a course, not into the coach dashboard. */
export function isAcademyPath(path: string | null | undefined): boolean {
  return !!path && /^\/(academy|learn)(\/|$|\?)/.test(path)
}
