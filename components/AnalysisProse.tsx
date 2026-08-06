'use client'

import { useMemo } from 'react'

// A deliberately small markdown renderer for the analysis sections.
//
// The model writes paragraphs, occasional bullet lists for session steps, and
// bold for emphasis — nothing else. Pulling in a full markdown library for
// that surface area would be more dependency than it's worth, and this keeps
// the typography under our control, which matters: this text IS the product,
// so it has to read like prose, not like a config dump.

function renderInline(text: string, keyPrefix: string) {
  // **bold** — the only inline mark the analysis prompt produces
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
    }
    return <span key={`${keyPrefix}-t-${i}`}>{part}</span>
  })
}

export function AnalysisProse({ body }: { body: string }) {
  const blocks = useMemo(() => {
    const lines = body.split('\n')
    const out: Array<{ type: 'p' | 'ul' | 'ol'; items: string[] }> = []
    let buffer: string[] = []
    let mode: 'p' | 'ul' | 'ol' | null = null

    const flush = () => {
      if (buffer.length && mode) out.push({ type: mode, items: [...buffer] })
      buffer = []
      mode = null
    }

    for (const raw of lines) {
      const line = raw.trim()
      if (!line) { flush(); continue }

      const bullet = line.match(/^[-*]\s+(.*)$/)
      const numbered = line.match(/^\d+[.)]\s+(.*)$/)

      if (bullet) {
        if (mode !== 'ul') flush()
        mode = 'ul'
        buffer.push(bullet[1])
      } else if (numbered) {
        if (mode !== 'ol') flush()
        mode = 'ol'
        buffer.push(numbered[1])
      } else {
        if (mode !== 'p') flush()
        mode = 'p'
        // Join wrapped lines into one paragraph
        if (buffer.length) buffer[buffer.length - 1] += ' ' + line
        else buffer.push(line)
      }
    }
    flush()
    return out
  }, [body])

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-gray-700">
      {blocks.map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={i} className="space-y-1.5 ml-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="text-red-500 mt-1.5 flex-shrink-0 w-1 h-1 rounded-full bg-red-500" />
                  <span>{renderInline(item, `${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === 'ol') {
          return (
            <ol key={i} className="space-y-1.5 ml-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="text-red-600 font-semibold text-sm flex-shrink-0 mt-0.5">{j + 1}.</span>
                  <span>{renderInline(item, `${i}-${j}`)}</span>
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={i}>{block.items.map((para, j) => renderInline(para, `${i}-${j}`))}</p>
        )
      })}
    </div>
  )
}
