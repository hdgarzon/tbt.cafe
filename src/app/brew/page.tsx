'use client'

import { Suspense } from 'react'
import { BrewWizard } from '@/components/brew/BrewWizard'

export default function Page() {
  return (
    <Suspense fallback={<div className="px-4 pt-8 text-[13px] text-ink-soft text-center">…</div>}>
      <BrewWizard />
    </Suspense>
  )
}
