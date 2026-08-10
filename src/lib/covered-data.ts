/**
 * Registraciones cubiertas — Backend Spec 01 §1.5.
 *
 * Las primeras N registraciones de cada creador las paga tbt.cafe. Dos reglas
 * gobiernan cómo se presenta y cuándo se consume:
 *
 *  - La tarifa SIEMPRE se muestra. $8 tachado y "Cubierto por tbt.cafe", nunca
 *    $0: decir el valor y asumirlo se lee como generosidad; mostrar cero se lee
 *    como que no vale nada.
 *  - Solo descuenta una registración COMPLETADA. Un intento abandonado o
 *    bloqueado no consume la asignación.
 *
 * Lo consumido es el número de filas del libro, no un contador aparte: así no
 * puede desfasarse respecto del costo que realmente se asumió.
 */
import { supabase } from '@/lib/supabase'
import { FEE } from '@/lib/fees'

export const REGISTRATION_FEE = FEE.service

export type CoveredStatus = {
  /** Si esta registración la paga tbt.cafe. */
  isCovered: boolean
  /** Cuántas le quedan al creador después de esta. */
  remaining: number
}

const NOT_COVERED: CoveredStatus = { isCovered: false, remaining: 0 }

/**
 * Estado de la asignación del creador.
 *
 * Falla hacia el lado seguro: ante cualquier error —incluida la migración 011
 * sin aplicar— devuelve "no cubierta" y se cobra normal. El error caro es
 * regalar registraciones por accidente, no cobrar una de más.
 */
export async function fetchCoveredStatus(userId: string): Promise<CoveredStatus> {
  try {
    const [{ data: config }, { data: profile }, { count }] = await Promise.all([
      supabase.from('platform_config').select('covered_brews_enabled, covered_brews_count').single(),
      supabase.from('profiles').select('covered_registrations_granted').eq('id', userId).single(),
      supabase
        .from('covered_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', userId),
    ])
    if (!config) return NOT_COVERED

    const granted = profile?.covered_registrations_granted ?? 0
    // El interruptor detiene asignaciones nuevas sin tocar las ya otorgadas a
    // una persona en concreto.
    const allowance = (config.covered_brews_enabled ? config.covered_brews_count : 0) + granted
    const used = count ?? 0
    const remaining = Math.max(0, allowance - used)

    return { isCovered: remaining > 0, remaining }
  } catch {
    return NOT_COVERED
  }
}
