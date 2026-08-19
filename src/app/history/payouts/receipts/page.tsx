'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, translateKey } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import { fetchPayoutBlocks, fetchPayoutMethods, type PayoutBlock, type PayoutMethod } from '@/lib/payout-data'

/**
 * /history/payouts/receipts — los bloques de liquidación ya creados.
 *
 * Cada bloque congela el desglose que se mostró al confirmar. Si mañana cambia
 * el 2.3%, este recibo sigue explicando el número que se pagó, no el que se
 * pagaría hoy — por eso las cifras se leen de la fila y no se recalculan.
 *
 * Un bloque de payout es un registro de liquidación y NO se escribe a la
 * cadena (Spec 02 §4).
 */
export default function PayoutReceiptsPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [blocks, setBlocks] = useState<PayoutBlock[]>([])
  const [methods, setMethods] = useState<PayoutMethod[]>([])

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setSignedIn(false)
        setLoading(false)
        return
      }
      const [rows, allMethods] = await Promise.all([
        fetchPayoutBlocks(user.id),
        // Sin filtrar por país: un bloque viejo puede haber usado un método
        // que hoy ya no se ofrece, y el recibo tiene que seguir nombrándolo.
        fetchPayoutMethods(null),
      ])
      setBlocks(rows)
      setMethods(allMethods)
      setLoading(false)
    })()
  }, [])

  function methodLabel(methodId: string): string {
    const method = methods.find((m) => m.id === methodId)
    // Si el método ya no está en el registro, el id crudo es mejor que un
    // hueco: soporte puede leerlo.
    return method ? translateKey(t, method.displayNameKey, methodId) : methodId
  }

  const statusLabel: Record<PayoutBlock['status'], string> = {
    processing: t.payouts.pending,
    paid: t.payouts.collected,
    failed: t.payouts.pending,
  }

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>

  if (!signedIn) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">
          ← {t.purchase.home}
        </a>
        <p className="text-[14px] mt-6">{t.myCollections.needSignIn}</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6">
      <a href="/history/payouts" className="back-link">
        ← {t.payouts.title}
      </a>
      <h1 className="page-title">{t.payouts.receipts}</h1>

      {blocks.length === 0 ? (
        <p className="py-8 text-center text-[12.5px] leading-[1.7] text-placeholder">
          {t.payouts.empty}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {blocks.map((block) => (
            <div key={block.id} className="border border-hairline rounded-xl p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[11px] tracking-[0.02em] text-ink-soft">
                  {block.blockId}
                </span>
                <span
                  className={`text-[10px] tracking-[0.1em] uppercase ${
                    block.status === 'paid'
                      ? 'text-t-copper'
                      : block.status === 'failed'
                        ? 'text-t-red'
                        : 'text-ink-soft'
                  }`}
                >
                  {block.status === 'failed' ? t.work.errors.buyFailed : statusLabel[block.status]}
                </span>
              </div>

              <div className="mt-1 text-[10px] text-placeholder">
                {new Date(block.createdAt).toLocaleDateString()} · {methodLabel(block.methodId)} ·{' '}
                {block.destinationMasked}
              </div>

              <div className="mt-3 pt-3 border-t border-hairline flex flex-col gap-1.5 text-[11.5px]">
                <Line label={t.payouts.gross} value={block.gross} />
                <Line label={t.payouts.platformFee} value={-block.platformFee} />
                <Line label={t.payouts.methodFee} value={-block.methodFee} />
                <div className="flex items-baseline justify-between pt-1.5 mt-0.5 border-t border-hairline">
                  <span className="text-[10px] tracking-[0.12em] uppercase text-ink-soft">
                    {t.payouts.net}
                  </span>
                  <span className="font-medium text-ink tabular-nums">
                    {money(block.net)} USD
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Una línea del desglose. Los descuentos se escriben con su signo. */
function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-ink-soft">{label}</span>
      <span className="text-ink tabular-nums">
        {value < 0 ? `− ${money(Math.abs(value))}` : money(value)} USD
      </span>
    </div>
  )
}
