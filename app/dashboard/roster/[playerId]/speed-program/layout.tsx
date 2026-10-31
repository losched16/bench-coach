import { notFound } from 'next/navigation'
import { speedProgramEnabled } from '@/lib/speedProgram/server'

export const dynamic = 'force-dynamic'

// The program does not exist for anyone until SPEED_PROGRAM=1.
export default function Layout({ children }: { children: React.ReactNode }) {
  if (!speedProgramEnabled()) notFound()
  return <>{children}</>
}
