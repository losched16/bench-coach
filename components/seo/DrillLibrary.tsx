import { SeoDrill, drillSlug, drillCategories, isDetailed } from '@/lib/seoResource'
import { AddDrillButton } from './ResourceActionBar'

// A drills page as a library rather than an essay.
//
// Three layers, in the order a coach needs them: jump to the kind of thing
// you are looking for, scan a table to pick one, read the full drill. Someone
// who knows what they want reaches it in two taps; someone browsing still
// gets the whole page.
//
// Every field renders only when the source content has it. A drill whose
// article never described a harder variation gets no "Make It Harder"
// heading — inventing one would be inventing coaching advice, which is the
// one thing these pages cannot afford to do.

interface DrillLibraryProps {
  drills: SeoDrill[]
  pagePath: string
  ageGroup?: string
}

/**
 * Jump nav, built from the skills actually present.
 *
 * Plain anchors, no JavaScript — they work before hydration, they work with
 * JS off, and Google reads them as internal structure.
 */
export function DrillJumpNav({ drills }: { drills: SeoDrill[] }) {
  const categories = drillCategories(drills)
  // Below three groups this is just a list of the page in miniature.
  if (categories.length < 3) return null

  return (
    <nav aria-label="Jump to drill type" className="print:hidden my-6">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
        Jump to
      </h2>
      <ul className="flex flex-wrap gap-2 list-none pl-0">
        {categories.map(({ skill, drills: group }) => (
          <li key={skill}>
            <a
              href={`#skill-${drillSlug({ name: skill })}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-gray-300 text-sm font-medium text-gray-700 hover:border-red-400 hover:text-red-700 hover:bg-red-50 transition-colors min-h-[40px]"
            >
              {skill}
              <span className="text-xs text-gray-400">{group.length}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * The at-a-glance table.
 *
 * Columns appear only if some drill fills them, so a page that never recorded
 * player counts does not print an empty column across every row.
 */
export function DrillTable({ drills }: { drills: SeoDrill[] }) {
  if (drills.length < 2) return null

  const cols = {
    bestFor: drills.some(d => d.bestFor),
    duration: drills.some(d => d.duration),
    players: drills.some(d => d.players),
    equipment: drills.some(d => d.equipment?.length),
  }

  return (
    <section className="my-8" aria-labelledby="drill-quick-reference">
      <h2 id="drill-quick-reference" className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
        Quick Reference
      </h2>

      <div className="hidden sm:block overflow-hidden rounded-xl border border-gray-200 print:border-black">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-900 text-white print:bg-white print:text-black print:border-b-2 print:border-black">
              <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Drill</th>
              {cols.bestFor && <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Best For</th>}
              {cols.duration && <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Time</th>}
              {cols.players && <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Players</th>}
              {cols.equipment && <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Equipment</th>}
            </tr>
          </thead>
          <tbody>
            {drills.map(d => (
              <tr key={drillSlug(d)} className="border-t border-gray-200 print:border-gray-400 even:bg-slate-50 print:even:bg-white break-inside-avoid">
                <td className="py-3 px-4 align-top">
                  <a href={`#drill-${drillSlug(d)}`} className="font-semibold text-red-700 hover:underline print:text-black print:no-underline">
                    {d.name}
                  </a>
                </td>
                {cols.bestFor && <td className="py-3 px-4 text-gray-700 align-top">{d.bestFor || ''}</td>}
                {cols.duration && <td className="py-3 px-4 text-gray-700 align-top whitespace-nowrap">{d.duration || ''}</td>}
                {cols.players && <td className="py-3 px-4 text-gray-700 align-top whitespace-nowrap">{d.players || ''}</td>}
                {cols.equipment && <td className="py-3 px-4 text-gray-600 align-top">{d.equipment?.join(', ') || ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: cards. The table above has up to five columns and none of
          them survive a 375px viewport intact. */}
      <ul className="sm:hidden space-y-3 list-none pl-0">
        {drills.map(d => (
          <li key={drillSlug(d)} className="rounded-xl border border-gray-200 p-4">
            <a href={`#drill-${drillSlug(d)}`} className="font-semibold text-red-700 underline">
              {d.name}
            </a>
            {d.bestFor && <p className="text-sm text-gray-700 mt-1">{d.bestFor}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
              {d.duration && <span>⏱ {d.duration}</span>}
              {d.players && <span>👥 {d.players}</span>}
            </div>
            {d.equipment?.length ? (
              <p className="text-xs text-gray-500 mt-1">{d.equipment.join(', ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One drill, in full. */
export function DrillDetail({
  drill,
  pagePath,
  ageGroup,
}: {
  drill: SeoDrill
  pagePath: string
  ageGroup?: string
}) {
  const id = drillSlug(drill)

  return (
    <article
      id={`drill-${id}`}
      className="my-8 scroll-mt-24 rounded-xl border border-gray-200 p-5 sm:p-6 break-inside-avoid print:border-black"
    >
      <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">{drill.name}</h3>

      {/* The facts, as a strip rather than a paragraph. */}
      {(drill.duration || drill.players || drill.skill || drill.equipment?.length) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mb-4 pb-4 border-b border-gray-100">
          {drill.duration && <span><strong className="text-gray-900">Time:</strong> {drill.duration}</span>}
          {drill.players && <span><strong className="text-gray-900">Players:</strong> {drill.players}</span>}
          {drill.skill && <span><strong className="text-gray-900">Skill:</strong> {drill.skill}</span>}
          {drill.equipment?.length ? (
            <span><strong className="text-gray-900">Equipment:</strong> {drill.equipment.join(', ')}</span>
          ) : null}
        </div>
      )}

      {drill.bestFor && (
        <div className="mb-4">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            What This Fixes
          </h4>
          <p className="text-gray-700 leading-relaxed">{drill.bestFor}</p>
        </div>
      )}

      {drill.setup && (
        <div className="mb-4">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Setup</h4>
          <p className="text-gray-700 leading-relaxed">{drill.setup}</p>
        </div>
      )}

      {drill.instructions?.length ? (
        <div className="mb-4">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            How to Run It
          </h4>
          <ol className="space-y-1.5 text-gray-700 list-decimal pl-5">
            {drill.instructions.map((step, i) => <li key={i} className="leading-relaxed">{step}</li>)}
          </ol>
        </div>
      ) : null}

      {drill.coachingCues?.length ? (
        <div className="bg-blue-50 print:bg-white border-l-4 border-blue-600 p-4 my-4 rounded-r-lg">
          <h4 className="font-bold text-blue-900 mb-2 text-sm">Coaching Cues</h4>
          <ul className="space-y-1.5 list-none pl-0">
            {drill.coachingCues.map((cue, i) => (
              <li key={i} className="text-blue-900 flex items-start gap-2">
                <span className="text-blue-600" aria-hidden="true">✓</span>
                <span>{cue}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {drill.commonMistakes?.length ? (
        <div className="bg-orange-50 print:bg-white border-l-4 border-orange-500 p-4 my-4 rounded-r-lg">
          <h4 className="font-bold text-orange-900 mb-2 text-sm">Common Mistakes</h4>
          <ul className="space-y-1.5 list-none pl-0">
            {drill.commonMistakes.map((m, i) => (
              <li key={i} className="text-orange-900 flex items-start gap-2">
                <span className="text-orange-600" aria-hidden="true">✗</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(drill.easierVariation || drill.harderVariation) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4">
          {drill.easierVariation && (
            <div className="rounded-lg bg-slate-50 print:bg-white p-4">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Make It Easier
              </h4>
              <p className="text-gray-700 text-sm leading-relaxed">{drill.easierVariation}</p>
            </div>
          )}
          {drill.harderVariation && (
            <div className="rounded-lg bg-slate-50 print:bg-white p-4">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Make It Harder
              </h4>
              <p className="text-gray-700 text-sm leading-relaxed">{drill.harderVariation}</p>
            </div>
          )}
        </div>
      )}

      <AddDrillButton drillName={drill.name} pagePath={pagePath} ageGroup={ageGroup} />
    </article>
  )
}

/** Jump nav + table + every detailed drill, grouped by skill when it helps. */
export function DrillLibrary({ drills, pagePath, ageGroup }: DrillLibraryProps) {
  const categories = drillCategories(drills)
  const detailed = drills.filter(isDetailed)
  // Grouping is only worth the headings when every drill lands in a group.
  const grouped = categories.length >= 3 &&
    categories.reduce((n, c) => n + c.drills.length, 0) === drills.length

  return (
    <>
      <DrillJumpNav drills={drills} />
      <DrillTable drills={drills} />

      {detailed.length > 0 && (
        <section className="my-10" aria-labelledby="drill-detail-heading">
          <h2 id="drill-detail-heading" className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            The Drills
          </h2>

          {grouped
            ? categories.map(({ skill, drills: group }) => (
                <div key={skill} id={`skill-${drillSlug({ name: skill })}`} className="scroll-mt-24 mt-8">
                  <h3 className="text-lg font-bold text-red-700 uppercase tracking-wide border-b border-gray-200 pb-2 mb-2">
                    {skill}
                  </h3>
                  {group.filter(isDetailed).map(d => (
                    <DrillDetail key={drillSlug(d)} drill={d} pagePath={pagePath} ageGroup={ageGroup} />
                  ))}
                </div>
              ))
            : detailed.map(d => (
                <DrillDetail key={drillSlug(d)} drill={d} pagePath={pagePath} ageGroup={ageGroup} />
              ))}
        </section>
      )}
    </>
  )
}
