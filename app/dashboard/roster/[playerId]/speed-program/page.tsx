'use client'

import { Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { SpeedProgramView } from '@/components/speed-program/SpeedProgramView'

function Inner() {
  const { playerId } = useParams() as { playerId: string }
  const teamId = useSearchParams().get('teamId')
  return <SpeedProgramView playerId={playerId} teamId={teamId} />
}

export default function Page() {
  return <Suspense fallback={<div className="p-6 text-gray-500">Loading…</div>}><Inner /></Suspense>
}
