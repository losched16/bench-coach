// Writes the Charlie draft's save payload to a file, for the SQL migration test.
import { writeFileSync } from 'fs'
import { buildBrief } from '@/lib/programs/brief'
import { generateProgram } from '@/lib/programs/generate'
import { toSavePayload } from '@/lib/programs/store'
import { CHARLIE_MESSAGE, CHARLIE_EVIDENCE } from './fixtures/charlie'
import { DRILL_POOL } from './fixtures/drill-pool'

async function main() {
  const out = process.argv[2]
  const { brief } = buildBrief({ message: CHARLIE_MESSAGE, playerId: '00000000-0000-0000-0000-0000000000c1', playerName: 'Charlie', age: 9, positions: ['OF', 'P'], today: '2026-11-08' })
  const draft = await generateProgram({ brief: brief!, evidence: CHARLIE_EVIDENCE, pool: process.env.WITH_LIBRARY ? DRILL_POOL : [] })
  writeFileSync(out, JSON.stringify(toSavePayload(draft)))
  // Optionally also the raw draft, for the browser test's mock API.
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(draft))
}
main()
