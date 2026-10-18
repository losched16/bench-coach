'use client'
import Link from 'next/link'
import { track } from './Track'
export default function CtaLink({ href, course, children, className }: { href: string; course: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={className} onClick={() => track('software_cta_clicked', course)} data-testid="software-cta">{children}</Link>
}
