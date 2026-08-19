'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, translateKey } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import { StandingSheet } from '@/components/Sheet'
import { BiometricRing } from '@/components/BiometricRing'
import { useBiometricProof } from '@/lib/use-biometric-proof'
import {
  fetchPayoutMethods,
  fetchPayoutCountry,
  fetchDefaultDestination,
  quoteCollection,
  checkLimits,
  maskWallet,
  maskAccount,
  sumOf,
  type Earning,
  type PayoutMethod,
  type PayoutDestination,
} from '@/lib/payout-data'

/**
 * Cobro de un payout — Backend Spec 02 §4.
 *
 * Dos pasos, como el prototipo:
 *
 *   1. Verificar    lo seleccionado, el total, el biométrico y los términos
 *   2. Método       destino del registro, desglose de comisiones, confirmar
 *
 * Los dos factores del §5.1 se reparten entre los pasos: el biométrico en el
 * primero (es lo que desbloquea Continuar) y el código privado al confirmar.
 * Ambos son incondicionales y no dependen del monto.
 *
 * El biométrico NO es un booleano local. Se verifica con WebAuthn contra el
 * servidor, que emite una prueba de un solo uso; esa prueba viaja al cobro y
 * se consume allí. Un `bioConfirmed = true` en el cliente sería una
 * comprobación que el propio cliente se concede.
 */

type Step = 'verify' | 'method' | 'code'

export function CollectSheet({
  open,
  onClose,
  earnings,
  onCollected,
}: {
  open: boolean
  onClose: () => void
  /** Solo las seleccionadas, y todas deben estar en `available`. */
  earnings: Earning[]
  onCollected: (blockId: string) => void
}) {
  const { t } = useLocale()
  const [step, setStep] = useState<Step>('verify')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const bio = useBiometricProof()
  // `reset` es estable (useCallback); el objeto `bio` se recrea en cada render,
  // así que meterlo entero en las dependencias reiniciaría el efecto en bucle.
  const { reset: resetBio } = bio
  const [terms, setTerms] = useState(false)

  const [methods, setMethods] = useState<PayoutMethod[] | null>(null)
  const [activeMethod, setActiveMethod] = useState<PayoutMethod | null>(null)
  const [saved, setSaved] = useState<PayoutDestination | null>(null)

  const [address, setAddress] = useState('')
  const [confirmAddress, setConfirmAddress] = useState('')
  const [code, setCode] = useState('')

  const gross = useMemo(() => sumOf(earnings), [earnings])

  useEffect(() => {
    if (!open) return
    setStep('verify')
    resetBio()
    setTerms(false)
    setAddress('')
    setConfirmAddress('')
    setCode('')
    setMsg('')
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const country = await fetchPayoutCountry(user.id)
      const [list, destination] = await Promise.all([
        fetchPayoutMethods(country),
        fetchDefaultDestination(user.id),
      ])
      setMethods(list)
      setActiveMethod(list[0] ?? null)
      setSaved(destination)
    })()
  }, [open, resetBio])

  /* ── Paso 3: confirmar con el código privado ─────────────────────────── */

  async function submit() {
    if (!activeMethod || busy) return
    setBusy(true)
    setMsg('')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const isWallet = activeMethod.destination.fieldType === 'wallet_address'
      const typed = address.trim()
      const masked = typed
        ? isWallet
          ? maskWallet(typed)
          : maskAccount(typed)
        : (saved?.masked ?? '')

      const response = await fetch('/api/payouts/collect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          biometricProof: bio.proof,
          methodId: activeMethod.id,
          // El completo solo cuando escribió uno nuevo; si reutiliza el
          // guardado, no hay nada que volver a mandar.
          destination: typed || undefined,
          destinationMasked: masked,
          earningIds: earnings.map((e) => e.id),
        }),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (body.error === 'invalid_code') setMsg(t.payouts.wrongCode)
        else if (body.error === 'locked') setMsg(t.payouts.lockedOut)
        else if (body.error === 'biometric_required') {
          // La prueba caducó o ya se gastó: hay que volver a poner el dedo.
          bio.reset()
          setStep('verify')
          setMsg(t.payouts.biometricFailed)
        } else setMsg(t.payouts.collectFailed)
        return
      }

      onCollected(body.blockId)
    } catch {
      setMsg(t.payouts.collectFailed)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const quote = activeMethod ? quoteCollection(gross, activeMethod) : null
  const limits = activeMethod ? checkLimits(gross, activeMethod) : { ok: true as const }
  const isWallet = activeMethod?.destination.fieldType === 'wallet_address'
  const needsConfirm = activeMethod?.destination.requiresConfirm ?? false
  const mismatch = needsConfirm && confirmAddress.length > 0 && address.trim() !== confirmAddress.trim()
  const destinationReady = isWallet
    ? address.trim().length >= 6 && (!needsConfirm || address.trim() === confirmAddress.trim())
    : Boolean(saved) || address.trim().length >= 6

  /* Un registro vacío se dice con todas las letras y se manda a soporte —
     nunca un selector vacío ni un método por defecto que va a fallar (§3.3). */
  if (methods !== null && methods.length === 0) {
    return (
      <StandingSheet open={open} onClose={onClose} head={t.payouts.title}>
        <p className="py-10 text-[13px] leading-[1.7] text-ink-soft">{t.payouts.noMethods}</p>
      </StandingSheet>
    )
  }

  return (
    <StandingSheet
      open={open}
      onClose={onClose}
      head={step === 'verify' ? t.payouts.verifyCollection : t.payouts.collectionMethod}
      footer={
        step === 'verify' ? (
          <button
            type="button"
            disabled={!bio.proof || !terms}
            onClick={() => setStep('method')}
            className="w-full rounded-[10px] bg-ink py-3.5 text-[12px] font-medium tracking-[0.08em] uppercase text-paper transition-opacity disabled:opacity-30 disabled:cursor-default"
          >
            {t.payouts.continue}
          </button>
        ) : step === 'method' ? (
          <button
            type="button"
            disabled={!destinationReady || !limits.ok || !quote}
            onClick={() => setStep('code')}
            className="w-full rounded-[10px] bg-t-green py-3.5 text-[12px] font-medium tracking-[0.08em] uppercase text-paper transition-opacity disabled:opacity-30 disabled:cursor-default"
          >
            {t.payouts.collectAmount.replace('{amount}', money(quote?.net ?? 0))}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || code.length < 3}
            onClick={submit}
            className="w-full rounded-[10px] bg-t-green py-3.5 text-[12px] font-medium tracking-[0.08em] uppercase text-paper transition-opacity disabled:opacity-30 disabled:cursor-default"
          >
            {t.payouts.confirm}
          </button>
        )
      }
    >
      {/* ── Paso 1 ──────────────────────────────────────────────────────── */}
      {step === 'verify' && (
        <div>
          <div className="mb-4">
            {earnings.map((earning) => (
              <div
                key={earning.id}
                className="flex items-center justify-between py-2.5 border-b border-hairline last:border-b-0 text-[12px]"
              >
                <div>
                  <span className="font-medium text-ink">
                    {earning.title ?? t.payouts.source[earning.source]}
                  </span>
                  <div className="text-[10.5px] text-ink-soft">
                    {t.payouts.source[earning.source]}
                  </div>
                </div>
                <span className="text-ink whitespace-nowrap tabular-nums">
                  {money(earning.amount)} USD
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-hairline pt-3">
            <div className="flex justify-between text-[11px] text-ink-soft py-1">
              <span>{t.payouts.total}</span>
              <span className="text-ink font-medium tabular-nums">{money(gross)} USD</span>
            </div>
          </div>

          <BiometricRing
            confirmed={Boolean(bio.proof)}
            busy={bio.busy}
            onPress={bio.request}
            hint={bio.proof ? t.payouts.identityConfirmed : t.payouts.touchToConfirm}
          />

          {bio.error && (
            <p className="text-[10.5px] text-t-red text-center -mt-1">
              {bio.error === 'no_credentials' ? t.payouts.noBiometric : t.payouts.biometricFailed}
            </p>
          )}

          <label className="flex items-center gap-2 mt-4 text-[11px] text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="w-4 h-4 shrink-0 accent-t-green cursor-pointer"
            />
            {t.payouts.agreeTerms}
          </label>

          {msg && <p className="text-[10.5px] text-t-red mt-3">{msg}</p>}
        </div>
      )}

      {/* ── Paso 2 ──────────────────────────────────────────────────────── */}
      {step === 'method' && methods && (
        <div>
          <div className="flex border border-hairline rounded-[10px] overflow-hidden mb-4">
            {methods.map((method) => (
              <button
                key={method.id}
                type="button"
                onClick={() => setActiveMethod(method)}
                className={`flex-1 py-2.5 px-2.5 text-[11px] font-medium transition-colors border-r border-hairline last:border-r-0 ${
                  activeMethod?.id === method.id
                    ? 'bg-paper-warm text-ink'
                    : 'bg-paper text-ink-soft hover:text-ink'
                }`}
              >
                {translateKey(t, method.displayNameKey, method.id)}
              </button>
            ))}
          </div>

          {isWallet ? (
            <>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={translateKey(t, activeMethod!.destination.labelKey)}
                className="w-full rounded-[10px] border border-hairline bg-paper px-3.5 py-3 text-[13px] text-ink outline-none focus:border-ink transition-colors"
              />
              {needsConfirm && (
                <input
                  type="text"
                  value={confirmAddress}
                  onChange={(e) => setConfirmAddress(e.target.value)}
                  placeholder={t.payouts.confirmAddress}
                  className="w-full mt-2 rounded-[10px] border border-hairline bg-paper px-3.5 py-3 text-[13px] text-ink outline-none focus:border-ink transition-colors"
                />
              )}
              <div className="min-h-4 mt-1 text-[10.5px] text-t-red">
                {mismatch ? t.payouts.addressMismatch : ''}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 rounded-[10px] border border-hairline bg-paper-warm p-3.5">
              <div className="w-6 h-6 shrink-0 rounded-full bg-t-green text-paper flex items-center justify-center text-[13px]">
                ✓
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-ink">{t.payouts.bankOnFile}</div>
                <div className="text-[11px] text-ink-soft mt-0.5">
                  {saved?.masked ?? '—'} · {t.payouts.heldByConnect}
                </div>
              </div>
            </div>
          )}

          {quote && (
            <div className="border-t border-hairline pt-2.5 mt-2">
              <Row label={t.payouts.grossPayout} value={money(quote.gross)} />
              <Row label={t.payouts.payoutFee} value={`− ${money(quote.payoutFee)}`} />
              <Row label={t.payouts.methodFee} value={`− ${money(quote.methodFee)}`} />
              <div className="flex justify-between pt-2.5 mt-1.5 border-t border-ink text-[13px] font-medium text-t-green">
                <span>{t.payouts.netPayout}</span>
                <span className="tabular-nums">{money(quote.net)} USD</span>
              </div>
            </div>
          )}

          {!limits.ok && (
            <p className="text-[10.5px] text-t-red mt-3">
              {limits.reason === 'below_min'
                ? `${t.payouts.netPayout}: ${money(limits.limit)} USD`
                : `${t.payouts.netPayout}: ${money(limits.limit)} USD`}
            </p>
          )}

          <p className="text-[10.5px] text-placeholder mt-4 leading-[1.6]">
            {translateKey(t, activeMethod?.settlementEstimateKey ?? '')}
          </p>
        </div>
      )}

      {/* ── Paso 3 ──────────────────────────────────────────────────────── */}
      {step === 'code' && (
        <div className="pt-2">
          <label
            htmlFor="collect-code"
            className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft"
          >
            {t.payouts.enterCode}
          </label>
          <input
            id="collect-code"
            type="password"
            inputMode="text"
            autoComplete="off"
            maxLength={5}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-xl border border-hairline bg-paper px-3.5 py-4 text-[22px] font-medium tracking-[0.42em] text-center text-ink outline-none focus:border-ink transition-colors"
          />
          <p className="text-[11px] leading-[1.6] text-ink-soft mt-3">{t.payouts.codeHint}</p>
          {msg && <p className="text-[11px] text-t-red mt-3">{msg}</p>}
        </div>
      )}
    </StandingSheet>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-[5px] text-[11px] text-ink-soft">
      <span>{label}</span>
      <span className="tabular-nums">{value} USD</span>
    </div>
  )
}
