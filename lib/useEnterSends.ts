'use client'

import { useEffect, useState } from 'react'

/**
 * Whether Enter should send a message, or break the line.
 *
 * THE BUG THIS ANSWERS
 *
 * Both chat composers sent on Enter and called preventDefault, so on a phone
 * there was no way to write a second line: the return key posted whatever was
 * typed so far. A coach writing the second sentence of a question sent the
 * first one instead.
 *
 * WHY NOT A WIDTH BREAKPOINT
 *
 * The question is not "is the screen small" — a narrow desktop window is still
 * a desktop, and a coach who drags their browser to half width has not stopped
 * having a keyboard. The question is "is there a physical keyboard", and the
 * honest signal is the pointer: `(hover: hover) and (pointer: fine)` is a mouse
 * or trackpad. A finger on glass cannot hover and is not fine, and the Enter
 * key it presses is drawn by the on-screen keyboard as a return key.
 *
 * A tablet with a keyboard case reports a fine pointer once the trackpad is in
 * use, and the query re-evaluates when that changes, so it follows the hardware
 * rather than a guess made at page load.
 *
 * Defaults to false: before the query resolves, Enter does the harmless thing.
 * Sending a half-finished question cannot be undone; a stray newline can.
 */
export function useEnterSends(): boolean {
  const [enterSends, setEnterSends] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const apply = () => setEnterSends(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return enterSends
}
