'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { SignInGate } from '@/components/SignInGate'
import { StandingSheet } from '@/components/Sheet'
import { startConnectOnboarding } from '@/lib/payout-data'
import { ENTITY_TYPES } from '@/lib/seller'
import {
  fetchSelling,
  applyToSell,
  pauseSelling,
  resumeSelling,
  titlesOf,
  type SellingState,
} from '@/lib/selling-data'

/**
 * Settings → Selling — Work Order 02, Stage 2.4.
 *
 * Justo encima de Payouts. Un estado por pantalla, cada uno con su texto del
 * companion Set 4.1: sin solicitar, sin cobertura, en revision, rechazada,
 * aprobada sin cuenta lista, activa (con la via), pausada, suspendida.
 *
 * La solicitud pide solo lo que no se sabe: el pais (sugerido por el telefono,
 * se confirma), el tipo y el acuerdo. La via no se elige: sale del pais.
 */
export default function SellingSettingsPage() {
  const { t, locale } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [state, setState] = useState<SellingState | null>(null)
  const [country, setCountry] = useState('')
  const [entity, setEntity] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [notCovered, setNotCovered] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreList, setRestoreList] = useState<{ id: string; title: string }[]>([])
  const [restorePick, setRestorePick] = useState<string[]>([])
  const [pauseOpen, setPauseOpen] = useState(false)

  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      return null
    }
  }, [locale])
  const nameOf = (code: string) => names?.of(code) ?? code

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setSignedIn(false)
      setLoading(false)
      return
    }
    const r = await fetchSelling()
    if (r.state) {
      setState(r.state)
      setCountry((c) => c || r.state!.seller.country || r.state!.suggestedCountry || '')
    } else {
      setMsg(t.transferAccept.errors.respondFailed)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(p: Promise<{ state?: SellingState; error?: string; country?: string }>) {
    setBusy(true)
    setMsg('')
    const r = await p
    setBusy(false)
    if (r.state) {
      setState(r.state)
      return true
    }
    if (r.error === 'not_covered') setNotCovered(r.country ?? country)
    else setMsg(t.transferAccept.errors.respondFailed)
    return false
  }

  async function openRestore() {
    const ids = state?.seller.remembered_listings ?? []
    const list = await titlesOf(ids)
    setRestoreList(list)
    // Todas preseleccionadas (S-4).
    setRestorePick(list.map((w) => w.id))
    setRestoreOpen(true)
  }

  async function setup() {
    setBusy(true)
    const r = await startConnectOnboarding(state?.seller.country ?? null)
    if (r.url) {
      window.location.href = r.url
      return
    }
    setBusy(false)
    setMsg(t.payouts.connectFailed)
  }

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  if (!signedIn) return <SignInGate message={t.myCollections.needSignIn} />

  const seller = state?.seller
  const status = seller?.status ?? 'not_applied'
  const suspended = !!seller?.suspended_at
  const applyOpen = status === 'not_applied' || status === 'declined'
  const coveredCountry = state?.countries.find((c) => c.country === country)
  const canApply = !!country && !!entity && agree && !busy

  const button =
    'w-full rounded-[10px] bg-ink py-3.5 text-[12px] font-medium tracking-[0.08em] uppercase text-paper transition-opacity disabled:opacity-30'
  const line = 'text-[13px] leading-[1.65] text-ink-soft'

  return (
    <>
      <div className="px-4 pt-6 pb-10">
        <a href="/" className="back-link">
          ← {t.purchase.home}
        </a>
        <h1 className="page-title">{t.menu.selling}</h1>
        <p className={`${line} mt-2`}>{t.selling.intro}</p>

        <div className="mt-6 flex flex-col gap-4">
          {/* Suspendida por tbt.cafe: el motivo y ayuda. Nunca Reanudar. */}
          {suspended && (
            <>
              <p className="text-[13px] leading-[1.65] text-ink">
                {t.selling.suspended.replace('{reason}', seller?.suspended_reason ?? '')}
              </p>
              <a href="/help" className="text-[12px] underline text-ink-soft">
                {t.selling.suspendedHelp}
              </a>
            </>
          )}

          {!suspended && notCovered && (
            <p className="text-[13px] leading-[1.65] text-ink">
              {t.selling.notCovered.replace('{country}', nameOf(notCovered))}
            </p>
          )}

          {!suspended && status === 'pending' && <p className="text-[13px] leading-[1.65] text-ink">{t.selling.pending}</p>}

          {!suspended && status === 'declined' && (
            <p className="text-[13px] leading-[1.65] text-ink">
              {t.selling.declined.replace('{reason}', seller?.declined_reason ?? '')}
            </p>
          )}

          {!suspended && applyOpen && !notCovered && (
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-medium tracking-[0.16em] uppercase text-ink-soft" htmlFor="sell-country">
                {t.selling.applyCountry}
              </label>
              <select
                id="sell-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full border border-hairline rounded-xl px-3.5 py-3 text-[14px] bg-white"
              >
                <option value="" />
                {(state?.countries ?? []).map((c) => (
                  <option key={c.country} value={c.country}>
                    {nameOf(c.country)}
                  </option>
                ))}
              </select>

              <label className="text-[10px] font-medium tracking-[0.16em] uppercase text-ink-soft mt-2" htmlFor="sell-entity">
                {t.selling.applyEntity}
              </label>
              <select
                id="sell-entity"
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                className="w-full border border-hairline rounded-xl px-3.5 py-3 text-[14px] bg-white"
              >
                <option value="" />
                {ENTITY_TYPES.map((e) => (
                  <option key={e} value={e}>
                    {t.selling.entity[e]}
                  </option>
                ))}
              </select>

              <label className="flex items-start gap-2.5 mt-2 text-[13px] text-ink">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
                <span>
                  <a href="/legal/terms" className="underline">
                    {t.selling.applyAgree}
                  </a>
                </span>
              </label>

              <button
                type="button"
                disabled={!canApply}
                onClick={() => {
                  // Un pais sin rail se dice antes de enviar, con lo ganado a salvo.
                  if (coveredCountry && !coveredCountry.covered) return setNotCovered(country)
                  run(applyToSell(country, entity, agree))
                }}
                className={`${button} mt-2`}
              >
                {t.selling.apply}
              </button>
            </div>
          )}

          {/* Aprobada, pero el proveedor aun no dice que la cuenta este lista (2.5). */}
          {!suspended && status === 'active' && !state?.providerReady && (
            <>
              <p className="text-[13px] leading-[1.65] text-ink">{t.selling.setup}</p>
              <button type="button" disabled={busy} onClick={setup} className={button}>
                {t.payouts.connectSetUp}
              </button>
            </>
          )}

          {!suspended && status === 'active' && state?.providerReady && (
            <>
              <p className="text-[13px] leading-[1.65] text-ink">
                {seller?.charge_path === 'direct' ? t.selling.activeDirect : t.selling.activePlatform}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPauseOpen(true)}
                className="self-start rounded-[9px] border border-ink px-4 py-[9px] text-[10px] font-semibold tracking-[0.12em] uppercase text-ink"
              >
                {t.selling.pause}
              </button>
            </>
          )}

          {!suspended && status === 'paused_self' && (
            <>
              <p className="text-[13px] leading-[1.65] text-ink">{t.selling.paused}</p>
              <button type="button" disabled={busy} onClick={openRestore} className={button}>
                {t.selling.resume}
              </button>
            </>
          )}

          {msg && <p className="text-[11.5px] leading-[1.5] text-t-red">{msg}</p>}
        </div>
      </div>

      <StandingSheet
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        head={t.selling.pause}
        footer={
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await run(pauseSelling())) setPauseOpen(false)
            }}
            className={button}
          >
            {t.selling.pause}
          </button>
        }
      >
        <p className={`${line} pb-4`}>{t.selling.pauseConfirm}</p>
      </StandingSheet>

      <StandingSheet
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        head={t.selling.restoreTitle}
        footer={
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await run(resumeSelling(restorePick))) setRestoreOpen(false)
            }}
            className={button}
          >
            {t.selling.resume}
          </button>
        }
      >
        <div className="flex flex-col gap-2 pb-4">
          {restoreList.map((w) => (
            <label key={w.id} className="flex items-center gap-2.5 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={restorePick.indexOf(w.id) !== -1}
                onChange={(e) =>
                  setRestorePick((p) => (e.target.checked ? [...p, w.id] : p.filter((id) => id !== w.id)))
                }
              />
              <span className="truncate">{w.title}</span>
            </label>
          ))}
        </div>
      </StandingSheet>
    </>
  )
}
