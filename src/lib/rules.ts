import { createAdminClient } from '@/lib/supabase-admin'
import { createClient } from '@supabase/supabase-js'
import { rulesFromRow, publicRuleColumns, type Locale4, type PauseKey, type Rules, type RulesRow } from '@/lib/rules-shape'

/**
 * Las reglas del negocio, leidas de `platform_config` — Work Order 02, Stage 1.2.
 *
 * Un solo lector, en el servidor, con una cache corta. Toda ruta que necesite
 * un numero configurado lo pide aqui; ninguna lo repite. Un valor editable que
 * no es la unica copia convierte una pagina desactualizada en una falsa en
 * cuanto alguien usa el control (Rules Registry §5).
 *
 * Lee con el service role porque es el unico que ve la direccion del escaner
 * (058). El navegador usa `rules-public.ts`, que no la pide.
 *
 * Nada de esto se lee al importar (check:boot).
 */

export const RULES_CACHE_MS = 60_000

let cached: { at: number; rules: Rules } | null = null

export async function getRules(): Promise<Rules> {
  if (cached && Date.now() - cached.at < RULES_CACHE_MS) return cached.rules

  const { data, error } = await createAdminClient().from('platform_config').select('*').eq('id', true).single()
  if (error || !data) throw new Error(`rules: platform_config unreadable (${error?.message ?? 'no row'})`)

  const rules = rulesFromRow(data as RulesRow)
  cached = { at: Date.now(), rules }
  return rules
}

/**
 * Las reglas publicas, con la clave publica — para las paginas que se generan
 * en el build (Roast, Terminos). Un preview no lleva la clave de servicio, y
 * una pagina que la exigiera tumbaria su build. Sin direccion del escaner.
 */
export async function getPublicRules(): Promise<Rules> {
  // Cliente anonimo creado aqui y no importado: importar este modulo no puede
  // exigir nada del entorno (check:boot), ni arrastrar el cliente del navegador.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false },
  })
  const { data, error } = await anon.from('platform_config').select(publicRuleColumns()).eq('id', true).single()
  if (error || !data) throw new Error(`rules: platform_config unreadable (${error?.message ?? 'no row'})`)
  return rulesFromRow(data as unknown as RulesRow)
}

/**
 * Un interruptor de pausa — Work Order 02, Stage 11.
 *
 * Devuelve el cuerpo de la respuesta si esta encendido — con su mensaje en los
 * cuatro idiomas, para que la pantalla lo diga donde se intento — o null. Toda
 * ruta que registra, lista, oferta, transfiere, cobra o paga lo llama antes de
 * hacer nada.
 */
export async function assertNotPaused(key: PauseKey): Promise<{ error: 'paused'; switch: PauseKey; message: Locale4 } | null> {
  const { pauses } = await getRules()
  return pauses[key].on ? { error: 'paused', switch: key, message: pauses[key].message } : null
}

/** Tras un cambio desde el panel, para que la siguiente lectura no espere a la cache. */
export function forgetRules(): void {
  cached = null
}

export type { Rules } from '@/lib/rules-shape'
