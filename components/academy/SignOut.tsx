'use client'
import { useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
export default function SignOut() {
  const router = useRouter()
  return (
    <button onClick={async () => { await createSupabaseComponentClient().auth.signOut(); router.push('/academy'); router.refresh() }}
      className="text-slate-300 hover:text-white text-sm font-medium">Sign out</button>
  )
}
