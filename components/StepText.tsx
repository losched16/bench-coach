'use client'

// Long block text — setup, how to run it, what to watch for — as it was
// meant to read.
//
// The generator writes numbered steps as one string with no line breaks.
// Drawn as a paragraph that is a wall; drawn as the list it is, a coach can
// find step four with a bucket in one hand. stepsFrom() decides which it is;
// this only draws the answer, so the screen and the printed sheet cannot
// disagree about where the steps are.

import { stepsFrom } from '@/lib/practicePlan'

interface Props {
  text: string | null | undefined
  /** Applied to the paragraph or the list. Font size and colour come from here. */
  className?: string
}

export function StepText({ text, className = '' }: Props) {
  const { numbered, items } = stepsFrom(text)
  if (items.length === 0) return null

  if (numbered && items.length > 1) {
    return (
      <ol className={`list-decimal pl-5 space-y-1 ${className}`}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ol>
    )
  }

  if (items.length > 1) {
    return (
      <div className={`space-y-1 ${className}`}>
        {items.map((it, i) => <p key={i}>{it}</p>)}
      </div>
    )
  }

  return <p className={`whitespace-pre-line ${className}`}>{items[0]}</p>
}

export default StepText
