'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface SwingAnalysis {
  id: string
  video_url: string
  skeleton_overlay_url?: string
  status: 'uploading' | 'processing' | 'completed' | 'failed'
  error_message?: string
  video_duration_seconds?: number
  metrics?: any
  pose_data?: any[]
  video_fps?: number
  analysis_summary?: string
  identified_issues?: string[]
  recommended_drills?: Array<{
    name: string
    focus: string
    description: string
    coaching_cues: string[]
  }>
  comparison_data?: ComparisonData | null
  comparison_status?: string | null
  players: {
    id: string
    name: string
    jersey_number?: string
  }
  teams?: {
    age_group?: string
  }
  created_at: string
}

// ─── Comparison Types ───────────────────────────────────────────────────────

interface Correction {
  joint: string
  problem: string
  fix: string
  severity: 'high' | 'medium' | 'low'
}

interface ComparisonPhase {
  name: string
  display_name: string
  timestamp: number
  corrections: Correction[]
  image_url: string
}

interface ComparisonData {
  summary: string
  correction_priority: string[]
  phases: ComparisonPhase[]
  summary_image_url: string
  camera_angle?: 'side' | 'front' | 'unknown'
  camera_angle_confidence?: number
}

interface SwingAnalysisViewProps {
  analysisId: string
}

// ─── Severity Styling ───────────────────────────────────────────────────────

const severityConfig = {
  high: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-600 text-white',
    text: 'text-red-800',
    fixText: 'text-red-700',
    dot: 'bg-red-500',
    label: 'HIGH',
  },
  medium: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: 'bg-amber-500 text-white',
    text: 'text-amber-800',
    fixText: 'text-amber-700',
    dot: 'bg-amber-500',
    label: 'MED',
  },
  low: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    badge: 'bg-green-600 text-white',
    text: 'text-green-800',
    fixText: 'text-green-700',
    dot: 'bg-green-500',
    label: 'LOW',
  },
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function SwingAnalysisView({ analysisId }: SwingAnalysisViewProps) {
  const router = useRouter()
  const [analysis, setAnalysis] = useState<SwingAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)

  // Comparison state
  const [comparison, setComparison] = useState<ComparisonData | null>(null)
  const [generatingComparison, setGeneratingComparison] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [activePhase, setActivePhase] = useState(0)
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null)
  const [comparisonView, setComparisonView] = useState<'phases' | 'summary'>('phases')

  // Animation GIF state
  const [correctionGifs, setCorrectionGifs] = useState<Record<number, string>>({})
  const [generatingGif, setGeneratingGif] = useState<number | null>(null)
  const [gifError, setGifError] = useState<string | null>(null)

  useEffect(() => {
    loadAnalysis()

    // Poll for updates if still processing
    const interval = setInterval(() => {
      if (analysis?.status === 'processing') {
        loadAnalysis()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [analysisId])

  // Load comparison data when analysis loads
  useEffect(() => {
    if (analysis?.comparison_data) {
      const parsed = typeof analysis.comparison_data === 'string'
        ? JSON.parse(analysis.comparison_data)
        : analysis.comparison_data
      setComparison(parsed)
    }
  }, [analysis])

  // Keyboard navigation for comparison phases
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (fullscreenImage) {
        if (e.key === 'Escape') setFullscreenImage(null)
        return
      }
      if (!comparison) return
      if (e.key === 'ArrowLeft') {
        setActivePhase(p => Math.max(0, p - 1))
      } else if (e.key === 'ArrowRight') {
        setActivePhase(p => Math.min(comparison.phases.length - 1, p + 1))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [fullscreenImage, comparison])

  const loadAnalysis = async () => {
    try {
      const response = await fetch(`/api/swing-analysis?id=${analysisId}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load analysis')
      }

      setAnalysis(data.analysis)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const generateComparison = async () => {
    if (!analysis) return

    try {
      setGeneratingComparison(true)
      setComparisonError(null)

      const serviceUrl = process.env.NEXT_PUBLIC_SWING_ANALYZER_URL
      if (!serviceUrl) throw new Error('Swing analyzer service URL not configured')

      const response = await fetch(`${serviceUrl}/analyze-comparison`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_id: analysis.id,
          frames_data: analysis.pose_data || [],
          fps: analysis.video_fps || 30,
          player_info: {
            name: analysis.players?.name || 'Player',
            age_group: analysis.teams?.age_group || 'youth',
            experience: 'beginner',
            batting_side: 'right',
          },
          swing_metrics: analysis.metrics || {},
          video_url: analysis.video_url,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Comparison generation failed')
      }

      const result = await response.json()
      if (result.success && result.comparison) {
        setComparison(result.comparison)
      }
    } catch (err: any) {
      setComparisonError(err.message)
    } finally {
      setGeneratingComparison(false)
    }
  }

  const generateCorrectionGif = async (phaseIndex: number) => {
    if (!analysis) return

    try {
      setGeneratingGif(phaseIndex)
      setGifError(null)

      const serviceUrl = process.env.NEXT_PUBLIC_SWING_ANALYZER_URL
      if (!serviceUrl) throw new Error('Swing analyzer service URL not configured')

      const response = await fetch(`${serviceUrl}/generate-correction-gif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_id: analysis.id,
          phase_index: phaseIndex,
          frames_data: analysis.pose_data || [],
          fps: analysis.video_fps || 30,
          player_info: {
            name: analysis.players?.name || 'Player',
            age_group: analysis.teams?.age_group || 'youth',
            experience: 'beginner',
            batting_side: 'right',
          },
          swing_metrics: analysis.metrics || {},
          video_url: analysis.video_url,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate animation')
      }

      const result = await response.json()
      if (result.success && result.gif_url) {
        setCorrectionGifs(prev => ({ ...prev, [phaseIndex]: result.gif_url }))
      }
    } catch (err: any) {
      setGifError(err.message)
    } finally {
      setGeneratingGif(null)
    }
  }

  // ─── Loading State ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center space-y-4">
          <svg
            className="animate-spin h-12 w-12 mx-auto text-blue-600"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-gray-600">Loading analysis...</p>
        </div>
      </div>
    )
  }

  // ─── Error State ────────────────────────────────────────────────────────

  if (error || !analysis) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-800 mb-2">Error</h3>
        <p className="text-red-700">{error || 'Analysis not found'}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-red-800 underline"
        >
          Go back
        </button>
      </div>
    )
  }

  // ─── Current comparison phase ───────────────────────────────────────────

  const currentPhase = comparison?.phases?.[activePhase] || null

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">
            Swing Analysis: {analysis.players.name}
          </h2>
          <p className="text-sm text-gray-600">
            {new Date(analysis.created_at).toLocaleDateString()}
          </p>
        </div>

        {/* Status Badge */}
        <div>
          {analysis.status === 'processing' && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
              <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Processing...
            </span>
          )}
          {analysis.status === 'completed' && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
              ✓ Complete
            </span>
          )}
          {analysis.status === 'failed' && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
              ✗ Failed
            </span>
          )}
        </div>
      </div>

      {/* Processing State */}
      {analysis.status === 'processing' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <p className="text-blue-800">
            Your swing video is being analyzed. This usually takes 30-60 seconds.
            This page will automatically update when processing is complete.
          </p>
        </div>
      )}

      {/* Failed State */}
      {analysis.status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="font-semibold text-red-800 mb-2">Processing Failed</h3>
          <p className="text-red-700">{analysis.error_message}</p>
        </div>
      )}

      {/* Completed Analysis */}
      {analysis.status === 'completed' && (
        <>
          {/* Video Player */}
          <div className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Swing Video</h3>
              
              {analysis.skeleton_overlay_url && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setShowOriginal(false)}
                    className={`px-3 py-1 text-sm rounded ${
                      !showOriginal
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    With Analysis
                  </button>
                  <button
                    onClick={() => setShowOriginal(true)}
                    className={`px-3 py-1 text-sm rounded ${
                      showOriginal
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Original
                  </button>
                </div>
              )}
            </div>

            <div className="bg-black rounded-lg overflow-hidden">
              <video
                src={showOriginal ? analysis.video_url : (analysis.skeleton_overlay_url || analysis.video_url)}
                controls
                className="w-full max-h-[500px]"
                key={showOriginal ? 'original' : 'overlay'}
              />
            </div>
          </div>

          {/* Analysis Summary */}
          {analysis.analysis_summary && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="font-semibold text-lg mb-3">Analysis Summary</h3>
              <p className="text-gray-700">{analysis.analysis_summary}</p>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* FRAME-BY-FRAME COMPARISON SECTION                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            {!comparison ? (
              /* ── Generate Button ── */
              <div className="text-center py-6">
                <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Frame-by-Frame Comparison
                </h3>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">
                  See how this swing compares to ideal mechanics at each key phase — 
                  stance, load, contact, and follow-through.
                </p>

                {comparisonError && (
                  <div className="mb-4 mx-auto max-w-md p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    {comparisonError}
                  </div>
                )}

                <button
                  onClick={generateComparison}
                  disabled={generatingComparison}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg
                             bg-blue-600 hover:bg-blue-700 text-white font-medium
                             transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingComparison ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating Comparison...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Swing Comparison
                    </>
                  )}
                </button>

                {generatingComparison && (
                  <p className="mt-3 text-gray-400 text-sm">
                    This takes 15-30 seconds. AI is analyzing your swing mechanics...
                  </p>
                )}
              </div>
            ) : (
              /* ── Comparison Results ── */
              <div className="space-y-5">
                {/* Comparison Header */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Swing Comparison
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">{comparison.summary}</p>
                  </div>

                  {/* View toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-gray-200">
                    <button
                      onClick={() => setComparisonView('phases')}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        comparisonView === 'phases'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Phase View
                    </button>
                    <button
                      onClick={() => setComparisonView('summary')}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        comparisonView === 'summary'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Summary Strip
                    </button>
                  </div>
                </div>

                {/* Front view warning */}
                {comparison.camera_angle === 'front' && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-blue-800">
                        Front view detected
                      </p>
                      <p className="text-sm text-blue-600 mt-0.5">
                        This video was filmed from the front. The analysis focuses on stance width, rotation, 
                        and balance. For bat path and stride analysis, try filming from the side 
                        (3rd base side for right-handed batters).
                      </p>
                    </div>
                  </div>
                )}

                {/* Summary Strip View */}
                {comparisonView === 'summary' && comparison.summary_image_url && (
                  <div
                    className="relative rounded-lg overflow-hidden border border-gray-200 cursor-pointer group"
                    onClick={() => setFullscreenImage(comparison.summary_image_url)}
                  >
                    <img
                      src={comparison.summary_image_url}
                      alt="Swing comparison summary - all phases"
                      className="w-full h-auto"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <span className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        Click to enlarge
                      </span>
                    </div>
                  </div>
                )}

                {/* Phase-by-Phase View */}
                {comparisonView === 'phases' && (
                  <>
                    {/* Phase selector tabs */}
                    <div className="flex gap-2">
                      {comparison.phases.map((phase, idx) => {
                        const isActive = idx === activePhase
                        const hasHigh = phase.corrections?.some(c => c.severity === 'high')
                        const hasMed = phase.corrections?.some(c => c.severity === 'medium')

                        return (
                          <button
                            key={phase.name}
                            onClick={() => setActivePhase(idx)}
                            className={`flex-1 relative px-3 py-2.5 rounded-lg text-sm font-medium
                                        transition-all border ${
                              isActive
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            <span className="text-xs opacity-60 block">{idx + 1}</span>
                            <span className="block mt-0.5">{phase.display_name}</span>

                            {/* Severity dot */}
                            {phase.corrections && phase.corrections.length > 0 && (
                              <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                                hasHigh ? 'bg-red-500' :
                                hasMed ? 'bg-amber-500' : 'bg-green-500'
                              }`} />
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {/* Phase comparison image */}
                    {currentPhase && (
                      <div className="space-y-4">
                        {currentPhase.image_url && (
                          <div
                            className="relative rounded-lg overflow-hidden border border-gray-200 cursor-pointer group"
                            onClick={() => setFullscreenImage(currentPhase.image_url)}
                          >
                            <img
                              src={currentPhase.image_url}
                              alt={`${currentPhase.display_name} comparison`}
                              className="w-full h-auto"
                            />
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-lg">
                                Click to enlarge
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Corrections for this phase */}
                        {currentPhase.corrections && currentPhase.corrections.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-600">
                              Corrections for {currentPhase.display_name}
                            </h4>
                            {currentPhase.corrections.map((correction, idx) => {
                              const config = severityConfig[correction.severity] || severityConfig.medium

                              return (
                                <div
                                  key={idx}
                                  className={`p-3 rounded-lg border ${config.border} ${config.bg}`}
                                >
                                  <div className="flex items-start gap-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${config.badge} whitespace-nowrap mt-0.5`}>
                                      {config.label}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-sm font-medium ${config.text}`}>
                                        {correction.problem}
                                      </p>
                                      {correction.fix && (
                                        <p className={`text-sm mt-1 ${config.fixText}`}>
                                          → {correction.fix}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Correction Animation */}
                        {currentPhase.corrections && currentPhase.corrections.length > 0 && (
                          <div className="mt-4">
                            {correctionGifs[activePhase] ? (
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium text-gray-600 flex items-center gap-2">
                                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Correction Animation
                                </h4>
                                <div
                                  className="rounded-lg overflow-hidden border border-gray-200 cursor-pointer"
                                  onClick={() => setFullscreenImage(correctionGifs[activePhase])}
                                >
                                  <img
                                    src={correctionGifs[activePhase]}
                                    alt={`${currentPhase.display_name} correction animation`}
                                    className="w-full h-auto"
                                  />
                                </div>
                                <p className="text-xs text-gray-400 text-center">
                                  Orange = current form → Green = ideal form (loops automatically)
                                </p>
                              </div>
                            ) : (
                              <button
                                onClick={() => generateCorrectionGif(activePhase)}
                                disabled={generatingGif !== null}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                                           border border-green-200 bg-green-50 text-green-700
                                           hover:bg-green-100 transition-colors text-sm font-medium
                                           disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {generatingGif === activePhase ? (
                                  <>
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Generating Animation...
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Show Correction Animation
                                  </>
                                )}
                              </button>
                            )}
                            {gifError && generatingGif === null && (
                              <p className="text-xs text-red-500 text-center mt-1">{gifError}</p>
                            )}
                          </div>
                        )}

                        {/* Navigation arrows */}
                        <div className="flex items-center justify-between pt-2">
                          <button
                            onClick={() => setActivePhase(p => Math.max(0, p - 1))}
                            disabled={activePhase === 0}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm
                                       text-gray-500 hover:text-gray-700 hover:bg-gray-50
                                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                            Previous
                          </button>

                          <span className="text-gray-400 text-xs">
                            {activePhase + 1} / {comparison.phases.length} — Use ← → keys
                          </span>

                          <button
                            onClick={() => setActivePhase(p => Math.min(comparison.phases.length - 1, p + 1))}
                            disabled={activePhase === comparison.phases.length - 1}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm
                                       text-gray-500 hover:text-gray-700 hover:bg-gray-50
                                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            Next
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Priority Fixes */}
                {comparison.correction_priority && comparison.correction_priority.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h4 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Priority Fixes (Most Important First)
                    </h4>
                    <ol className="space-y-2">
                      {comparison.correction_priority.map((fix, idx) => (
                        <li key={idx} className="flex items-start gap-3 text-sm">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-medium mt-0.5">
                            {idx + 1}
                          </span>
                          <span className="text-amber-900">{fix}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* END: COMPARISON SECTION                                        */}
          {/* ═══════════════════════════════════════════════════════════════ */}

          {/* Identified Issues */}
          {analysis.identified_issues && analysis.identified_issues.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="font-semibold text-lg mb-3">Areas to Work On</h3>
              <ul className="space-y-2">
                {analysis.identified_issues.map((issue, idx) => (
                  <li key={idx} className="flex items-start space-x-2">
                    <span className="text-yellow-600 mt-1">⚠</span>
                    <span className="text-gray-700">{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended Drills */}
          {analysis.recommended_drills && analysis.recommended_drills.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="font-semibold text-lg mb-4">Recommended Drills</h3>
              <div className="space-y-6">
                {analysis.recommended_drills.map((drill, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-semibold text-gray-900">{drill.name}</h4>
                    <p className="text-sm text-blue-600 mb-2">{drill.focus}</p>
                    <p className="text-gray-700 mb-3">{drill.description}</p>
                    
                    {drill.coaching_cues && drill.coaching_cues.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-600 mb-1">
                          Coaching Cues:
                        </p>
                        <ul className="space-y-1">
                          {drill.coaching_cues.map((cue, cueIdx) => (
                            <li key={cueIdx} className="text-sm text-gray-600 ml-4">
                              • {cue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metrics (Raw Data - Collapsible) */}
          {analysis.metrics && Object.keys(analysis.metrics).length > 0 && (
            <details className="bg-gray-50 rounded-lg border">
              <summary className="px-6 py-4 cursor-pointer font-semibold text-gray-700">
                View Technical Metrics
              </summary>
              <div className="px-6 pb-4 space-y-4">
                {Object.entries(analysis.metrics).map(([key, value]: [string, any]) => (
                  <div key={key} className="bg-white rounded p-4">
                    <h4 className="font-medium text-gray-900 mb-2 capitalize">
                      {key.replace(/_/g, ' ')}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600">Range:</span>{' '}
                        <span className="font-medium">{value.range?.toFixed(1)}°</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Average:</span>{' '}
                        <span className="font-medium">{value.mean?.toFixed(1)}°</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Min:</span>{' '}
                        <span className="font-medium">{value.min?.toFixed(1)}°</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Max:</span>{' '}
                        <span className="font-medium">{value.max?.toFixed(1)}°</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {/* ── Fullscreen Image Modal ── */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setFullscreenImage(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            onClick={() => setFullscreenImage(null)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={fullscreenImage}
            alt="Full size comparison"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
