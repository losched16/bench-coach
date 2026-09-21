// What the pitch counter shows a coach about a limit.
//
// EXTRACTED VERBATIM from app/dashboard/count/page.tsx so the four states can
// be tested. The expressions are unchanged:
//
//     const overDaily = rule?.daily_max ? count >= rule.daily_max : false
//     const nearDaily = rule?.daily_max ? count >= rule.daily_max - 10 && !overDaily : false
//
// and so are both sentences. NOTHING ABOUT ENFORCEMENT CHANGED: there was no
// enforcement to change. This function returns a level and a sentence. It has
// no opinion about whether the next pitch gets thrown, and neither does the
// screen — the count button stays live at every level, it just turns red.
//
// That is the behaviour the help guide describes, and this is the thing the
// guide is checked against.

export type PitchWarningLevel = 'none' | 'near' | 'over'

export interface PitchWarning {
  level: PitchWarningLevel
  /** Null when there is nothing to say. Never a command. */
  message: string | null
  /** The count button goes red. It does NOT go disabled. */
  emphasis: boolean
}

export interface PitchRule {
  sanctioning_body: string
  age_group: string
  daily_max: number | null
}

/** How close to the daily max the amber warning starts. */
export const WARN_WITHIN = 10

export function pitchWarning(
  count: number,
  rule: PitchRule | null | undefined
): PitchWarning {
  // No rule set chosen, or one with no daily max: a plain tally. This is the
  // state the guide has to explain, because a coach who assumes a silent
  // screen means "under the limit" has assumed something the app never said.
  if (!rule || !rule.daily_max) {
    return { level: 'none', message: null, emphasis: false }
  }

  const max = rule.daily_max

  if (count >= max) {
    return {
      level: 'over',
      message: `Daily max for ${rule.sanctioning_body} ${rule.age_group} is ${max}. He's at ${count}.`,
      emphasis: true,
    }
  }

  if (count >= max - WARN_WITHIN) {
    return {
      level: 'near',
      message: `${max - count} pitches to the daily max.`,
      emphasis: false,
    }
  }

  return { level: 'none', message: null, emphasis: false }
}

/**
 * Whether counting is still allowed. Always true.
 *
 * This exists so the answer is written down somewhere a reader will find it,
 * rather than being the silent absence of a `disabled` prop. If BenchCoach
 * ever does gate counting, that is a product decision with safety and
 * liability attached, it changes what the help guide may say, and it should
 * start by making this function return something else.
 */
export function countingAllowed(): true {
  return true
}
