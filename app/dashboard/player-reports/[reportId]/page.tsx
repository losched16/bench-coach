'use client'

// Writing a player development report.
//
// The whole design brief for this screen is one sentence: a volunteer coach,
// on a phone, in a car park, after a game, should be able to finish this. That
// rules out a scouting form. It is six short steps, each asking one question,
// and any of them can be left empty.
//
// THE ORDER IS THE ARGUMENT
//
//   What is this player doing well?
//   What should they work on next?
//   How can they work on it?
//
// Strengths come first on purpose. A document that opens with what a kid is
// bad at is not a development report, it is a complaint, and no parent reads
// the rest of it fairly.
//
// NOTHING IS COMMITTED BY DEFAULT
//
// Every AI suggestion on this page is shown beside the coach's own words and
// has to be accepted by hand. Every drill has to be added by hand. Finalizing
// is a separate act on the last step, after a full preview. There is no path
// through this screen where something the coach did not read ends up in the
// PDF.

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, ArrowRight, Check, Loader2, FileText, Download,
  Plus, Trash2, AlertCircle, Save, Pencil,
} from 'lucide-react'
import { usePageView, useTracker } from '@/lib/tracking'
import { FOCUS_AREAS, FOCUS_AREA_ORDER } from '@/lib/focusAreas'
import {
  REPORT_TYPES, MAX_FOCUS_AREAS, contextLine, formatReportDate,
  reportTypeLabel, type FullReport,
} from '@/lib/playerReports'
import { watchUrl } from '@/lib/drillVideo'
import { AiAssist } from '@/components/playerReport/AiAssist'
import { DrillPicker, type PickedDrill } from '@/components/playerReport/DrillPicker'
import { ReportPreview } from '@/components/playerReport/ReportPreview'

// A priority as the wizard holds it. `key` is client-side and stable across
// saves; `id` is the database row once there is one. Drills reference the key,
// so a priority the coach has just typed can already have drills attached to
// it before it has ever been saved.
interface DraftFocusArea {
  key: string
  id: string | null
  problemSlug: string | null
  focusArea: string | null
  label: string
  coachNotes: string | null
  approvedContent: string
}

interface TaxonomyProblem { slug: string; label: string; skill_category: string | null }

const STEPS = [
  { key: 'setup', title: 'Report setup', question: 'What kind of report is this?' },
  { key: 'strengths', title: 'Strengths', question: 'What is this player doing well?' },
  { key: 'development', title: 'Development', question: 'Where would you like them to improve?' },
  { key: 'drills', title: 'Drills', question: 'How can they work on it?' },
  { key: 'closing', title: 'Closing', question: 'Anything else for the family?' },
  { key: 'review', title: 'Review', question: 'Ready to send?' },
]

let keySeed = 0
const nextKey = () => `fa-${Date.now().toString(36)}-${keySeed++}`

function PlayerReportContent() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const reportId = String(params?.reportId || '')
  const teamId = searchParams.get('teamId')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [report, setReport] = useState<FullReport | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  // Whether this caller could author a report at all, which is a different
  // question from whether THIS report is still editable. A finalized report is
  // uneditable for everybody; only an admin may start a revision of one.
  const [canAuthor, setCanAuthor] = useState(false)
  const [step, setStep] = useState(0)

  const [reportType, setReportType] = useState('general')
  const [reportDate, setReportDate] = useState('')
  const [strengthAreas, setStrengthAreas] = useState<string[]>([])
  const [strengthsContent, setStrengthsContent] = useState('')
  const [developmentIntro, setDevelopmentIntro] = useState('')
  const [focusAreas, setFocusAreas] = useState<DraftFocusArea[]>([])
  const [drills, setDrills] = useState<PickedDrill[]>([])
  const [closingContent, setClosingContent] = useState('')

  const [taxonomy, setTaxonomy] = useState<TaxonomyProblem[]>([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const track = useTracker()

  // Set once the coach has changed something, so the debounced save does not
  // fire on load and the leave-warning does not appear for a report they only
  // looked at.
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- Loading -----------------------------------------------------------

  const hydrate = useCallback((full: FullReport) => {
    setReport(full)
    setReportType(full.report_type)
    setReportDate((full.report_date || '').slice(0, 10))
    setStrengthAreas(full.strength_areas || [])
    setStrengthsContent(full.strengths_content || '')
    setDevelopmentIntro(full.development_intro || '')
    setClosingContent(full.closing_content || '')

    const areas: DraftFocusArea[] = (full.focusAreas || []).map(f => ({
      key: nextKey(),
      id: f.id,
      problemSlug: f.problem_slug,
      focusArea: f.focus_area,
      label: f.label,
      coachNotes: f.coach_notes,
      approvedContent: f.approved_content || '',
    }))
    setFocusAreas(areas)

    const byId = new Map(areas.filter(a => a.id).map(a => [a.id as string, a.key]))
    setDrills((full.drills || []).map(d => ({
      drillId: d.drill_id || '',
      focusAreaId: d.focus_area_id ? byId.get(d.focus_area_id) || null : null,
      includeVideo: d.include_video,
      source: d.source,
      name: d.snapshot?.drill_name || 'Drill',
      description: d.snapshot?.description || null,
      reason: d.recommendation_reason,
      // The library fields are not stored on the report row, so a reloaded
      // draft shows the drill without an inline video preview until the coach
      // asks for suggestions again. The report itself is unaffected — the link
      // comes from the snapshot on the server.
      youtubeVideoId: null,
      youtubeUrl: d.snapshot?.video_url || null,
      thumbnailUrl: null,
      youtubeStartSeconds: d.snapshot?.video_start_seconds ?? null,
      channel: d.snapshot?.channel || null,
    })).filter(d => d.drillId))
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/player-reports/${reportId}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) { setLoadError(data?.error || 'That report could not be loaded.'); return }
        hydrate(data.report)
        setCanEdit(Boolean(data.canEdit))
        setCanAuthor(Boolean(data.canAuthor))
        // A finalized report opens on its preview — there is nothing to edit.
        if (data.report?.status === 'final') setStep(STEPS.length - 1)
      } catch {
        if (!cancelled) setLoadError('That report could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reportId, hydrate])

  // The problem taxonomy, reused from the prescription engine rather than
  // duplicated — these are the same development areas the rest of the app
  // reasons about, which is what makes a report's priorities aggregatable
  // later.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/prescribe')
        const data = await res.json()
        if (!cancelled && Array.isArray(data?.problems)) setTaxonomy(data.problems)
      } catch { /* the coach can still type their own label */ }
    })()
    return () => { cancelled = true }
  }, [])

  // ---- Saving ------------------------------------------------------------

  const buildPayload = useCallback(() => ({
    reportType,
    reportDate: reportDate || undefined,
    strengthsContent,
    strengthAreas,
    developmentIntro,
    closingContent,
    focusAreas: focusAreas
      .filter(f => f.label.trim())
      .map(f => ({
        id: f.id,
        problemSlug: f.problemSlug,
        focusArea: f.focusArea,
        label: f.label,
        coachNotes: f.coachNotes,
        approvedContent: f.approvedContent,
      })),
  }), [reportType, reportDate, strengthsContent, strengthAreas, developmentIntro, closingContent, focusAreas])

  /**
   * Save, and adopt whatever the server says the report now is.
   *
   * Priorities are saved before drills in one request, and the response
   * carries the priority ids — so the client's keys get their database ids
   * back here, and drills posted on the next save can reference them.
   */
  const save = useCallback(async (opts: { withDrills?: boolean } = {}) => {
    if (!canEdit) return true
    setSaving(true)
    setActionError(null)
    try {
      const localAreas = focusAreas.filter(f => f.label.trim())
      const payload: any = buildPayload()

      if (opts.withDrills) {
        // Keys the server has never seen cannot be sent as focus_area_id, so
        // drills attached to a brand-new priority go up unattached on this
        // pass and get attached on the next one. That is invisible to the
        // coach and cannot lose a drill.
        payload.drills = drills.map(d => {
          const area = localAreas.find(a => a.key === d.focusAreaId)
          return {
            drillId: d.drillId,
            focusAreaId: area?.id || null,
            includeVideo: d.includeVideo,
            source: d.source,
          }
        })
      }

      const res = await fetch(`/api/player-reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setActionError(data?.error || 'Could not save.'); return false }

      // Give the client's keys their new database ids, matched by the order
      // they were sent in — the server writes them in that order.
      //
      // Unlabelled priorities are skipped rather than dropped: a coach who has
      // pressed "Add another" and not yet named it must not have the empty
      // card vanish under them when the autosave fires.
      const returned = (data.report?.focusAreas || []) as any[]
      setFocusAreas(prev => {
        let i = 0
        return prev.map(f => (f.label.trim() ? { ...f, id: returned[i++]?.id ?? f.id } : f))
      })
      setReport(r => (r ? { ...r, ...data.report } : data.report))
      setSavedAt(Date.now())
      dirty.current = false
      return true
    } catch {
      setActionError('Could not save — check your connection. Nothing has been lost.')
      return false
    } finally {
      setSaving(false)
    }
  }, [canEdit, buildPayload, drills, focusAreas, reportId])

  // Debounced autosave. Deliberately not on every keystroke: a coach typing a
  // paragraph on a phone would otherwise fire thirty writes, and the last one
  // is the only one that matters.
  useEffect(() => {
    if (!canEdit || !dirty.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void save({ withDrills: true }) }, 2000)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [canEdit, save, reportType, reportDate, strengthsContent, strengthAreas,
      developmentIntro, closingContent, focusAreas, drills])

  // A coach who closes the tab mid-sentence should be warned, once, and only
  // when there is genuinely something unsaved.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [])

  const touch = <T,>(setter: (v: T) => void) => (v: T) => { dirty.current = true; setter(v) }

  // ---- Derived -----------------------------------------------------------

  const taxonomyByCategory = useMemo(() => {
    const groups = new Map<string, TaxonomyProblem[]>()
    for (const p of taxonomy) {
      const cat = p.skill_category || 'Other'
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(p)
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [taxonomy])

  /**
   * The report as it would print, right now.
   *
   * Assembled from local state rather than from the server's copy so the
   * preview reflects the sentence the coach just typed. It goes through the
   * same renderSections() the PDF uses, inside ReportPreview.
   */
  const previewReport: FullReport | null = useMemo(() => {
    if (!report) return null
    return {
      ...report,
      report_type: reportType as any,
      report_date: reportDate,
      strengths_content: strengthsContent.trim() || null,
      development_intro: developmentIntro.trim() || null,
      closing_content: closingContent.trim() || null,
      strength_areas: strengthAreas,
      focusAreas: focusAreas.filter(f => f.label.trim()).map((f, i) => ({
        id: f.id || f.key,
        problem_slug: f.problemSlug,
        focus_area: f.focusArea,
        label: f.label,
        coach_notes: f.coachNotes,
        approved_content: f.approvedContent.trim() || null,
        sort_order: i,
      })),
      drills: drills.map((d, i) => ({
        id: d.drillId,
        focus_area_id: d.focusAreaId,
        drill_id: d.drillId,
        snapshot: {
          drill_name: d.name,
          description: d.description,
          focus: null,
          channel: d.channel,
          // The same helper every surface uses, so the preview link is the
          // link the document will carry — timestamp included where one is set.
          video_url: watchUrl({
            youtube_video_id: d.youtubeVideoId,
            youtube_url: d.youtubeUrl,
            youtube_start_seconds: d.youtubeStartSeconds,
          }),
          video_start_seconds: d.youtubeStartSeconds,
          video_start_source: null,
          reps_guidance: null,
          frequency_guidance: null,
        },
        recommendation_reason: d.reason,
        source: d.source,
        include_video: d.includeVideo,
        sort_order: i,
      })),
    }
  }, [report, reportType, reportDate, strengthsContent, developmentIntro,
      closingContent, strengthAreas, focusAreas, drills])

  const savedFocusAreas = focusAreas
    .filter(f => f.label.trim())
    .map(f => ({ id: f.key, label: f.label }))

  // ---- Actions -----------------------------------------------------------

  const goTo = async (next: number) => {
    if (canEdit && dirty.current) await save({ withDrills: true })
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addFocusArea = () => {
    if (focusAreas.length >= MAX_FOCUS_AREAS) return
    dirty.current = true
    setFocusAreas(a => [...a, {
      key: nextKey(), id: null, problemSlug: null, focusArea: null,
      label: '', coachNotes: null, approvedContent: '',
    }])
  }

  const updateFocusArea = (key: string, patch: Partial<DraftFocusArea>) => {
    dirty.current = true
    setFocusAreas(a => a.map(f => (f.key === key ? { ...f, ...patch } : f)))
  }

  const removeFocusArea = (key: string) => {
    dirty.current = true
    setFocusAreas(a => a.filter(f => f.key !== key))
    // A drill whose priority has gone stays in the report as a general
    // recommendation rather than disappearing with it — the coach chose it.
    setDrills(d => d.map(x => (x.focusAreaId === key ? { ...x, focusAreaId: null } : x)))
  }

  const finalize = async () => {
    setFinalizing(true)
    setActionError(null)
    const ok = await save({ withDrills: true })
    if (!ok) { setFinalizing(false); return }
    try {
      const res = await fetch(`/api/player-reports/${reportId}/finalize`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setActionError(data?.error || 'Could not finalize.'); return }
      track('player_report_finalized', {
        reportId,
        priorities: focusAreas.filter(f => f.label.trim()).length,
        drills: drills.length,
        revision: data.report?.revision ?? 1,
      })
      hydrate(data.report)
      setCanEdit(false)
      setStep(STEPS.length - 1)
    } catch {
      setActionError('Could not finalize. Your draft is still saved — try again in a moment.')
    } finally {
      setFinalizing(false)
    }
  }

  const startRevision = async () => {
    setActionError(null)
    try {
      const res = await fetch(`/api/player-reports/${reportId}/revise`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setActionError(data?.error || 'Could not start a revision.'); return }
      router.push(`/dashboard/player-reports/${data.report.id}${teamId ? `?teamId=${teamId}` : ''}`)
    } catch {
      setActionError('Could not start a revision. The report you sent is unchanged.')
    }
  }

  // ---- Render ------------------------------------------------------------
  // Every hook is above this line. React counts them per render, so an early
  // return with hooks below it takes the page down — see scripts/verify-hooks.

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} aria-hidden />
        Loading the report…
      </div>
    )
  }

  if (loadError || !report || !previewReport) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <p className="text-gray-900 font-medium">{loadError || 'Report not found.'}</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-red-600 hover:text-red-700">
          Go back
        </button>
      </div>
    )
  }

  const isFinal = report.status === 'final'
  const current = STEPS[step]
  const backHref = `/dashboard/roster/${report.player_id}?teamId=${report.team_id}`

  return (
    <div className="max-w-3xl mx-auto pb-32">
      {/* ---- Header --------------------------------------------------- */}
      <div className="flex items-start gap-3">
        <Link
          href={backHref}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-600"
          aria-label="Back to the player"
        >
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
            {report.context?.player_name || 'Player'}
          </h1>
          <p className="text-sm text-gray-500">
            {[contextLine(report.context), reportTypeLabel(report.report_type)]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* ---- Progress -------------------------------------------------- */}
      {!isFinal && (
        <nav aria-label="Report steps" className="mt-5">
          <ol className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex-1">
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={i === step ? 'step' : undefined}
                  className={`w-full h-1.5 rounded-full transition-colors ${
                    i <= step ? 'bg-red-600' : 'bg-gray-200'
                  }`}
                >
                  <span className="sr-only">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-gray-500">
            Step {step + 1} of {STEPS.length} · {current.title}
          </p>
        </nav>
      )}

      {actionError && (
        <div role="alert" className="mt-4 flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden />
          <span>{actionError}</span>
        </div>
      )}

      {isFinal && (
        <div className="mt-4 flex gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-900">
          <Check size={16} className="shrink-0 mt-0.5" aria-hidden />
          <span>
            Finalized {formatReportDate(report.finalized_at?.slice(0, 10) || report.report_date)}.
            This version will not change. To alter anything, start a revision — the version
            you shared stays as it is.
          </span>
        </div>
      )}

      <div className="mt-6">
        {!isFinal && (
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{current.question}</h2>
        )}

        {/* ---- 1. Setup ------------------------------------------------ */}
        {!isFinal && current.key === 'setup' && (
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-medium text-gray-900">Report type</legend>
              <div className="mt-2 space-y-2">
                {REPORT_TYPES.map(t => (
                  <label
                    key={t.key}
                    className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${
                      reportType === t.key ? 'border-red-600 bg-red-50/50' : 'border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reportType"
                      value={t.key}
                      checked={reportType === t.key}
                      onChange={() => touch(setReportType)(t.key)}
                      className="mt-1 text-red-600 focus:ring-red-500"
                    />
                    <span>
                      <span className="block font-medium text-gray-900 text-sm">{t.label}</span>
                      <span className="block text-xs text-gray-500">{t.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="report-date" className="block text-sm font-medium text-gray-900">
                Report date
              </label>
              <input
                id="report-date"
                type="date"
                value={reportDate}
                onChange={e => touch(setReportDate)(e.target.value)}
                className="mt-2 px-3 py-2.5 text-[16px] border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>

            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-600">
              <p className="font-medium text-gray-900">Already filled in</p>
              <p className="mt-1">
                {[
                  report.context?.player_name,
                  report.context?.age_group,
                  report.context?.season_name,
                  report.context?.team_name,
                  report.context?.coach_name ? `Coach ${report.context.coach_name}` : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        )}

        {/* ---- 2. Strengths -------------------------------------------- */}
        {!isFinal && current.key === 'strengths' && (
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-medium text-gray-900">
                Where are they strong? <span className="font-normal text-gray-500">(optional)</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {FOCUS_AREA_ORDER.map(area => {
                  const on = strengthAreas.includes(area)
                  return (
                    <button
                      key={area}
                      type="button"
                      aria-pressed={on}
                      onClick={() => touch(setStrengthAreas)(
                        on ? strengthAreas.filter(a => a !== area) : [...strengthAreas, area]
                      )}
                      className={`px-3 py-2 rounded-full text-sm font-medium border transition-colors ${
                        on
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {on && <Check size={13} className="inline mr-1 -mt-0.5" aria-hidden />}
                      {FOCUS_AREAS[area].label}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <AiAssist
              reportId={reportId}
              kind="strengths"
              label="In your own words"
              hint="Rough notes are fine — BenchCoach can tidy them up afterwards."
              placeholder="e.g. stays through the baseball, makes consistent contact, one of our most aggressive base runners"
              value={strengthsContent}
              onChange={touch(setStrengthsContent)}
              rows={6}
            />
          </div>
        )}

        {/* ---- 3. Development ------------------------------------------ */}
        {!isFinal && current.key === 'development' && (
          <div className="space-y-5">
            <p className="text-sm text-gray-600">
              One to three things, no more. A player working on three corrections at once
              runs none of them properly.
            </p>

            {focusAreas.map((f, i) => (
              <div key={f.key} className="rounded-lg border border-gray-200 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 text-sm">Priority {i + 1}</h3>
                  <button
                    type="button"
                    onClick={() => removeFocusArea(f.key)}
                    aria-label={`Remove priority ${i + 1}`}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>

                <div>
                  <label
                    htmlFor={`priority-${f.key}`}
                    className="block text-sm font-medium text-gray-900"
                  >
                    What is it?
                  </label>
                  <select
                    id={`priority-${f.key}`}
                    value={f.problemSlug || (f.label ? '__custom__' : '')}
                    onChange={e => {
                      const v = e.target.value
                      if (v === '__custom__') {
                        updateFocusArea(f.key, { problemSlug: null, focusArea: null, label: '' })
                        return
                      }
                      const found = taxonomy.find(p => p.slug === v)
                      updateFocusArea(f.key, {
                        problemSlug: found ? found.slug : null,
                        focusArea: null,
                        label: found ? found.label : '',
                      })
                    }}
                    className="mt-2 w-full px-3 py-2.5 text-[16px] border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                  >
                    <option value="">Choose a development area…</option>
                    {taxonomyByCategory.map(([category, problems]) => (
                      <optgroup key={category} label={category}>
                        {problems.map(p => (
                          <option key={p.slug} value={p.slug}>{p.label}</option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="__custom__">Something else — I&apos;ll write it</option>
                  </select>
                </div>

                {!f.problemSlug && (
                  <div>
                    <label
                      htmlFor={`priority-label-${f.key}`}
                      className="block text-sm font-medium text-gray-900"
                    >
                      Name it
                    </label>
                    <input
                      id={`priority-label-${f.key}`}
                      type="text"
                      value={f.label}
                      onChange={e => updateFocusArea(f.key, { label: e.target.value })}
                      placeholder="e.g. Ground-ball fundamentals"
                      className="mt-2 w-full px-3 py-2.5 text-[16px] border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                )}

                <AiAssist
                  reportId={reportId}
                  kind="development"
                  label="What have you seen?"
                  hint="What you would say to the parent standing next to you."
                  placeholder="e.g. gets his glove down late and sometimes fields ground balls underneath his body"
                  focusLabel={f.label || null}
                  value={f.approvedContent}
                  onChange={v => updateFocusArea(f.key, { approvedContent: v })}
                  onAssistRequested={original => {
                    // Only the first time: this records what the coach actually
                    // wrote, before any help, and a second capture would
                    // overwrite it with an already-assisted version.
                    if (!f.coachNotes) updateFocusArea(f.key, { coachNotes: original })
                  }}
                  rows={4}
                  id={`priority-notes-${f.key}`}
                />
              </div>
            ))}

            {focusAreas.length < MAX_FOCUS_AREAS && (
              <button
                type="button"
                onClick={addFocusArea}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Plus size={16} aria-hidden />
                {focusAreas.length === 0 ? 'Add a development area' : 'Add another'}
              </button>
            )}
          </div>
        )}

        {/* ---- 4. Drills ----------------------------------------------- */}
        {!isFinal && current.key === 'drills' && (
          <DrillPicker
            reportId={reportId}
            focusAreas={savedFocusAreas}
            selected={drills}
            onChange={touch(setDrills)}
            disabled={!canEdit}
          />
        )}

        {/* ---- 5. Closing ---------------------------------------------- */}
        {!isFinal && current.key === 'closing' && (
          <AiAssist
            reportId={reportId}
            kind="closing"
            label="Closing comment"
            hint="Optional. A line or two, in your voice."
            placeholder="e.g. Great kid. Has worked hard and come a long way this year. Just needs to keep building confidence at shortstop."
            value={closingContent}
            onChange={touch(setClosingContent)}
            rows={5}
          />
        )}

        {/* ---- 6. Review ----------------------------------------------- */}
        {(isFinal || current.key === 'review') && (
          <div className="space-y-4">
            <ReportPreview report={previewReport} />

            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/player-reports/${reportId}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <FileText size={16} aria-hidden />
                {isFinal ? 'Open PDF' : 'Preview the PDF'}
              </a>
              {isFinal && (
                <>
                  <a
                    href={`/api/player-reports/${reportId}/pdf?download=1`}
                    onClick={() => track('player_report_pdf_generated', { reportId })}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
                  >
                    <Download size={16} aria-hidden />
                    Download PDF
                  </a>
                  {canAuthor && (
                    <button
                      type="button"
                      onClick={startRevision}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil size={16} aria-hidden />
                      Start a revision
                    </button>
                  )}
                </>
              )}
            </div>

            {!isFinal && (
              <p className="text-sm text-gray-500">
                Finalizing locks this version so the copy you share stays exactly as it is.
                You can start a revision afterwards if something needs changing.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---- Sticky footer ------------------------------------------- */}
      {!isFinal && (
        <div className="fixed bottom-0 inset-x-0 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3 z-30">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              disabled={step === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              <ArrowLeft size={16} aria-hidden />
              Back
            </button>

            <span className="flex-1 text-xs text-gray-500 truncate" aria-live="polite">
              {saving
                ? 'Saving…'
                : savedAt
                  ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                  : 'Draft'}
            </span>

            {step < STEPS.length - 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => save({ withDrills: true })}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Save size={16} aria-hidden />
                  <span className="hidden sm:inline">Save</span>
                </button>
                <button
                  type="button"
                  onClick={() => goTo(step + 1)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
                >
                  Next
                  <ArrowRight size={16} aria-hidden />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={finalize}
                disabled={finalizing || saving}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {finalizing
                  ? <Loader2 size={16} className="animate-spin" aria-hidden />
                  : <Check size={16} aria-hidden />}
                Finalize report
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PlayerReportPage() {
  usePageView('player_report')
  return (
    <Suspense fallback={<div className="text-gray-600">Loading…</div>}>
      <PlayerReportContent />
    </Suspense>
  )
}
