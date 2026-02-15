'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface SwingAnalysisUploadProps {
  playerId: string
  playerName: string
  teamId: string
  onSuccess?: (analysisId: string) => void
}

export default function SwingAnalysisUpload({
  playerId,
  playerName,
  teamId,
  onSuccess
}: SwingAnalysisUploadProps) {
  const router = useRouter()
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('video/')) {
      setError('Please select a valid video file')
      return
    }

    // Validate file size (max 100MB)
    const maxSize = 100 * 1024 * 1024 // 100MB
    if (file.size > maxSize) {
      setError('Video file is too large. Maximum size is 100MB.')
      return
    }

    setVideoFile(file)
    setError(null)

    // Create preview URL
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }

  const handleUpload = async () => {
    if (!videoFile) {
      setError('Please select a video file')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('player_id', playerId)
      formData.append('team_id', teamId)

      const response = await fetch('/api/swing-analysis', {
        method: 'POST',
        body: formData
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      // Success!
      if (onSuccess) {
        onSuccess(data.analysis_id)
      } else {
        // Navigate to analysis view
        router.push(`/dashboard/swing-analysis/${data.analysis_id}`)
      }

    } catch (err: any) {
      setError(err.message || 'Failed to upload video')
    } finally {
      setUploading(false)
    }
  }

  const handleCancel = () => {
    setVideoFile(null)
    setPreviewUrl(null)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">
          Upload Swing Video for {playerName}
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Record a short video (5-30 seconds) of the player's swing from the side view.
          The AI will analyze mechanics and provide coaching feedback.
        </p>
      </div>

      {!videoFile ? (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
            id="video-upload"
          />
          <label
            htmlFor="video-upload"
            className="cursor-pointer flex flex-col items-center space-y-2"
          >
            <svg
              className="w-12 h-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <span className="text-sm font-medium text-gray-700">
              Click to upload video
            </span>
            <span className="text-xs text-gray-500">
              MP4, MOV up to 100MB
            </span>
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Video Preview */}
          <div className="bg-black rounded-lg overflow-hidden">
            <video
              src={previewUrl || undefined}
              controls
              className="w-full max-h-96"
            />
          </div>

          {/* File Info */}
          <div className="text-sm text-gray-600">
            <p>File: {videoFile.name}</p>
            <p>Size: {(videoFile.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className={`flex-1 py-2 px-4 rounded-lg font-medium text-white ${
                uploading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {uploading ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin h-5 w-5 mr-2"
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
                  Uploading & Processing...
                </span>
              ) : (
                'Analyze Swing'
              )}
            </button>

            <button
              onClick={handleCancel}
              disabled={uploading}
              className="px-4 py-2 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Processing Info */}
      {uploading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            Your video is being uploaded and will be processed in the background.
            This usually takes 30-60 seconds. You'll be redirected to view the
            results when processing is complete.
          </p>
        </div>
      )}
    </div>
  )
}
