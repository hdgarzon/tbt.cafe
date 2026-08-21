import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { stripe } from '@/lib/stripe'
import { APP_URL } from '@/lib/app-env'

/**
 * Alta de la cuenta de cobro — Spec 01 §3.2, Spec 02 §4 paso 8.
 *
 * Devuelve un enlace de onboarding alojado por Stripe. Es idempotente: si la
 * persona ya tiene cuenta, no crea otra —el `unique` de la tabla lo impediria
 * de todas formas— sino que emite un enlace nuevo sobre la que existe. Un
 * segundo `acct_` para la misma persona partiria su saldo en dos.
 *
 * ACCOUNTS V2, NO V1
 *
 * Stripe indica que una integracion nueva use la API v2. El SDK instalado
 * (20.4.1) la expone en `stripe.v2.core`. La forma de v1 —`accounts.create({
 * type: 'express' })`— es la que uno escribe de memoria y ya no es la buena.
 *
 * LAS ELECCIONES QUE NO SE DESHACEN
 *
 * `dashboard` es inmutable por cuenta: cambiarlo obliga a crear otra. Va en
 * `express` porque el pago en USDC lo exige, y USDC es el unico rail que llega
 * a Latinoamerica. La API entonces obliga a que la plataforma sea responsable
 * de fees y perdidas: rechaza la combinacion contraria con
 * `account_controller_express_dash_without_application_losses_or_fees`.
 *
 * `configuration.recipient` es la persona correcta: estos vendedores reciben
 * regalias, no procesan cargos. La capacidad `stripe_transfers` es la que
 * habilita recibir transferencias, y tarda en activarse — por eso el estado
 * vive en la tabla y lo refresca el webhook, en vez de suponerse aqui.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

    const { country } = (await request.json().catch(() => ({}))) as { country?: string }
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('payout_connect_accounts')
      .select('account_id, status, country')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    let accountId = existing?.account_id

    if (!accountId) {
      // El pais decide que rails existen y Stripe lo congela al activar la
      // cuenta, asi que solo se acepta al crearla y nunca despues.
      if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) {
        return NextResponse.json({ error: 'country_required' }, { status: 400 })
      }

      /**
       * El pais vale si CUALQUIER metodo habilitado lo cubre, no solo el
       * bancario. Una cuenta de Connect es el requisito previo de todos los
       * rails: validar solo contra `bank` dejaba fuera a un vendedor
       * colombiano, cuyo rail es USDC —el unico que llega alli— y que sin
       * cuenta no podria cobrar nunca.
       */
      const { data: methods } = await admin
        .from('payout_methods')
        .select('id, countries')
        .eq('enabled', true)

      const reaches = (methods ?? []).some((m) => {
        const cs: string[] = m.countries ?? []
        return cs.includes('*') || cs.includes(country)
      })
      if (!reaches) {
        // Se dice cual es el problema, no un "no se pudo". Que ningun rail
        // llegue a un pais es un hecho del proveedor, no un fallo de la persona.
        return NextResponse.json({ error: 'country_unsupported' }, { status: 409 })
      }

      const account = await stripe.v2.core.accounts.create({
        contact_email: auth.user.email ?? undefined,
        identity: { country: country.toLowerCase(), entity_type: 'individual' },
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        defaults: {
          responsibilities: { fees_collector: 'application', losses_collector: 'application' },
        },
        dashboard: 'express',
        include: ['configuration.recipient', 'identity', 'requirements'],
      })

      accountId = account.id

      const { error } = await admin.from('payout_connect_accounts').insert({
        user_id: auth.user.id,
        account_id: accountId,
        country,
      })
      if (error) {
        // La cuenta ya existe en Stripe. Perder la fila la dejaria huerfana y
        // la siguiente llamada crearia una segunda: se registra con el id
        // dentro, para poder reconciliarla a mano.
        console.error(`[payouts/connect] cuenta ${accountId} creada pero no guardada:`, error)
        return NextResponse.json({ error: 'account_not_saved' }, { status: 500 })
      }
    }

    const link = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          // Vuelve aqui si el enlace caduca; Stripe los emite de un solo uso.
          refresh_url: `${APP_URL}/settings/payouts?connect=refresh`,
          return_url: `${APP_URL}/settings/payouts?connect=done`,
        },
      },
    })

    return NextResponse.json({ url: link.url, accountId, status: existing?.status ?? 'onboarding' })
  } catch (error) {
    console.error('[payouts/connect] no se pudo preparar el alta:', error)
    return NextResponse.json({ error: 'connect_unavailable' }, { status: 502 })
  }
}
