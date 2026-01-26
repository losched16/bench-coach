'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface FAQ {
  question: string
  answer: string
}

interface SeoPageFAQProps {
  faqs: FAQ[]
}

export function SeoPageFAQ({ faqs }: SeoPageFAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0) // First one open by default

  return (
    <div className="my-12 border-t border-gray-200 pt-12">
      <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">
        Frequently Asked Questions
      </h2>
      <div className="space-y-3">
        {faqs.map((faq, index) => (
          <div
            key={index}
            className="border border-gray-200 rounded-lg overflow-hidden"
          >
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-gray-900 pr-4">
                {faq.question}
              </span>
              {openIndex === index ? (
                <ChevronUp className="text-gray-500 flex-shrink-0" size={20} />
              ) : (
                <ChevronDown className="text-gray-500 flex-shrink-0" size={20} />
              )}
            </button>
            {openIndex === index && (
              <div className="px-4 sm:px-5 pb-4 sm:pb-5 text-gray-700 leading-relaxed border-t border-gray-100 pt-4">
                {faq.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
