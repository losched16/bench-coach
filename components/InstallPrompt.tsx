'use client'

import { useEffect, useState } from 'react'
import { X, Download, Share } from 'lucide-react'
import Image from 'next/image'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    // Check if already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsStandalone(true)
      return
    }

    // Check if dismissed recently (within 3 days)
    const dismissed = localStorage.getItem('pwa-dismissed')
    if (dismissed) {
      const dismissedDate = new Date(dismissed)
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      if (dismissedDate > threeDaysAgo) return
    }

    // Detect iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIOS(isIOSDevice)

    // Android/Chrome: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      // Show banner after a short delay so it doesn't feel aggressive
      setTimeout(() => setShowBanner(true), 2000)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS: show our custom banner after delay
    if (isIOSDevice) {
      setTimeout(() => setShowBanner(true), 3000)
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setShowBanner(false)
      }
      setDeferredPrompt(null)
    } else if (isIOS) {
      setShowIOSInstructions(true)
    }
  }

  const handleDismiss = () => {
    setShowBanner(false)
    setShowIOSInstructions(false)
    localStorage.setItem('pwa-dismissed', new Date().toISOString())
  }

  if (isStandalone || !showBanner) return null

  return (
    <>
      {/* Install Banner */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 md:hidden">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 mx-auto max-w-md">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center overflow-hidden">
              <Image src="/icon.png" alt="BenchCoach" width={48} height={48} className="rounded-xl" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 text-sm">Add BenchCoach to Home Screen</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Quick access from your phone — looks and feels like an app!
              </p>
            </div>
            <button onClick={handleDismiss} className="shrink-0 p-1 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleDismiss}
              className="flex-1 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Not now
            </button>
            <button
              onClick={handleInstall}
              className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
            >
              {isIOS ? (
                <>
                  <Share size={14} />
                  Install
                </>
              ) : (
                <>
                  <Download size={14} />
                  Install
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* iOS Instructions Overlay */}
      {showIOSInstructions && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-end md:hidden">
          <div className="bg-white rounded-t-2xl w-full p-6 pb-10 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Add to Home Screen</h3>
              <button onClick={handleDismiss} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold shrink-0">1</div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">Tap the Share button</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    It&apos;s the square with an arrow at the bottom of Safari
                  </p>
                  <div className="mt-2 flex items-center justify-center w-10 h-10 bg-gray-100 rounded-lg">
                    <Share size={20} className="text-blue-600" />
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold shrink-0">2</div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">Scroll down and tap &quot;Add to Home Screen&quot;</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    You may need to scroll right in the share options
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold shrink-0">3</div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">Tap &quot;Add&quot; to confirm</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    BenchCoach will appear on your home screen like a real app!
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="w-full mt-6 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </>
  )
}
