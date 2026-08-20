import type { SupabaseClient } from '@supabase/supabase-js'
import { royaltyAmountOf, royaltyPayout, type Royalty } from '@/lib/fees'

/**
 * Escritura del libro de ganancias — Backend Spec 01 §1.3 y §4.
 *
 * QUÉ SE DEBE, Y QUÉ NO
 *
 * La plataforma solo puede deber lo que efectivamente cobró. Hoy una compra
 * cobra por Stripe la tarifa de $8 y la regalía del artista — nada más: el
 * PRECIO de la obra cambia de manos FUERA de la plataforma, entre comprador y
 * vendedor (ver el comentario de cabecera de /api/stripe/create-purchase).
 *
 * Por eso aquí se escribe una sola ganancia, la REGALÍA. Registrar una de
 * `sale` por el precio completo apuntaría dinero que la plataforma nunca tuvo
 * y que no puede disponer: un saldo cobrable que fallaría en el momento de
 * cobrarlo.
 *
 * El §1.1 del spec describe un modelo donde la plataforma sí retiene el precio
 * completo. Eso ahora es POSIBLE —la infraestructura de payouts existe— pero
 * cambiar qué cobra Stripe es una decisión de modelo de negocio, no un efecto
 * secundario de escribir este libro.
 *
 * IDEMPOTENCIA
 *
 * `source_ref` es obligatorio y lleva el id de la transferencia. La migración
 * 020 tiene un índice único sobre (source, source_ref), y es lo único que
 * impide que un reintento del webhook o una segunda pasada por
 * complete-transfer conviertan un reintento en dinero nuevo. Sin `source_ref`
 * el índice no aplica: es un índice parcial `where source_ref is not null`.
 */

export type EarningWrite = {
  admin: SupabaseClient
  workId: string
  /** Id de la transferencia. Ancla la idempotencia. */
  transferId: string
  /** Quién vendió o envió. Si es el creador, no hay regalía que pagarle. */
  fromOwnerId: string | null
  /** Valor declarado o precio de venta, para resolver una regalía porcentual. */
  amount: number
}

/**
 * Escribe la regalía que se le debe al creador.
 *
 * `release` decide CÓMO se libera, y no es un detalle (§4.2):
 *
 *   'timer'  una compra. Entra en `pending` con la ventana de liquidación de
 *            la venta que la generó.
 *   'event'  una transferencia de dos fases. Entra DIRECTAMENTE en
 *            `available`, sin fecha: transferencias y ofertas liberan por
 *            EVENTO, y la aceptación de la contraparte ES esa condición.
 *            Ponerle temporizador sería inventar una regla que el spec
 *            descarta, y retener un dinero que se capturó precisamente porque
 *            las dos partes estuvieron de acuerdo.
 */
export async function recordRoyaltyEarning(
  input: EarningWrite,
  release: 'timer' | 'event'
): Promise<void> {
  const { admin, workId, transferId, fromOwnerId, amount } = input

  try {
    const { data: work } = await admin
      .from('works')
      .select('creator_id, commerce:work_commerce(royalty_type, royalty_value)')
      .eq('id', workId)
      .single()

    if (!work?.creator_id) return

    // Nadie se paga regalía a sí mismo. Si el creador es quien vende, la
    // regalía no se cobró (transferQuote la pone en cero) y no hay nada que
    // deber.
    if (fromOwnerId && work.creator_id === fromOwnerId) return

    const commerce = Array.isArray(work.commerce) ? work.commerce[0] : work.commerce
    if (!commerce) return

    const terms: Royalty = {
      type: commerce.royalty_type ?? 'none',
      value: Number(commerce.royalty_value ?? 0),
    }

    const gross = royaltyAmountOf(terms, amount)
    if (gross <= 0) return

    // Lo que le queda al creador — §1.3: el proveedor absorbe el
    // procesamiento, pero la tarifa de servicio se descuenta. Toda ruta de
    // dinero pasa por la misma función; ninguna hace su propia resta.
    const net = royaltyPayout(gross)
    if (net <= 0) return

    const releasesAt =
      release === 'timer'
        ? (
            await admin.rpc('payout_release_at', {
              p_source: 'royalty',
              p_sale_amount: amount,
              p_completed_at: new Date().toISOString(),
            })
          ).data
        : null

    const { error } = await admin.from('payout_earnings').insert({
      user_id: work.creator_id,
      source: 'royalty',
      work_id: workId,
      source_ref: transferId,
      amount: net,
      state: release === 'timer' ? 'pending' : 'available',
      releases_at: releasesAt,
      hold_reason: release === 'timer' ? 'settlement_window' : null,
      released_at: release === 'event' ? new Date().toISOString() : null,
    })

    // 23505 es el índice único: ya se escribió en una pasada anterior. Es el
    // resultado que se busca, no un fallo.
    if (error && error.code !== '23505') {
      console.error('[payout-earnings] could not record the royalty:', error)
    }
  } catch (error) {
    /**
     * No tumba la transferencia. Para cuando esto corre, el pago está cobrado
     * y la propiedad ya cambió de manos: fallar aquí no devuelve nada, solo
     * deja al comprador sin su obra por un problema de contabilidad nuestro.
     *
     * Es recuperable: `source_ref` hace la escritura determinista, así que se
     * puede reconciliar después desde `transfers` sin riesgo de duplicar.
     */
    console.error('[payout-earnings] unexpected failure recording the royalty:', error)
  }
}
