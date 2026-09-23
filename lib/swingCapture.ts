// The contract between BenchCoach and any swing-analysis implementation.
//
// Today the web app owns capture, review and measurement history. The actual
// high-speed analyzer is deliberately behind this boundary so the same contract
// can be satisfied by:
//   - a server-side computer-vision worker during the MVP;
//   - an iOS AVFoundation implementation later; or
//   - Android Camera2 / on-device analysis later.
//
// Product rule: an analyzer SUGGESTS numbers. A coach confirms them before they
// become player_metrics and enter reports / development reasoning.

export const SWING_ANALYSIS_SCHEMA_VERSION = 1 as const

export type SwingCaptureSource = 'video_upload' | 'native_ios' | 'native_android'
export type SwingCaptureStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'review'
  | 'confirmed'
  | 'failed'

export interface SwingCapture {
  id: string
  team_id: string
  player_id: string
  storage_bucket: string
  storage_path: string
  original_filename: string | null
  mime_type: string | null
  size_bytes: number | null
  source: SwingCaptureSource
  capture_fps: number | null
  frame_width: number | null
  frame_height: number | null
  duration_ms: number | null
  recorded_at: string
  recorded_on: string
  status: SwingCaptureStatus
  exit_velocity_mph: number | null
  launch_angle_deg: number | null
  projected_distance_ft: number | null
  confidence: number | null
  analysis_provider: string | null
  analysis_version: string | null
  analysis_payload: Record<string, unknown>
  analysis_error: string | null
  analyzed_at: string | null
  reviewed_at: string | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

export interface SwingAnalysisRequest {
  schemaVersion: typeof SWING_ANALYSIS_SCHEMA_VERSION
  captureId: string
  videoUrl: string
  captureFps: number | null
  frameWidth: number | null
  frameHeight: number | null
  durationMs: number | null
}

export interface SwingAnalysisResult {
  schemaVersion: typeof SWING_ANALYSIS_SCHEMA_VERSION
  exitVelocityMph: number
  launchAngleDeg: number
  projectedDistanceFt: number
  confidence: number
  provider: string
  modelVersion: string
  // Analyzer-specific diagnostics stay available for audits without becoming
  // columns in the product schema. Never put secrets or the video itself here.
  diagnostics?: Record<string, unknown>
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function validateSwingAnalysisResult(input: unknown):
  | { ok: true; value: SwingAnalysisResult }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Analyzer returned no result.' }
  }

  const raw = input as Record<string, unknown>
  const exitVelocityMph = finite(raw.exitVelocityMph)
  const launchAngleDeg = finite(raw.launchAngleDeg)
  const projectedDistanceFt = finite(raw.projectedDistanceFt)
  const confidence = finite(raw.confidence)

  if (raw.schemaVersion !== SWING_ANALYSIS_SCHEMA_VERSION) {
    return { ok: false, error: 'Analyzer schema version is not supported.' }
  }
  if (exitVelocityMph === null || exitVelocityMph < 1 || exitVelocityMph > 200) {
    return { ok: false, error: 'Analyzer returned an invalid exit velocity.' }
  }
  if (launchAngleDeg === null || launchAngleDeg < -90 || launchAngleDeg > 90) {
    return { ok: false, error: 'Analyzer returned an invalid launch angle.' }
  }
  if (projectedDistanceFt === null || projectedDistanceFt < 0 || projectedDistanceFt > 1000) {
    return { ok: false, error: 'Analyzer returned an invalid projected distance.' }
  }
  if (confidence === null || confidence < 0 || confidence > 1) {
    return { ok: false, error: 'Analyzer returned an invalid confidence score.' }
  }
  if (typeof raw.provider !== 'string' || !raw.provider.trim()) {
    return { ok: false, error: 'Analyzer did not identify its provider.' }
  }
  if (typeof raw.modelVersion !== 'string' || !raw.modelVersion.trim()) {
    return { ok: false, error: 'Analyzer did not identify its model version.' }
  }

  return {
    ok: true,
    value: {
      schemaVersion: SWING_ANALYSIS_SCHEMA_VERSION,
      exitVelocityMph,
      launchAngleDeg,
      projectedDistanceFt,
      confidence,
      provider: raw.provider.trim(),
      modelVersion: raw.modelVersion.trim(),
      diagnostics: raw.diagnostics && typeof raw.diagnostics === 'object'
        ? raw.diagnostics as Record<string, unknown>
        : undefined,
    },
  }
}

export function confidenceLabel(confidence: number | null): string {
  if (confidence == null) return 'Not scored'
  if (confidence >= 0.9) return 'High confidence'
  if (confidence >= 0.75) return 'Good confidence'
  if (confidence >= 0.55) return 'Review closely'
  return 'Low confidence'
}
