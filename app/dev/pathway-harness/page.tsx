'use client'

// A bench for the pathway picker. Development only.
//
// The picker lives inside the Generate Practice modal, behind a login, a coach
// and a team. A browser test of the real page would spend its whole budget on
// authentication and still not isolate what is under test — so this mounts the
// real <PathwayPicker> and the real <PathwayContextCard> over a fixture, with
// no auth and no network.
//
// Every rule a coach meets in the shipped picker is the same code path here:
// the same stage navigation, the same focused-stage wording, the same
// disabled-at-the-ends buttons. What is replaced is only the data loader.
//
// It renders nothing in production. `next build` still compiles the route, so
// it cannot rot silently.
//
// The <pre id="state"> is the point: the acceptance run reads the selection and
// the recorded analytics back and asserts on data, not on how the DOM looks.

import { useMemo, useState } from 'react'
import { PathwayPicker, PathwayContextCard, LoadState } from '@/components/pathwayPicker/PathwayPicker'
import type { PathwayContext } from '@/components/pathwayPicker/PathwayPicker'
import type { LoadedPathway, PathwayStage, StageDrillLink } from '@/lib/developmentPathways'
import { orderedStages } from '@/lib/developmentPathways'
import { toOption, resolveStageNumber } from '@/lib/pathwayUi'

const mkStage = (n: number, key: string, name: string, over: Partial<PathwayStage> = {}): PathwayStage => ({
  id: `s-${key}`, pathway_id: 'p1', stage_number: n, stage_key: key, name,
  objective: `Create a repeatable ${name.toLowerCase()} while staying balanced and ready to attack.`,
  mastery_signals: [
    'controlled weight shift', 'hands remain connected', 'head stays quiet',
  ],
  common_failure_modes: ['drifts forward'],
  ...over,
} as PathwayStage)

const mkLink = (stageId: string, drillId: string): StageDrillLink => ({
  stage_id: stageId, drill_id: drillId, role: 'primary', rank: 1,
  rationale: 'Helps players repeat the launch position before adding ball flight.',
})

// Ten stages, shaped like Build the Swing. Stage 2 has ONE drill so the
// focused-stage wording is exercised; stage 1 and the rest have three.
const STAGES = [
  mkStage(1, 'athletic-stance', 'Athletic stance and posture'),
  mkStage(2, 'grip', 'Grip'),
  mkStage(3, 'load', 'Load'),
  mkStage(4, 'load-to-launch', 'Load to launch, and the stride'),
  mkStage(5, 'lower-half', 'Lower-half sequencing'),
  mkStage(6, 'bat-path', 'Bat path'),
  mkStage(7, 'contact-point', 'Contact point'),
  mkStage(8, 'moving-ball', 'Timing a moving ball'),
  mkStage(9, 'pitch-location', 'Adjusting to pitch location'),
  mkStage(10, 'two-strike', 'Two strikes, and the at-bat'),
]

const LINKS = new Map<string, StageDrillLink[]>(
  STAGES.map(s => [
    s.id,
    s.stage_key === 'grip'
      ? [mkLink(s.id, 'd1')]
      : [mkLink(s.id, 'd1'), mkLink(s.id, 'd2'), mkLink(s.id, 'd3')],
  ])
)

const SWING: LoadedPathway = {
  pathway: {
    id: 'p1', slug: 'build-the-swing', name: 'Build the Swing',
    skill_category: 'hitting', status: 'published',
    summary: 'The swing built from the ground up: a position to swing from, then a way to load it, then a path to the ball.',
  } as any,
  stages: STAGES,
  linksByStage: LINKS,
  problemsByStage: new Map(),
}

const EMPTY_PATHWAY: LoadedPathway = {
  pathway: { id: 'p2', slug: 'empty-pathway', name: 'Empty Pathway', skill_category: 'fielding', status: 'published', summary: 'Has no stages.' } as any,
  stages: [],
  linksByStage: new Map(),
  problemsByStage: new Map(),
}

const OPTIONS = [
  toOption(SWING.pathway, STAGES.length),
  toOption({ id: 'p3', slug: 'infield-fundamentals', name: 'Infield Fundamentals', skill_category: 'fielding', summary: 'From a body that can get low and stay there, through the approach and the catch.' } as any, 11),
  toOption(EMPTY_PATHWAY.pathway, 0),
]

const CONTEXT: PathwayContext = {
  pathway: 'Build the Swing',
  stage: '4 of 10 — Load to launch, and the stride',
  objective: 'Front foot lands with the hands still back, in a repeatable place, every swing.',
  masterySignals: ['Hands are still back when the front foot lands', 'Stride lands in the same box'],
  drills: ['Load to Launch Drill', 'Stride Box'],
  nextStage: 'Lower-half sequencing',
  warnings: [],
}

export default function PathwayHarness() {
  if (process.env.NODE_ENV === 'production') return null

  // `?scenario=` drives the failure states the acceptance run needs. Default is
  // the happy path.
  const scenario = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('scenario') || 'ok'
    : 'ok'

  const [slug, setSlug] = useState<string | null>(null)
  const [stageNumber, setStageNumber] = useState<number | null>(null)
  const [events, setEvents] = useState<Array<{ event: string; metadata?: any }>>([])

  const loaded = useMemo<LoadedPathway | null>(() => {
    if (!slug) return null
    if (slug === 'empty-pathway') return EMPTY_PATHWAY
    if (slug === 'build-the-swing') return SWING
    return null
  }, [slug])

  const listState: LoadState =
    scenario === 'list-error' ? 'error'
    : scenario === 'list-loading' ? 'loading'
    : 'ready'

  const stageState: LoadState =
    !slug ? 'idle'
    : scenario === 'stage-error' ? 'error'
    : 'ready'

  const pathways = scenario === 'no-pathways' ? [] : OPTIONS

  const choose = (s: string | null) => {
    setSlug(s)
    if (!s) { setStageNumber(null); return }
    const p = s === 'empty-pathway' ? EMPTY_PATHWAY : SWING
    setStageNumber(resolveStageNumber(p, null))
  }

  const stage = orderedStages(loaded).find(s => s.stage_number === stageNumber) || null

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-lg font-bold">Pathway picker bench</h1>

        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <PathwayPicker
            pathways={pathways}
            state={listState}
            onRetry={() => setEvents(e => [...e, { event: 'retry_clicked' }])}
            selectedSlug={slug}
            loaded={loaded}
            stageState={stageState}
            stageNumber={stageNumber}
            onSelectPathway={choose}
            onSelectStage={setStageNumber}
            onTrack={(event, metadata) => setEvents(e => [...e, { event, metadata }])}
          />
        </div>

        {/* The generated-plan context card, shown when asked for so the
            acceptance run can assert it renders the summary it is given. */}
        {scenario === 'context' && (
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <PathwayContextCard context={CONTEXT} />
          </div>
        )}
        {scenario === 'context-warning' && (
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <PathwayContextCard
              context={{
                ...CONTEXT,
                warnings: ['No drill in this stage can run in the space you have tonight.'],
              }}
            />
          </div>
        )}
        {/* A plan built with no pathway must render nothing at all here. */}
        {scenario === 'context-none' && (
          <div className="bg-white rounded-lg p-4 border border-gray-200" id="context-slot">
            <PathwayContextCard context={null} />
          </div>
        )}

        <pre id="state" className="text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto">
          {JSON.stringify({
            scenario,
            slug,
            stageNumber,
            stageKey: stage?.stage_key ?? null,
            stageName: stage?.name ?? null,
            totalStages: orderedStages(loaded).length,
            drillCount: stage ? (loaded?.linksByStage.get(stage.id) || []).length : 0,
            events,
          }, null, 2)}
        </pre>
      </div>
    </div>
  )
}
