import { supabase } from '@/lib/supabase'

/**
 * Conteo de notificaciones sin leer — alimenta los tres estados del icono del
 * header (Spec 06 §1.1: el feed en la app es el canal garantizado).
 *
 * Cuenta sin traer filas: al header solo le importa si hay algo, no qué. La
 * migración 015 tiene un índice parcial sobre `read_at is null` justo para
 * esta consulta.
 */
export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)

  if (error) return 0
  return count ?? 0
}
