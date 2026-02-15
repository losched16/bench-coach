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
  analysis_summary?: string
  identified_issues?: string[]
  recommended_drills?: Array<{
    name: string
    focus: string
    description: string
    coaching_cues: string[]
  }>
  players: {
    id: string
    name: string
    jersey_number?: string
  }
  created_at: string
}

interface SwingAnalysisViewProps {
  analysisId: string
}

export default function SwingAnalysisView({ analysisId }: SwingAnalysisViewProps) {
  const router = useRouter()
  const [analysis, setAnalysis] = useState<SwingAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)

  useEffect(() => {
    loadAnalysis()

    // Poll for updates if still processing
    const interval = setInterval(() => {
      if (analysis?.status === 'processing') {
        loadAnalysis()
      }
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(interval)
  }, [analysisId])

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
    </div>
  )
}
