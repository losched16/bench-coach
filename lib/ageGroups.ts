// The age groups a team can be, in order.
//
// One list, because three pages used to carry their own copy and a team that
// moved from 8U to 9U had nowhere to say so: settings showed the age group as
// a fact rather than a field. Youth teams age up every year with most of the
// same kids, so this is the most ordinary change a team makes.

export const AGE_GROUPS = ['6U', '7U', '8U', '9U', '10U', '11U', '12U', '13U+'] as const

export type AgeGroup = (typeof AGE_GROUPS)[number]

export function isAgeGroup(v: unknown): v is AgeGroup {
  return typeof v === 'string' && (AGE_GROUPS as readonly string[]).includes(v)
}

/** The group a team moves to next season, or null at the top. */
export function nextAgeGroup(current: string | null | undefined): AgeGroup | null {
  const i = (AGE_GROUPS as readonly string[]).indexOf(String(current || ''))
  if (i < 0 || i >= AGE_GROUPS.length - 1) return null
  return AGE_GROUPS[i + 1]
}
