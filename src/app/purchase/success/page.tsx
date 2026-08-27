'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * /purchase/success — a donde Stripe redirige tras el pago de una compra
 * iniciada por el comprador (create-purchase en el backend existente
 * construye esta URL con transferId + workId ya embebidos).
 *
 * Llama complete-transfer (cross-origin, Bearer token) para terminar de
 * mover la propiedad, generar el nuevo código de transferencia y actualizar
 * el NFT on-chain — el mismo endpoint que usa /transferir, ahora también
 * autorizado para el comprador (to_owner_id), no solo el vendedor.
 *
 * useSearchParams() exige un límite de Suspense en el App Router; se aísla
 * en un componente interno para no forzar a toda la página a client-only.
 */
type State = 'working' | 'done' | 'error'

function PurchaseSuccessContent() {
  const { t } = useLocale()
  const params = useSearchParams()
  const [state, setState] = useState<State>('working')
  const [error, setError] = useState('')
  const [workTitle, setWorkTitle] = useState('')

  useEffect(() => {
    const transferId = params.get('transferId')
    const sessionId = params.get('session_id')

    if (!transferId) {
      setState('error')
      setError(t.purchase.missingTransferId)
      return
    }

    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error(t.purchase.errors.sessionExpired)

        const res = await fetch('/api/complete-transfer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ transferId, sessionId }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? t.purchase.errors.completeFailed)

        setWorkTitle(body.workTitle ?? '')
        setState('done')
      } catch (e) {
        setError(e instanceof Error ? e.message : t.purchase.errors.completeFailed)
        setState('error')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  return (
    <>
      {state === 'working' && (
        <p className="text-[13px] text-ink-soft">{t.purchase.successWorking}</p>
      )}
      {state === 'done' && (
        <>
          <div className="w-14 h-14 mx-auto mb-5 rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13.5l5 5L21 7.5" />
            </svg>
          </div>
          <p className="font-display font-medium text-[28px] leading-[1.08] text-ink">{t.purchase.successDone}</p>
          {workTitle && <p className="text-[13px] text-ink-soft mt-2">{workTitle}</p>}
          <a href="/" className="back-link mt-8">← {t.purchase.home}</a>
        </>
      )}
      {state === 'error' && (
        <>
          <p className="text-[13px] text-t-red">{error}</p>
          <a href="/" className="back-link mt-6">← {t.purchase.home}</a>
        </>
      )}
    </>
  )
}

export default function PurchaseSuccessPage() {
  const { t } = useLocale()
  return (
    <div className="px-4 pt-16 pb-10 flex flex-col items-center text-center">
      <Suspense fallback={<p className="text-[13px] text-ink-soft">{t.authHub.loading}</p>}>
        <PurchaseSuccessContent />
      </Suspense>
    </div>
  )
}
