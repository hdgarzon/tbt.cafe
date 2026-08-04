'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { maskEmail, maskPhoneE164 } from '@/lib/masking'
import { PrivateCodeSheet } from '@/components/PrivateCodeSheet'
import { RecoveryEmailSheet } from '@/components/RecoveryEmailSheet'
import { BiometricSheet } from '@/components/BiometricSheet'

/**
 * Hub de autenticación — Master Handoff §8.
 * Cuatro secciones: teléfono · email de recuperación · código privado · biométrico.
 * Página dedicada, visible solo con sesión iniciada.
 */

type Profile = {
  recovery_email: string | null
  recovery_email_verified: boolean
  private_code_hash: string | null
  private_code_freq: string | null
}

export default function AuthHubPage() {
  const { t } = useLocale()
  const { openMenu } = useShell()
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioCount, setBioCount] = useState(0)
  const [sheet, setSheet] = useState<null | 'code' | 'email' | 'bio'>(null)

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }
    setPhone(user.phone ?? null)

    const { data } = await supabase
      .from('profiles')
      .select('recovery_email, recovery_email_verified, private_code_hash, private_code_freq')
      .eq('id', user.id)
      .single()

    setProfile(data as Profile | null)

    // Dispositivos biométricos registrados (RLS: solo los propios)
    const { count } = await supabase
      .from('webauthn_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    setBioCount(count ?? 0)

    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  /**
   * Gating de disponibilidad (companion doc §2): la fila de biométrico se
   * OCULTA si el dispositivo no tiene autenticador de plataforma. Nunca
   * mostrar un botón que el dispositivo no puede cumplir.
   */
  useEffect(() => {
    if (typeof PublicKeyCredential === 'undefined') return
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setBioAvailable)
      .catch(() => setBioAvailable(false))
  }, [])

  if (loading) {
    return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  }

  if (!phone) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">← {t.purchase.home}</a>
        <p className="text-[14px] mt-6">{t.authHub.needSignIn}</p>
      </div>
    )
  }

  const hasCode = !!profile?.private_code_hash
  const emailVerified = !!profile?.recovery_email_verified

  return (
    <div className="px-4 pt-6">
      <button type="button" onClick={openMenu} className="back-link">← {t.profile.backSettings}</button>
      <h1 className="page-title">{t.authHub.asTitle}</h1>
      <div className="page-sub">{t.authHub.asSub}</div>

      <div className="mt-2">
        {/* 1 · Teléfono móvil */}
        <SecBlock
          label={t.authHub.mobilePhone}
          value={maskPhoneE164(phone)}
          tag={{ label: t.authHub.tagVerified, verified: true }}
          action={t.authHub.change}
          onAction={() => alert('Change-number flow: pendiente de diseño (Master Handoff §16)')}
        />

        {/* 2 · Email de recuperación */}
        <SecBlock
          label={t.authHub.recoveryEmail}
          value={profile?.recovery_email ? maskEmail(profile.recovery_email) : '—'}
          tag={
            profile?.recovery_email && emailVerified
              ? { label: t.authHub.tagVerified, verified: true }
              : { label: profile?.recovery_email ? t.authHub.unverified : t.authHub.tagNotSet, verified: false }
          }
          action={profile?.recovery_email ? t.authHub.change : t.authHub.add}
          onAction={() => setSheet('email')}
          hint={t.authHub.recoveryHint}
        />

        {/* 3 · Código privado */}
        <SecBlock
          label={t.authHub.privateCode}
          value={hasCode ? '•••' : '—'}
          tag={
            hasCode
              ? {
                  label: `${t.authHub.tagOn} · ${profile?.private_code_freq === 'always' ? t.authHub.always : t.authHub.occasional}`,
                  verified: true,
                }
              : { label: t.authHub.tagOff, verified: false }
          }
          action={hasCode ? t.authHub.change : t.authHub.setUp}
          onAction={() => setSheet('code')}
          hint={t.authHub.privateCodeHint}
        />

        {/* 4 · Biométrico — oculto si el dispositivo no lo soporta */}
        {bioAvailable && (
          <SecBlock
            label={t.authHub.biometricSignIn}
            value={
              bioCount > 0
                ? (bioCount > 1 ? t.authHub.activeDevicesPlural : t.authHub.activeDevices).replace(
                    '{n}',
                    String(bioCount)
                  )
                : '—'
            }
            tag={bioCount > 0 ? { label: t.authHub.tagOn, verified: true } : { label: t.authHub.tagOff, verified: false }}
            action={bioCount > 0 ? t.authHub.addDevice : t.authHub.setUp}
            onAction={() => setSheet('bio')}
            hint={t.authHub.biometricHint}
          />
        )}
      </div>

      <PrivateCodeSheet
        open={sheet === 'code'}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null)
          load()
        }}
        emailVerified={emailVerified}
      />

      <RecoveryEmailSheet
        open={sheet === 'email'}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null)
          load()
        }}
      />

      <BiometricSheet
        open={sheet === 'bio'}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null)
          load()
        }}
      />
    </div>
  )
}

/** Fila sec-block del prototipo — label versalitas, valor grande, tag pill, acción a la derecha. */
function SecBlock({
  label,
  value,
  tag,
  action,
  onAction,
  hint,
}: {
  label: string
  value: string
  tag: { label: string; verified: boolean }
  action: string
  onAction: () => void
  hint?: string
}) {
  return (
    <div className="py-[18px] border-b border-hairline first:pt-1">
      <div className="flex items-start justify-between gap-3.5">
        <div className="min-w-0">
          <div className="text-[10px] font-medium tracking-[0.16em] uppercase text-ink-soft">{label}</div>
          <div className="text-[16px] text-ink mt-[7px] tracking-[0.04em] truncate">{value}</div>
          <span
            className={`inline-block mt-[9px] text-[9px] font-semibold tracking-[0.12em] uppercase px-2 py-[3px] rounded-full border ${
              tag.verified ? 'text-t-green border-t-green' : 'text-ink-soft border-hairline'
            }`}
          >
            {tag.label}
          </span>
        </div>
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 mt-0.5 rounded-[9px] border border-ink px-4 py-[9px] text-[10px] font-semibold tracking-[0.12em] uppercase text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          {action}
        </button>
      </div>
      {hint && <p className="text-[11.5px] leading-[1.55] text-ink-soft mt-3">{hint}</p>}
    </div>
  )
}
