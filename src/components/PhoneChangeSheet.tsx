'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Sheet, SheetButton, FieldLabel } from '@/components/Sheet'
import { PhonePicker } from '@/components/PhonePicker'
import { BiometricRing } from '@/components/BiometricRing'
import { useBiometricProof } from '@/lib/use-biometric-proof'

/**
 * Cambiar el numero — Work Order 02, Stage 10.2.
 *
 * Codigo privado, biometrico y un codigo al numero nuevo. Sin factores, lleva a
 * una solicitud de ayuda. Todo lo decide /api/phone/change; esto pide lo que la
 * ruta va a pedir, en su orden.
 */
export function PhoneChangeSheet({
  open,
  onClose,
  onChanged,
  hasFactors,
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
  /** Codigo privado y biometrico puestos. Sin ellos no hay cambio en linea. */
  hasFactors: boolean
}) {
  const { t, locale } = useLocale()
  const bio = useBiometricProof()
  const { reset: resetBio } = bio
  const [step, setStep] = useState<'details' | 'otp' | 'done'>('details')
  const [phone, setPhone] = useState('')
  const [digits, setDigits] = useState('')
  const [code, setCode] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setStep('details')
    setPhone('')
    setDigits('')
    setCode('')
    setOtp('')
    setMsg('')
    resetBio()
  }, [open, resetBio])

  async function call(body: Record<string, unknown>) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return { ok: false, json: { error: 'not_authenticated' } }
    const res = await fetch('/api/phone/change', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, json: await res.json().catch(() => ({})) }
  }

  async function begin() {
    setBusy(true)
    setMsg('')
    const r = await call({ action: 'begin', newPhone: phone, code, biometricProof: bio.proof })
    setBusy(false)
    if (r.ok) return setStep('otp')
    if (r.json.error === 'rate_limited') {
      return setMsg(t.phone.rateLimited.replace('{date}', new Date(r.json.nextAt).toLocaleDateString(locale)))
    }
    if (r.json.error === 'invalid_code') setMsg(t.payouts.wrongCode)
    else if (r.json.error === 'biometric_required') {
      resetBio()
      setMsg(t.payouts.biometricFailed)
    } else setMsg(t.transferAccept.errors.respondFailed)
  }

  async function verify() {
    setBusy(true)
    setMsg('')
    const r = await call({ action: 'verify', newPhone: phone, otp })
    setBusy(false)
    if (r.ok) {
      setStep('done')
      return onChanged()
    }
    setMsg(t.transferAccept.errors.respondFailed)
  }

  const input =
    'w-full border border-hairline rounded-xl outline-none px-3.5 py-[13px] text-[15px] text-ink focus:border-ink transition-colors'

  return (
    <Sheet open={open} onClose={onClose} kicker={t.authHub.asSub} title={t.phone.change}>
      {!hasFactors ? (
        <p className="text-[13px] leading-[1.6] text-ink">
          {t.phone.noFactor}{' '}
          <a href="/help" className="underline">
            {t.selling.suspendedHelp}
          </a>
        </p>
      ) : step === 'done' ? (
        <p className="text-[13px] leading-[1.6] text-ink">{t.phone.changed}</p>
      ) : step === 'otp' ? (
        <div>
          <p className="text-[12.5px] leading-[1.6] text-ink-soft">
            {t.auth.codeSentTo} {phone}
          </p>
          <div className="mt-[18px]">
            <FieldLabel htmlFor="otp">{t.auth.codeLabel}</FieldLabel>
            <input id="otp" inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))} className={input} />
          </div>
          {msg && <p className="text-[11.5px] text-t-red mt-3">{msg}</p>}
          <SheetButton onClick={verify} disabled={busy || otp.length < 4}>
            {t.auth.verify}
          </SheetButton>
        </div>
      ) : (
        <div>
          <p className="text-[12.5px] leading-[1.6] text-ink-soft">{t.phone.changeNote}</p>
          <div className="mt-[18px]">
            <FieldLabel htmlFor="new-phone">{t.auth.phoneLabel}</FieldLabel>
            <PhonePicker id="new-phone" value={digits} onChange={(e164, d) => { setPhone(e164); setDigits(d) }} placeholder={t.auth.phonePlaceholder} />
          </div>
          <div className="mt-[18px]">
            <FieldLabel htmlFor="pc-phone">{t.payouts.enterCode}</FieldLabel>
            <input id="pc-phone" type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} className={input} />
          </div>
          <BiometricRing
            confirmed={Boolean(bio.proof)}
            busy={bio.busy}
            onPress={bio.request}
            hint={bio.proof ? t.payouts.identityConfirmed : t.payouts.touchToConfirm}
          />
          {msg && <p className="text-[11.5px] text-t-red mt-3">{msg}</p>}
          <SheetButton onClick={begin} disabled={busy || !phone || !code || !bio.proof}>
            {t.auth.sendCode}
          </SheetButton>
        </div>
      )}
    </Sheet>
  )
}
