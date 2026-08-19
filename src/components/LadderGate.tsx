'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import { StandingSheet } from '@/components/Sheet'
import { BiometricRing } from '@/components/BiometricRing'
import { useBiometricProof } from '@/lib/use-biometric-proof'
import {
  resolveLadder,
  fetchLadderThresholds,
  LADDER_DEFAULTS,
  type MoneyAction,
  type LadderThresholds,
} from '@/lib/auth-ladder'

/**
 * El portón de la escalera — Backend Spec 01 §5.1.
 *
 * Se pone delante de una acción de dinero y decide si hace falta fricción.
 * Por debajo del umbral no aparece: llama a `onAuthorized(null)` y desaparece,
 * porque el spec es explícito en que bajo $500 no se añade fricción ninguna.
 *
 * El 3D Secure NO se recoge aquí. Ocurre dentro de Stripe, después de escribir
 * la tarjeta (§1A). Lo que se hace aquí es AVISARLO, para que nadie se
 * sorprenda cuando el banco le pare a mitad del pago.
 *
 * Esto es UX, no seguridad. El servidor vuelve a derivar lo exigido del monto
 * que él conoce y rechaza sin prueba; que este componente aparezca o no, no
 * cambia lo que el servidor acepta.
 */
export function LadderGate({
  open,
  action,
  amount,
  onAuthorized,
  onCancel,
}: {
  open: boolean
  action: MoneyAction
  amount: number | null
  /** `null` cuando la escalera no exigía nada. */
  onAuthorized: (biometricProof: string | null) => void
  onCancel: () => void
}) {
  const { t } = useLocale()
  const bio = useBiometricProof()
  const { reset: resetBio } = bio
  const [thresholds, setThresholds] = useState<LadderThresholds | null>(null)

  useEffect(() => {
    if (!open) return
    resetBio()
    // Se leen al abrir y no al montar: son configurables y la pantalla puede
    // llevar horas abierta.
    fetchLadderThresholds().then(setThresholds)
  }, [open, resetBio])

  const requirement = resolveLadder(action, amount, thresholds ?? LADDER_DEFAULTS)

  // Nada que pedir: no se enseña un modal para decir que no hace falta nada.
  useEffect(() => {
    if (!open || thresholds === null) return
    if (!requirement.biometric) onAuthorized(null)
  }, [open, thresholds, requirement.biometric, onAuthorized])

  if (!open || thresholds === null || !requirement.biometric) return null

  return (
    <StandingSheet
      open={open}
      onClose={onCancel}
      head={t.ladder.title}
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!bio.proof}
            onClick={() => onAuthorized(bio.proof)}
            className="w-full rounded-[10px] bg-ink py-3.5 text-[12px] font-medium tracking-[0.08em] uppercase text-paper transition-opacity disabled:opacity-30 disabled:cursor-default"
          >
            {t.ladder.proceed}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2 text-[11px] tracking-[0.06em] text-ink-soft hover:text-ink transition-colors"
          >
            {t.ladder.cancel}
          </button>
        </div>
      }
    >
      <div className="pb-4">
        <p className="text-[13px] leading-[1.6] text-ink-soft">
          {t.ladder.biometricWhy.replace('{threshold}', money(requirement.thresholds.biometric))}
        </p>

        <BiometricRing
          confirmed={Boolean(bio.proof)}
          busy={bio.busy}
          onPress={bio.request}
          hint={bio.proof ? t.payouts.identityConfirmed : t.payouts.touchToConfirm}
        />

        {bio.error && (
          <p className="text-[10.5px] text-t-red text-center -mt-1">
            {bio.error === 'no_credentials' ? t.ladder.noBiometric : t.ladder.failed}
          </p>
        )}

        {/* Sobre el umbral alto, el banco también va a preguntar. Decirlo antes
            evita que el 3DS se lea como un fallo del pago. */}
        {requirement.threeDS && (
          <p className="mt-4 rounded-[10px] border border-hairline bg-paper-warm px-3.5 py-3 text-[11.5px] leading-[1.55] text-ink-soft">
            {t.ladder.threeDsNote.replace('{threshold}', money(requirement.thresholds.threeDS))}
          </p>
        )}
      </div>
    </StandingSheet>
  )
}
