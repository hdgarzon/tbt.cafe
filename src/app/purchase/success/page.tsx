'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * /purchase/success — el retorno de Stripe despues de una compra.
 *
 * Solo pregunta el estado (Work Order 02, 0.7b): la venta la completa el
 * webhook con completeSale, se quede o no el comprador en esta pagina. Cuando
 * consta, lleva a la confirmacion con su «Entendido» (0.9a).
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

  const [transferId, setTransferId] = useState<string | null>(null)

  /*
   * Solo pregunta (Work Order 02, 0.7b). La venta la completa el webhook; esta
   * pagina espera a que conste y nunca completa nada. Un comprador que cierra
   * la pestana ya es dueno: el webhook no depende de que vuelva.
   */
  useEffect(() => {
    const id = params.get('transferId')
    if (!id) {
      setState('error')
      setError(t.purchase.missingTransferId)
      return
    }
    setTransferId(id)
    let tries = 0
    let stopped = false

    const check = async () => {
      if (stopped) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error(t.purchase.errors.sessionExpired)
        const res = await fetch(`/api/purchase/status?transferId=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? t.purchase.errors.completeFailed)
        if (body.status === 'completed') {
          setWorkTitle(body.title ?? '')
          setState('done')
          return
        }
        // Unos dos minutos; despues, la revision la dice el aviso, no esta pagina.
        if (++tries >= 40) {
          setError(t.purchase.review)
          setState('error')
          return
        }
        setTimeout(check, 3000)
      } catch (e) {
        setError(e instanceof Error ? e.message : t.purchase.errors.completeFailed)
        setState('error')
      }
    }
    check()
    return () => {
      stopped = true
    }
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
          {transferId && (
            <a href={`/purchase/confirmed?transferId=${transferId}`} className="back-link mt-8">
              {t.purchase.confirmTitle} →
            </a>
          )}
          <a href="/" className="back-link mt-4">← {t.purchase.home}</a>
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
