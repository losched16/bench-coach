import { ResourceBlock, equipmentChecklist } from '@/lib/seoResource'

// The quick-reference band: what this is, what to bring, what to set up.
//
// Every field is optional and every one of them is omitted when empty. That
// is a content rule as much as a rendering one — a page whose article never
// said how many coaches you need shows no "Coaches" line, rather than a line
// reading "2-3" that nobody wrote.

export function ResourceMetaBar({ meta }: { meta: ResourceBlock['meta'] }) {
  if (!meta?.length) return null
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200 my-6 print:border-black">
      {meta.map((m, i) => (
        <div key={i} className="bg-white p-3 sm:p-4">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            {m.label}
          </dt>
          <dd className="font-semibold text-gray-900 text-sm sm:text-base">{m.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ResourceObjective({ objective }: { objective?: string }) {
  if (!objective) return null
  return (
    <div className="my-6 border-l-4 border-red-600 bg-red-50 print:bg-white p-4 sm:p-5 rounded-r-lg">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-red-800 mb-1">
        Practice Objective
      </h2>
      <p className="text-gray-900 font-medium leading-relaxed">{objective}</p>
    </div>
  )
}

/**
 * Equipment and setup, side by side.
 *
 * Checkboxes are real <input>s rather than styled bullets so they survive
 * printing — a coach ticking items off a sheet on a clipboard is the actual
 * use case, and an unchecked box prints as a box.
 */
export function ResourcePrep({ block }: { block: ResourceBlock }) {
  const equipment = equipmentChecklist(block)
  const setup = block.setup || []
  if (!equipment.length && !setup.length) return null

  return (
    <section className="my-8 grid grid-cols-1 sm:grid-cols-2 gap-6 break-inside-avoid">
      {equipment.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-5 print:border-black">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900 mb-3">
            Equipment Needed
          </h2>
          <ul className="space-y-2 list-none pl-0">
            {equipment.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-gray-700">
                <input
                  type="checkbox"
                  aria-label={item}
                  className="mt-1 h-4 w-4 rounded border-gray-400 accent-red-600 shrink-0"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {setup.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-5 print:border-black">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-900 mb-3">
            Before Practice
          </h2>
          <ul className="space-y-2 list-none pl-0">
            {setup.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-gray-700">
                <input
                  type="checkbox"
                  aria-label={item}
                  className="mt-1 h-4 w-4 rounded border-gray-400 accent-red-600 shrink-0"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * How the plan changes with 6, 9 or 12 players.
 *
 * Only the sizes the source content actually addressed. A coach with eight
 * kids reading advice invented for eight kids is worse off than one who
 * reads nothing.
 */
export function RosterVariants({ variants }: { variants?: ResourceBlock['rosterVariants'] }) {
  if (!variants?.length) return null
  return (
    <section className="my-8 break-inside-avoid">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4">
        Adjusting for Your Roster Size
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {variants.map((v, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-4 print:border-black">
            <div className="font-bold text-red-700 mb-1">{v.players}</div>
            <p className="text-sm text-gray-700 leading-relaxed">{v.guidance}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
