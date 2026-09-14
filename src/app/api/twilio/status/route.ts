import { NextRequest, NextResponse } from 'next/server'
import { validateRequest } from 'twilio/lib/webhooks/webhooks'
import { createAdminClient } from '@/lib/supabase-admin'
import { recordProviderEvent } from '@/lib/provider-events'
import { fileSystemTicket } from '@/lib/system-tickets'
import { notify } from '@/lib/notify'

/**
 * Estado de entrega de Twilio — la mitad que faltaba del arreglo de entrega.
 *
 * Twilio ACEPTA un mensaje y decide después si pudo entregarlo. Las rutas de
 * envío ya detectan el fallo inmediato, pero un mensaje que se cae minutos más
 * tarde —el caso normal cuando el problema es la operadora o el número— no deja
 * rastro en ninguna parte. Esto es lo único que lo ve.
 *
 * NO lleva autenticación de sesión, porque quien llama es Twilio y no tiene
 * ninguna. La firma es lo que ocupa ese lugar: sin validarla, cualquiera podría
 * declarar entregas exitosas de certificados que nunca salieron, que es
 * exactamente la mentira que llevamos toda la sesión desmontando.
 */

/** Estados terminales. El resto son etapas de camino y no significan nada aún. */
const FAILED = new Set(['failed', 'undelivered'])
const DELIVERED = new Set(['delivered'])

export async function POST(request: NextRequest) {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN
    if (!authToken) {
      console.error('[twilio/status] TWILIO_AUTH_TOKEN missing — cannot verify signature')
      return NextResponse.json({ error: 'not_configured' }, { status: 500 })
    }

    const raw = await request.text()
    const params = Object.fromEntries(new URLSearchParams(raw))
    const signature = request.headers.get('x-twilio-signature') ?? ''

    /*
     * La URL tiene que ser EXACTAMENTE la que se configuró en Twilio, porque la
     * firma se calcula sobre ella. Detrás de un proxy, request.url puede traer
     * el host interno, así que se reconstruye desde las cabeceras reenviadas.
     */
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    const url = `${proto}://${host}${new URL(request.url).pathname}`

    if (!validateRequest(authToken, signature, url, params)) {
      // No se dice qué falló: una respuesta que distingue firma inválida de URL
      // equivocada le sirve a quien esté probando.
      console.error('[twilio/status] signature rejected for', params.MessageSid)
      return NextResponse.json({ error: 'invalid_signature' }, { status: 403 })
    }

    const sid = params.MessageSid
    const status = (params.MessageStatus ?? '').toLowerCase()
    const errorCode = params.ErrorCode || null

    if (!sid || !status) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 })
    }

    const failed = FAILED.has(status)
    const delivered = DELIVERED.has(status)

    // Estados intermedios (queued, sending, sent) se aceptan sin hacer nada:
    // devolver error haría que Twilio reintentara sin motivo.
    if (!failed && !delivered) {
      return NextResponse.json({ ok: true, ignored: status })
    }

    const supabase = createAdminClient()

    const { data: delivery } = await supabase
      .from('mms_deliveries')
      .update({ status: failed ? 'failed' : 'delivered' })
      .eq('twilio_message_sid', sid)
      .select('work_id, user_id')
      .maybeSingle()

    void recordProviderEvent({
      provider: 'twilio',
      operation: 'delivery_status',
      ok: delivered,
      error: failed ? { code: errorCode ?? undefined, message: status } : undefined,
      entityType: 'work',
      entityId: delivery?.work_id ?? sid,
    })

    if (delivery?.work_id) {
      await supabase
        .from('works')
        .update({ mms_delivery_status: failed ? 'failed' : 'delivered' })
        .eq('id', delivery.work_id)
    }

    /*
     * Un certificado sin entregar es severidad financiera aunque no mueva
     * dinero: la persona pagó o gastó su cupo y no recibió el producto. El
     * ticket es idempotente por (entidad, evento), así que varios callbacks del
     * mismo mensaje no abren varios tickets.
     */
    if (failed && delivery?.user_id) {
      await fileSystemTicket(supabase, {
        userId: delivery.user_id,
        eventCode: 'mms_delivery_failed',
        entityType: 'registration',
        entityId: delivery.work_id ?? sid,
        errorDetail: { twilioStatus: status, twilioErrorCode: errorCode, messageSid: sid },
      })
      await notify(supabase, {
        userId: delivery.user_id,
        eventKey: 'ticket_system',
        data: { subject: 'certificate delivery failed', severity: 'financial' },
        href: '/help',
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[twilio/status] failed:', error)
    // 200 a propósito: un 500 hace que Twilio reintente, y si el fallo es
    // nuestro el reintento tampoco va a funcionar.
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
