'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { rulesFromRow, publicRuleColumns, type Rules } from '@/lib/rules-shape'

/**
 * Las reglas, para el navegador — Work Order 02, Stage 1.2.
 *
 * Mismo origen que el servidor: la fila de `platform_config`. Pide las columnas
 * por nombre porque la clave publica no puede leer la direccion del escaner
 * (058) y un `select('*')` fallaria entero. Un precio que la pantalla muestra
 * sale de aqui, nunca de una constante: si el panel lo cambia, cambia en todas
 * partes a la vez.
 */

const PUBLIC_COLUMNS = publicRuleColumns()

const CACHE_MS = 60_000
let cached: { at: number; rules: Rules } | null = null
let inflight: Promise<Rules> | null = null

export async function fetchPublicRules(): Promise<Rules> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rules
  if (inflight) return inflight
  inflight = (async () => {
    const { data, error } = await supabase.from('platform_config').select(PUBLIC_COLUMNS).eq('id', true).single()
    if (error || !data) throw new Error(`rules: platform_config unreadable (${error?.message ?? 'no row'})`)
    const rules = rulesFromRow(data as unknown as Record<string, unknown>)
    cached = { at: Date.now(), rules }
    return rules
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/** Las reglas en un componente. `null` mientras cargan: nunca un valor inventado. */
export function useRules(): Rules | null {
  const [rules, setRules] = useState<Rules | null>(cached?.rules ?? null)
  useEffect(() => {
    let live = true
    fetchPublicRules()
      .then((r) => { if (live) setRules(r) })
      .catch(() => { /* sin reglas no se muestra un precio: la pantalla espera */ })
    return () => { live = false }
  }, [])
  return rules
}
