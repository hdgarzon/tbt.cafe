'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, translateKey } from '@/i18n/LocaleProvider'
import { StandingSheet } from '@/components/Sheet'
import { useBiometricProof } from '@/lib/use-biometric-proof'
import { BiometricRing } from '@/components/BiometricRing'
import { maskWallet, maskAccount, type PayoutMethod, type PayoutDestination } from '@/lib/payout-data'

/**
 * Cambio del destino de payout — Spec 06 §4.1, y Spec 01 §5.1.
 *
 * "Incondicional, sin umbral": biométrico + código privado siempre. Redirigir
 * el destino se lleva todo lo que esa persona cobre desde ese momento sin
 * tocar una sola venta, así que no hay monto que lo exima.
 *
 * Va en `StandingSheet` y no en el sheet compacto: no pide identidad, pide una
 * decisión de dinero.
 */
export function DestinationSheet({
  open,
  onClose,
  methods,
  current,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  methods: PayoutMethod[]
  current: PayoutDestination | null
  onSaved: () => void
}) {
  const { t } = useLocale()
  const bio = useBiometricProof()
  // `reset` es estable (useCallback); el objeto `bio` se recrea en cada render,
  // así que meterlo entero en las dependencias reiniciaría el efecto en bucle.
  const { reset: resetBio } = bio
  const [method, setMethod] = useState<PayoutMethod | null>(null)
  const [address, setAddress] = useState('')
  const [confirmAddress, setConfirmAddress] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setMethod(methods.find((m) => m.id === current?.methodId) ?? methods[0] ?? null)
    setAddress('')
    setConfirmAddress('')
    setCode('')
    setMsg('')
    resetBio()
  }, [open, methods, current, resetBio])

  const needsConfirm = method?.destination.requiresConfirm ?? false
  const isWallet = method?.destination.fieldType === 'wallet_address'
  const typed = address.trim()
  const mismatch = needsConfirm && confirmAddress.length > 0 && typed !== confirmAddress.trim()
  const addressReady = typed.length >= 6 && (!needsConfirm || typed === confirmAddress.trim())
  const ready = Boolean(method) && addressReady && Boolean(bio.proof) && code.length >= 3

  async function save() {
    if (!method || !ready || busy) return
    setBusy(true)
    setMsg('')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const response = await fetch('/api/payouts/destination', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          biometricProof: bio.proof,
          methodId: method.id,
          destination: typed,
          destinationMasked: isWallet ? maskWallet(typed) : maskAccount(typed),
          network: method.destination.network ?? undefined,
        }),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (body.error === 'invalid_code') setMsg(t.payouts.wrongCode)
        else if (body.error === 'locked') setMsg(t.payouts.lockedOut)
        else if (body.error === 'biometric_required') {
          // La prueba caducó o ya se gastó: hay que volver a poner el dedo.
          bio.reset()
          setMsg(t.payouts.biometricFailed)
        } else setMsg(t.payouts.collectFailed)
        return
      }

      onSaved()
    } catch {
      setMsg(t.payouts.collectFailed)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <StandingSheet
      open={open}
      onClose={onClose}
      head={t.payouts.destination}
      footer={
        <button
          type="button"
          disabled={!ready || busy}
          onClick={save}
          className="w-full rounded-[10px] bg-ink py-3.5 text-[12px] font-medium tracking-[0.08em] uppercase text-paper transition-opacity disabled:opacity-30 disabled:cursor-default"
        >
          {t.payouts.confirm}
        </button>
      }
    >
      <div className="pb-4">
        <p className="text-[11.5px] leading-[1.55] text-ink-soft mb-4">{t.payouts.destHint}</p>

        {methods.length > 1 && (
          <div className="flex border border-hairline rounded-[10px] overflow-hidden mb-4">
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m)}
                className={`flex-1 py-2.5 px-2.5 text-[11px] font-medium transition-colors border-r border-hairline last:border-r-0 ${
                  method?.id === m.id
                    ? 'bg-paper-warm text-ink'
                    : 'bg-paper text-ink-soft hover:text-ink'
                }`}
              >
                {translateKey(t, m.displayNameKey, m.id)}
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={method ? translateKey(t, method.destination.labelKey) : ''}
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

        <BiometricRing
          confirmed={Boolean(bio.proof)}
          busy={bio.busy}
          onPress={bio.request}
          hint={bio.proof ? t.payouts.identityConfirmed : t.payouts.touchToConfirm}
        />

        {bio.error && (
          <p className="text-[10.5px] text-t-red text-center -mt-1 mb-3">
            {bio.error === 'no_credentials' ? t.payouts.noBiometric : t.payouts.biometricFailed}
          </p>
        )}

        <label
          htmlFor="dest-code"
          className="block mb-[9px] mt-2 text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft"
        >
          {t.payouts.enterCode}
        </label>
        <input
          id="dest-code"
          type="password"
          inputMode="text"
          autoComplete="off"
          maxLength={5}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-xl border border-hairline bg-paper px-3.5 py-4 text-[22px] font-medium tracking-[0.42em] text-center text-ink outline-none focus:border-ink transition-colors"
        />

        {msg && <p className="text-[11px] text-t-red mt-3">{msg}</p>}
      </div>
    </StandingSheet>
  )
}
