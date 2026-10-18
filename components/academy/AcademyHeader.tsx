import Link from 'next/link'
import Image from 'next/image'
import SignOut from './SignOut'

// The Academy's own top bar — the same brand as the marketing site, but none
// of the coach dashboard's team switcher or sidebar: a course buyer may have
// no team at all.
export default function AcademyHeader({ signedIn, inCourse = false }: { signedIn: boolean; inCourse?: boolean }) {
  return (
    <header className="print:hidden sticky top-0 z-40 bg-[#1a202c] border-b border-slate-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/academy" className="flex items-center gap-2 shrink-0" aria-label="BenchCoach Academy home">
          <Image src="/logo.png" alt="BenchCoach" width={140} height={40} className="h-7 w-auto" priority />
          <span className="hidden sm:inline text-sm font-semibold tracking-wide text-red-400 uppercase">Academy</span>
        </Link>
        <nav className="ml-auto flex items-center gap-4 sm:gap-6 text-sm">
          <Link href="/academy" className="text-slate-300 hover:text-white font-medium">Courses</Link>
          {signedIn ? (
            <>
              <Link href="/learn" className={`font-medium ${inCourse ? 'text-white' : 'text-slate-300 hover:text-white'}`}>My courses</Link>
              <SignOut />
            </>
          ) : (
            <>
              <Link href="/" className="hidden sm:inline text-slate-300 hover:text-white font-medium">BenchCoach</Link>
              <Link href="/auth/login?redirect=%2Flearn" className="text-slate-300 hover:text-white font-semibold">Log in</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export function AcademyFooter() {
  return (
    <footer className="print:hidden border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 text-sm text-slate-500 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <p>BenchCoach Academy, from the creator of BenchCoach.</p>
        <div className="flex gap-5">
          <Link href="/academy" className="hover:text-slate-800">Courses</Link>
          <Link href="/" className="hover:text-slate-800">BenchCoach app</Link>
        </div>
      </div>
    </footer>
  )
}
