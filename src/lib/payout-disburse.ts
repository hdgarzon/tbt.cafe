import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe'

/**
 * La disposicion real del dinero — Spec 02 §4 paso 8.
 *
 * Hasta ahora el libro estaba completo y el rail no existia: un bloque nacia en
 * `processing` y se quedaba ahi. Esto lo cierra.
 *
 * QUE SIGNIFICA `paid`
 *
 * Que la transferencia llego al saldo de Stripe de la persona, no que ya este
 * en su banco. Es deliberado y es lo que pide el §3.2: los fondos quedan en
 * custodia de Stripe y no en los libros de tbt.cafe. Desde ese saldo, Stripe
 * los entrega segun su calendario y la persona lo ve en su Express Dashboard.
 *
 * La alternativa —esperar al `payout.paid` de la cuenta conectada— no se puede
 * mapear con honestidad: un payout agrupa varias transferencias, asi que no
 * hay forma fiable de decir cual bloque cerro. Cerrar cuando la obligacion de
 * la plataforma se extingue es lo unico que se puede afirmar sin inventar.
 *
 * IDEMPOTENCIA
 *
 * La clave es el `block_id`. Un reintento —de la persona, de la red, de un
 * despliegue a medias— devuelve la MISMA transferencia en vez de pagar dos
 * veces. En una ruta de dinero eso no es una optimizacion, es la diferencia
 * entre un error y una perdida.
 */

/**
 * Refresca el estado de la cuenta desde Stripe.
 *
 * Sustituye a un webhook, a proposito. La capacidad `stripe_transfers` tarda en
 * activarse tras el alta y Stripe puede retirarla si pide mas requisitos, asi
 * que el dato caduca; pero el unico instante en que importa de verdad es justo
 * antes de mover dinero. Preguntar ahi es exacto y no depende de que un evento
 * haya llegado.
 *
 * Un webhook sigue siendo util para avisar antes de que la persona lo intente.
 * Es una mejora, no un requisito de correccion.
 */
export async function refreshConnectAccount(
  admin: SupabaseClient,
  userId: string,
  accountId: string
): Promise<{ transfersEnabled: boolean; status: string }> {
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.recipient'],
  })

  const cap = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers
  const capStatus = cap?.status ?? 'pending'
  const transfersEnabled = capStatus === 'active'

  const status =
    capStatus === 'active'
      ? 'active'
      : capStatus === 'restricted'
        ? 'restricted'
        : capStatus === 'unsupported'
          ? 'rejected'
          : 'onboarding'

  await admin
    .from('payout_connect_accounts')
    .update({
      transfers_enabled: transfersEnabled,
      status,
      // Los codigos que Stripe da para explicar por que no esta activa. Se
      // guardan para poder decirle a la persona que le falta, en vez de un
      // "no se puede".
      requirements_due: (cap?.status_details ?? []).map((d) => d.code),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  return { transfersEnabled, status }
}

export type DisburseResult =
  | { status: 'paid'; reference: string }
  | { status: 'failed'; reason: string }
  /**
   * No se sabe si el dinero salió. El bloque se queda en `processing` y las
   * ganancias NO vuelven a `available`: hay que reconciliar a mano.
   */
  | { status: 'pending'; reason: string }

export async function disburseBlock(
  admin: SupabaseClient,
  userId: string,
  blockId: string,
  netAmount: number
): Promise<DisburseResult> {
  const fail = async (reason: string): Promise<DisburseResult> => {
    // Devuelve las ganancias a `available`: la persona puede volver a
    // intentarlo. Dejarlas en `collected` seria retenerle dinero por un fallo
    // que no es suyo.
    await admin.rpc('fail_payout_block', { p_block_id: blockId, p_reason: reason })
    return { status: 'failed', reason }
  }

  try {
    const { data: account } = await admin
      .from('payout_connect_accounts')
      .select('account_id, transfers_enabled, status')
      .eq('user_id', userId)
      .maybeSingle()

    if (!account) return fail('no_connect_account')

    /**
     * `transfers_enabled` se lee, no se supone. La capacidad `stripe_transfers`
     * tarda en activarse tras el alta, y Stripe puede retirarla si pide mas
     * requisitos. Intentar transferir sin ella devuelve un error del proveedor
     * que la persona no puede accionar; este mensaje si le dice que hacer.
     */
    let enabled = account.transfers_enabled
    if (!enabled) {
      // El dato de la tabla puede estar viejo. Se pregunta antes de rendirse.
      const fresh = await refreshConnectAccount(admin, userId, account.account_id)
      enabled = fresh.transfersEnabled
    }
    if (!enabled) return fail('transfers_not_enabled')

    const transfer = await stripe.transfers.create(
      {
        amount: Math.round(netAmount * 100),
        currency: 'usd',
        destination: account.account_id,
        // Para reconciliar desde el panel de Stripe sin abrir la base.
        metadata: { block_id: blockId, user_id: userId },
      },
      { idempotencyKey: `payout-block-${blockId}` }
    )

    const ok = await admin.rpc('settle_payout_block', {
      p_block_id: blockId,
      p_reference: transfer.id,
    })

    if (ok.error) {
      /**
       * El dinero YA salio y la fila no se pudo cerrar. No se marca fallido:
       * eso devolveria a `available` unas ganancias que ya se pagaron, y la
       * siguiente vez se pagarian otra vez.
       *
       * Se registra con la referencia dentro para reconciliar a mano. Un bloque
       * atascado en `processing` con una transferencia real detras es molesto;
       * pagar dos veces es dinero perdido.
       */
      console.error(
        `[payout-disburse] bloque ${blockId} transferido como ${transfer.id} pero no se pudo cerrar:`,
        ok.error
      )
      return { status: 'paid', reference: transfer.id }
    }

    return { status: 'paid', reference: transfer.id }
  } catch (error) {
    /*
     * No todo fallo significa que el dinero no salió.
     *
     * `StripeConnectionError` y `StripeAPIError` son INDETERMINADOS: la
     * petición pudo llegar y crear la transferencia antes de que se cortara la
     * respuesta. Marcarlos como fallidos devolvería a `available` unas
     * ganancias quizá ya pagadas, y el reintento pide un bloque nuevo con un
     * `block_id` nuevo — o sea otra clave de idempotencia — así que Stripe
     * crearía una SEGUNDA transferencia.
     *
     * Es el mismo criterio que ya se aplica más arriba cuando
     * `settle_payout_block` falla: un bloque atascado en `processing` es
     * molesto; pagar dos veces es dinero perdido.
     *
     * Esta rama es nueva en la práctica. El SDK 20 se colgaba en este caso y el
     * `catch` no llegaba a correr nunca; el 22 lanza (22.6.0, #2815), así que
     * ahora se alcanza.
     */
    const type =
      error && typeof error === 'object' && typeof (error as { type?: unknown }).type === 'string'
        ? (error as { type: string }).type
        : ''
    // `'code' in error` no vale: las clases de error de Stripe declaran `code`
    // aunque valga undefined, y se guardaba la cadena literal 'undefined'.
    const code =
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : ''
    const reason = code || type || 'provider_error'

    if (type === 'StripeConnectionError' || type === 'StripeAPIError') {
      console.error(
        `[payout-disburse] bloque ${blockId} en estado desconocido tras ${reason}: ` +
          'la transferencia pudo salir, NO se devuelven las ganancias. Reconciliar a mano.',
        error
      )
      return { status: 'pending', reason }
    }

    console.error(`[payout-disburse] no se pudo disponer el bloque ${blockId}:`, error)
    return fail(reason)
  }
}
