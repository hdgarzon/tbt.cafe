'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * La confirmacion de una compra — Work Order 02, 0.9a.
 *
 * El titulo se emitio, el registro se escribio y la propiedad paso a quien
 * compro. Un solo acuse, «Entendido», con su hora; sin opcion de rechazo. Un
 * problema va a una solicitud de ayuda.
 */
function Confirmed() {
  const { t } = useLocale()
  const params = useSearchParams()
  const transferId = params.get('transferId')
  const [title, setTitle] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!transferId) return
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`/api/purchase/status?transferId=${encodeURIComponent(transferId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) setTitle(body.title ?? '')
    })()
  }, [transferId])

  async function acknowledge() {
    if (!transferId) return
    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      await fetch('/api/purchase/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ transferId }),
      })
    }
    setBusy(false)
    setDone(true)
  }

  return (
    <div className="max-w-[380px] mx-auto">
      <p className="font-display font-medium text-[28px] leading-[1.08] text-ink">{t.purchase.confirmTitle}</p>
      <p className="text-[13px] leading-[1.6] text-ink-soft mt-3">{t.purchase.confirmBody.replace('{title}', title)}</p>
      {!done ? (
        <button
          type="button"
          onClick={acknowledge}
          disabled={busy || !transferId}
          className="mt-6 w-full rounded-xl bg-ink text-paper py-3 text-[13px] font-medium disabled:opacity-50"
        >
          {t.purchase.confirmOk}
        </button>
      ) : (
        <a href="/" className="back-link mt-6 inline-block">← {t.purchase.home}</a>
      )}
      <a href="/help" className="block mt-4 text-[11.5px] underline text-ink-soft">
        {t.purchase.confirmHelp}
      </a>
    </div>
  )
}

export default function PurchaseConfirmedPage() {
  const { t } = useLocale()
  return (
    <div className="px-4 pt-16 pb-10 text-center">
      <Suspense fallback={<p className="text-[13px] text-ink-soft">{t.authHub.loading}</p>}>
        <Confirmed />
      </Suspense>
    </div>
  )
}
