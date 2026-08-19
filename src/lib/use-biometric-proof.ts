'use client'

import { useState, useCallback } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'

/**
 * Obtiene una prueba biométrica de un solo uso — Spec 01 §5.1.
 *
 * El servidor verifica la aserción WebAuthn y emite un token; ese token se
 * consume en la ruta que ejecuta la acción. El cliente nunca decide por su
 * cuenta que el biométrico pasó: un `bioConfirmed = true` local sería una
 * comprobación que el propio cliente se concede.
 *
 * Rutas de step-up, no las de login: aquí ya hay sesión, la identidad se
 * conoce y no debe emitirse ninguna sesión nueva.
 *
 * NOTA: no son rutas de administración —solo piden sesión— y por eso no viven
 * bajo /api/admin/. Están centralizadas aquí para que moverlas sea una línea.
 */
const BEGIN_URL = '/api/step-up/begin'
const VERIFY_URL = '/api/step-up/verify'

export type BiometricError = 'no_credentials' | 'failed'

export function useBiometricProof() {
  const [proof, setProof] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<BiometricError | null>(null)

  const reset = useCallback(() => {
    setProof(null)
    setError(null)
  }, [])

  const request = useCallback(async (): Promise<string | null> => {
    setBusy(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setError('failed')
        return null
      }
      const headers = {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      }

      const begin = await fetch(BEGIN_URL, { method: 'POST', headers })
      const beginBody = await begin.json().catch(() => ({}))
      if (!begin.ok) {
        setError(beginBody.error === 'no_credentials' ? 'no_credentials' : 'failed')
        return null
      }

      const credential = await startAuthentication({ optionsJSON: beginBody.options })

      const verify = await fetch(VERIFY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ credential }),
      })
      const verifyBody = await verify.json().catch(() => ({}))
      if (!verify.ok || !verifyBody.biometricProof) {
        setError('failed')
        return null
      }

      setProof(verifyBody.biometricProof)
      return verifyBody.biometricProof as string
    } catch {
      setError('failed')
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  return { proof, busy, error, request, reset }
}
