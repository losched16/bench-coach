// Renders a lesson's structured blocks (lib/academy/manuscript.ts).
//
// The words are the manuscript's; this only decides how they look. Inline
// formatting is limited to **bold** and *italic* and is turned into React
// elements — no HTML from content is ever injected.

import type { ReactNode } from 'react'
import type { Block } from '@/lib/academy/manuscript'

export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*?\*)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-slate-900">{p.slice(2, -2)}</strong>
        if (/^\*[^*\s][^*]*\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

function Section({ title, children, tone = 'plain' }: { title: string; children: ReactNode; tone?: 'plain' | 'cue' | 'ready' | 'coach' | 'safety' | 'check' }) {
  const styles: Record<string, string> = {
    plain: '',
    cue: 'rounded-xl bg-[#0f172a] text-white px-5 py-4',
    ready: 'rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4',
    coach: 'rounded-xl border-l-4 border-slate-400 bg-slate-50 px-5 py-4',
    safety: 'rounded-xl border border-amber-300 bg-amber-50 px-5 py-4',
    check: 'rounded-xl border border-sky-200 bg-sky-50 px-5 py-4',
  }
  const head: Record<string, string> = {
    plain: 'text-slate-500', cue: 'text-red-300', ready: 'text-emerald-800', coach: 'text-slate-600', safety: 'text-amber-800', check: 'text-sky-800',
  }
  return (
    <section className={styles[tone]}>
      <h2 className={`text-xs font-bold uppercase tracking-wider mb-2 ${head[tone]}`}>{title}</h2>
      {children}
    </section>
  )
}

const P = ({ text, className = '' }: { text: string; className?: string }) => (
  <p className={`text-[17px] leading-relaxed text-slate-700 ${className}`}><Inline text={text} /></p>
)

function Drill({ b }: { b: Extract<Block, { type: 'drill' }> }) {
  // Same words, arranged: the equipment sentence and the success line are
  // lifted out of the drill text for scanning at the field.
  let body = b.text
  if (b.equipment) body = body.replace(/^Equipment:\s*.+?\.(\s|$)/, '')
  if (b.success) body = body.replace(/\s*\*\*Success:\*\*\s*.*$/, '')
  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid="drill">
      <header className="flex items-baseline gap-3 px-5 pt-4">
        <span className="shrink-0 rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">{b.label}</span>
        <h3 className="text-lg font-semibold text-slate-900">{b.name}</h3>
      </header>
      <div className="px-5 pb-4 pt-2 space-y-3">
        {b.equipment && (
          <p className="text-sm text-slate-600"><span className="font-semibold text-slate-800">Equipment:</span> <Inline text={b.equipment} /></p>
        )}
        <P text={body.trim()} />
        {b.success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[15px] text-emerald-900"><span className="font-semibold">Success:</span> <Inline text={b.success} /></p>
        )}
      </div>
    </article>
  )
}

export default function LessonBlocks({ blocks, safetyNote }: { blocks: Block[]; safetyNote?: string | null }) {
  const firstDrill = blocks.findIndex(b => b.type === 'drill')
  return (
    <div className="space-y-7">
      {blocks.map((b, i) => {
        const safety = i === firstDrill && safetyNote ? (
          <Section key={`safety-${i}`} title="Before the drills: safety" tone="safety"><P text={safetyNote} className="text-[15px] text-amber-950" /></Section>
        ) : null
        const el = (() => {
          switch (b.type) {
            case 'h':
              return b.level === 2
                ? <h2 className="text-xl font-bold text-slate-900 pt-2">{b.text}</h2>
                : <h3 className="text-lg font-semibold text-slate-900 pt-1">{b.text}</h3>
            case 'p': return <P text={b.text} />
            case 'ol': return <ol className="list-decimal pl-6 space-y-2 text-[17px] text-slate-700">{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ol>
            case 'ul': return <ul className="list-disc pl-6 space-y-2 text-[17px] text-slate-700">{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ul>
            case 'table':
              return (
                <div className="overflow-x-auto rounded-xl border border-slate-200 print:overflow-visible" data-testid="table">
                  <table className="min-w-[640px] w-full text-left text-sm print:min-w-0">
                    <thead className="bg-slate-100 text-slate-700"><tr>{b.header.map((h, j) => <th key={j} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {b.rows.map((r, j) => <tr key={j} className="align-top">{r.map((c, k) => <td key={k} className="px-3 py-2 text-slate-700"><Inline text={c} /></td>)}</tr>)}
                    </tbody>
                  </table>
                </div>
              )
            case 'safety': return <Section title="Safety" tone="safety"><P text={b.text} className="text-amber-950" /></Section>
            case 'look_for':
              return (
                <Section title="Look for">
                  <P text={b.lookFor} />
                  {b.mistakes.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {b.mistakes.map((m, j) => (
                        <div key={j} className="grid sm:grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-[15px]">
                          <div className="bg-white p-3"><div className="text-xs font-bold uppercase tracking-wide text-red-700 mb-1">Common mistake</div><Inline text={m.mistake} /></div>
                          <div className="bg-white p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">{m.responseLabel}</div><Inline text={m.response} /></div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )
            case 'drill': return <Drill b={b} />
            case 'labeled':
              switch (b.kind) {
                case 'cue': return <Section title="Player cue" tone="cue"><p className="text-xl font-semibold leading-snug"><Inline text={b.text} /></p></Section>
                case 'coach_corner': return <Section title="Coach's corner" tone="coach"><P text={b.text} /></Section>
                case 'ready': return <Section title="Ready to move on when" tone="ready"><P text={b.text} className="text-emerald-950" /></Section>
                case 'checkpoint': return <Section title="Course completion checkpoint" tone="check"><P text={b.text} className="text-sky-950" /></Section>
                default: return <Section title={b.label}><P text={b.text} /></Section>
              }
          }
        })()
        return <div key={i}>{safety}{safety && <div className="h-7" />}{el}</div>
      })}
    </div>
  )
}

export function FieldTest({ text, moduleTitle }: { text: string; moduleTitle?: string }) {
  return (
    <section className="rounded-xl border-2 border-dashed border-red-300 bg-red-50/40 px-5 py-4" data-testid="field-test">
      <h2 className="text-xs font-bold uppercase tracking-wider text-red-700 mb-2">{moduleTitle ? `${moduleTitle} — field test` : 'Field test'}</h2>
      <P text={text} />
    </section>
  )
}
