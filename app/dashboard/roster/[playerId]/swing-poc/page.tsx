import { notFound } from 'next/navigation'
import { swingPocEnabled } from '@/lib/swingPoc/rules'
import SwingPocWorkspace from '@/components/swingPoc/SwingPocWorkspace'

// Internal swing-mechanics proof of concept. Does not exist unless the server
// has SWING_MECHANICS_POC=1 — there is no link to it anywhere in the app.
export const dynamic = 'force-dynamic'

export default function SwingPocPage({ params }: { params: { playerId: string } }) {
  if (!swingPocEnabled()) notFound()
  return <SwingPocWorkspace playerId={params.playerId} />
}
