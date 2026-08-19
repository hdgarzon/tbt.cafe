'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, translateKey } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import { SecBlock } from '@/components/FormBits'
import { DestinationSheet } from '@/components/DestinationSheet'
import {
  fetchEarnings,
  fetchPayoutMethods,
  fetchPayoutCountry,
  fetchDefaultDestination,
  pendingOf,
  sumOf,
  type Earning,
  type PayoutMethod,
  type PayoutDestination,
} from '@/lib/payout-data'

/**
 * /settings/payouts — payoutSettingsPage del prototipo.
 *
 * El Spec 06 §0 la llama "la mayor brecha de los ajustes actuales": los
 * cambios de destino son lo más crítico en seguridad del producto y no tenían
 * dónde vivir.
 *
 * Tres bloques: método por defecto, destino, y lo que todavía se está
 * liquidando. El tercero está aquí y no solo en la pantalla de cobros porque
 * quien viene a mirar dónde le pagan suele venir a preguntar cuándo.
 */
export default function PayoutSettingsPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [methods, setMethods] = useState<PayoutMethod[]>([])
  const [destination, setDestination] = useState<PayoutDestination | null>(null)
  const [pending, setPending] = useState<Earning[]>([])
  const [editing, setEditing] = useState(false)

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setSignedIn(false)
      setLoading(false)
      return
    }
    const country = await fetchPayoutCountry(user.id)
    const [list, saved, earnings] = await Promise.all([
      fetchPayoutMethods(country),
      fetchDefaultDestination(user.id),
      fetchEarnings(user.id),
    ])
    setMethods(list)
    setDestination(saved)
    setPending(pendingOf(earnings))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

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

  const activeMethod = destination
    ? methods.find((m) => m.id === destination.methodId)
    : (methods[0] ?? null)

  // Un registro vacío se dice con todas las letras — nunca un selector vacío
  // ni un método por defecto que va a fallar (Spec 02 §3.3).
  const noMethods = methods.length === 0

  return (
    <>
      <div className="px-4 pt-6">
        <a href="/" className="back-link">
          ← {t.purchase.home}
        </a>
        <h1 className="page-title">{t.payouts.title}</h1>
        <div className="page-sub">{t.payouts.sub}</div>

        <div className="mt-[26px]">
          {noMethods ? (
            <p className="py-6 text-[13px] leading-[1.7] text-ink-soft">{t.payouts.noMethods}</p>
          ) : (
            <>
              <SecBlock
                label={t.payouts.defaultMethod}
                value={
                  activeMethod
                    ? translateKey(t, activeMethod.displayNameKey, activeMethod.id)
                    : '—'
                }
                tag={{
                  label: activeMethod ? translateKey(t, activeMethod.settlementEstimateKey) : t.payouts.notSet,
                  verified: Boolean(destination),
                }}
                action={t.payouts.change}
                onAction={() => setEditing(true)}
                hint={t.payouts.methodHint}
              />

              <SecBlock
                label={t.payouts.destination}
                value={destination?.masked ?? '—'}
                tag={{
                  label: destination ? t.payouts.collected : t.payouts.notSet,
                  verified: Boolean(destination),
                }}
                action={t.payouts.change}
                onAction={() => setEditing(true)}
                hint={t.payouts.destHint}
              />
            </>
          )}

          {/* Todavía liquidándose */}
          <div className="py-[18px] border-b border-hairline">
            <div className="text-[10px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2.5">
              {t.payouts.stillSettling}
            </div>

            {pending.length === 0 ? (
              <p className="text-[12.5px] text-placeholder">{t.payouts.empty}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {pending.map((earning) => (
                  <div key={earning.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="min-w-0 truncate text-ink">
                      {earning.title ?? t.payouts.source[earning.source]}
                    </span>
                    <span className="shrink-0 flex items-baseline gap-2">
                      <span className="text-[10px] text-placeholder">
                        {/* Por qué está retenido y cuándo libera — Spec 01 §4.4. */}
                        {earning.holdReason === 'awaiting_counterparty' || !earning.releasesAt
                          ? t.payouts.holdCounterparty
                          : t.payouts.pendingUntil.replace(
                              '{date}',
                              new Date(earning.releasesAt).toLocaleDateString()
                            )}
                      </span>
                      <span className="text-ink tabular-nums whitespace-nowrap">
                        {money(earning.amount)} USD
                      </span>
                    </span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-hairline text-[12px]">
                  <span className="text-ink-soft">{t.payouts.total}</span>
                  <span className="font-medium text-ink tabular-nums">
                    {money(sumOf(pending))} USD
                  </span>
                </div>
              </div>
            )}

            <p className="text-[11.5px] leading-[1.55] text-ink-soft mt-3">{t.payouts.settleHint}</p>
          </div>
        </div>
      </div>

      <DestinationSheet
        open={editing}
        onClose={() => setEditing(false)}
        methods={methods}
        current={destination}
        onSaved={async () => {
          setEditing(false)
          await load()
        }}
      />
    </>
  )
}
