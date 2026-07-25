'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
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
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioCount, setBioCount] = useState(0)
  const [sheet, setSheet] = useState<null | 'code' | 'email' | 'bio'>(null)

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
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
    return <div className="flex-1 px-5 py-8 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  }

  if (!phone) {
    return (
      <div className="flex-1 px-5 py-8">
        <a href="/" className="label-caps hover:text-ink">← {t.purchase.home}</a>
        <p className="text-[14px] mt-6">
          {t.authHub.needSignIn}
        </p>
      </div>
    )
  }

  const hasCode = !!profile?.private_code_hash
  const emailVerified = !!profile?.recovery_email_verified

  return (
    <div className="flex-1 flex flex-col">
      <div className="h-header flex items-center px-5 border-b border-hairline">
        <a href="/" className="label-caps hover:text-ink">← {t.menu.authentication}</a>
      </div>

      <div className="flex flex-col">
        {/* 1 · Teléfono móvil */}
        <Row
          title={t.authHub.mobilePhone}
          value={maskPhoneE164(phone)}
          action={t.authHub.change}
          onAction={() => alert('Change-number flow: pendiente de diseño (Master Handoff §16)')}
        />

        {/* 2 · Email de recuperación */}
        <Row
          title={t.authHub.recoveryEmail}
          value={
            profile?.recovery_email
              ? `${maskEmail(profile.recovery_email)}${emailVerified ? '' : ` · ${t.authHub.unverified}`}`
              : t.authHub.notConfigured
          }
          action={profile?.recovery_email ? t.authHub.change : t.authHub.add}
          onAction={() => setSheet('email')}
          hint={t.authHub.recoveryHint}
        />

        {/* 3 · Código privado */}
        <Row
          title={t.authHub.privateCode}
          value={
            hasCode
              ? `${t.authHub.active} · ${profile?.private_code_freq === 'always' ? t.authHub.always : t.authHub.occasional}`
              : t.authHub.notConfigured
          }
          action={hasCode ? t.authHub.change : t.authHub.setUp}
          onAction={() => setSheet('code')}
          hint={t.authHub.privateCodeHint}
        />

        {/* 4 · Biométrico — oculto si el dispositivo no lo soporta */}
        {bioAvailable && (
          <Row
            title={t.authHub.biometricSignIn}
            value={
              bioCount > 0
                ? (bioCount > 1 ? t.authHub.activeDevicesPlural : t.authHub.activeDevices).replace('{n}', String(bioCount))
                : t.authHub.notConfigured
            }
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

function Row({
  title,
  value,
  action,
  onAction,
  hint,
}: {
  title: string
  value: string
  action: string
  onAction: () => void
  hint?: string
}) {
  return (
    <div className="px-5 py-5 border-b border-hairline">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15px]">{title}</div>
          <div className="text-[13px] text-ink-soft mt-1 truncate">{value}</div>
          {hint && <div className="text-[11px] text-placeholder mt-1">{hint}</div>}
        </div>
        <button
          type="button"
          onClick={onAction}
          className="label-caps hover:text-ink whitespace-nowrap pt-1"
        >
          {action}
        </button>
      </div>
    </div>
  )
}
