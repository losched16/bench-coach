'use client'
import { Printer } from 'lucide-react'
export default function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="print:hidden inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" data-testid="print">
      <Printer size={16} /> {label}
    </button>
  )
}
