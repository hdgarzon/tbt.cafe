import { NextRequest, NextResponse } from 'next/server'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { createAdminClient } from '@/lib/supabase-admin'
import { isProduction } from '@/lib/app-env'
import { authenticate } from '@/lib/route-auth'
import twilio from 'twilio'

/**
 * Los dos clientes, construidos en el primer uso y no al importar.
 *
 * `twilio(sid, token)` VALIDA el formato del SID al construir. Mientras la
 * variable no existia la condicion era falsa y esto devolvia null, asi que
 * nadie lo noto; en cuanto se definio, un SID mal formado dejo de romper la
 * ruta de SMS y paso a romper el build entero:
 *
 *   Error: accountSid must start with AC
 *   > Failed to collect page data for /api/send-sms
 *
 * Es el mismo patron que ya obligo a hacer perezosos `stripe.ts` y
 * `app-env.ts`. Un throw en el cuerpo de un modulo no rompe la llamada que
 * necesita la credencial: rompe el grafo, y con el el despliegue completo.
 *
 * El de SNS no valida al construir, asi que no habia dado guerra — pero es la
 * misma bomba con otra mecha, y va igual.
 */
let sns: SNSClient | null = null
function snsClient(): SNSClient {
  return (sns ??= new SNSClient({
    region: process.env.AWS_REGION || 'us-east-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  }))
}

let twilioCached: ReturnType<typeof twilio> | null = null
function twilioClient(): ReturnType<typeof twilio> | null {
  if (twilioCached) return twilioCached
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  try {
    twilioCached = twilio(sid, token)
    return twilioCached
  } catch (error) {
    // Un SID mal formado es configuracion equivocada, no una peticion mala.
    // Se registra y el MMS no sale; el SMS por SNS sigue su camino.
    console.error('[send-sms] no se pudo construir el cliente de Twilio:', error)
    return null
  }
}

interface SendSMSRequest {
  phoneNumber: string
  workId: string
  userId: string
  message?: string
  sendMMS?: boolean // Flag to send MMS with certificate image
}

/**
 * Normaliza a E.164, que es lo único que Twilio acepta.
 *
 * Un número guardado como "+1203810-0238" o enviado como "573207145752" sin el
 * "+" produce un 21211 o un 21606: Twilio crea el mensaje igual y lo marca
 * `failed` después, así que el error no se ve en la llamada.
 */
function toE164(raw: string): string {
  const trimmed = String(raw).trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  return digits ? `+${digits}` : trimmed
}

export async function POST(request: NextRequest) {
  /*
   * Declarado FUERA del try a proposito: si el respaldo tambien falla, la
   * excepcion sube hasta el catch de abajo, y alli este era el unico rastro
   * de por que Twilio no pudo entregar. Dentro del bloque no estaba en
   * alcance y se perdia.
   */
  let twilioFailure: { code: number | string | null; message: string | null } | null = null

  /*
   * Y lo mismo con a quien iba dirigido: sin esto el catch no puede escribir
   * la fila del fallo, porque no sabe de quien era el certificado.
   */
  let delivery: { workId: string; userId: string; phoneNumber: string } | null = null

  try {
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { supabase, user } = auth

    // Parse request body
    const body: SendSMSRequest = await request.json()
    const { phoneNumber, workId, userId, message, sendMMS = true } = body
    delivery = { workId, userId, phoneNumber }

    if (!phoneNumber || !workId || !userId) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: phoneNumber, workId, userId' },
        { status: 400 }
      )
    }

    // Verify the caller is the user the notification is for
    if (user.id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get work details with creator info for the message
    const { data: work, error: workError } = await supabase
      .from('works')
      .select(`
        title, 
        tbt_id, 
        media_url,
        category,
        certified_at,
        creator_id,
        creator:profiles!works_creator_id_fkey(display_name, public_alias),
        work_commerce(initial_price, currency)
      `)
      .eq('id', workId)
      .single()

    if (workError || !work) {
      return NextResponse.json(
        { error: 'Obra no encontrada' },
        { status: 404 }
      )
    }

    // Verify the caller is the creator or current owner of the work
    if ((work as any).creator_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get creator name
    const creatorData = work.creator as any
    const creatorName = Array.isArray(creatorData) 
      ? (creatorData[0]?.public_alias || creatorData[0]?.display_name)
      : (creatorData?.public_alias || creatorData?.display_name)

    // Get commerce data
    const commerce = Array.isArray(work.work_commerce) 
      ? work.work_commerce[0] 
      : work.work_commerce

    // Build enhanced MMS message with full TBT details
    const certifiedDate = work.certified_at 
      ? new Date(work.certified_at).toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
      : 'Hoy'

    const mmsMessage = message || 
      `🎨 ¡Tu TBT está certificado!\n\n` +
      `📜 "${work.title}"\n` +
      `👤 Creador: ${creatorName || 'Artista'}\n` +
      `🏷️ Categoría: ${work.category || 'Arte'}\n` +
      `📅 Certificado: ${certifiedDate}\n` +
      `🆔 ID: ${work.tbt_id}\n` +
      (commerce ? `💰 Valor: $${commerce.initial_price?.toLocaleString()} ${commerce.currency}\n` : '') +
      `\n🔗 Ver certificado:\n` +
      `${process.env.NEXT_PUBLIC_APP_URL}/work/${work.tbt_id}\n\n` +
      `¡Gracias por proteger tu obra con TBT!`

    const certificateUrl = `${process.env.NEXT_PUBLIC_APP_URL}/work/${work.tbt_id}`
    
    // Determine media URL for MMS (use work image or a default certificate image)
    const mediaUrl = work.media_url || `${process.env.NEXT_PUBLIC_APP_URL}/logos/transbit.png`


    // Try to send MMS via Twilio if configured
    const tw = twilioClient()
    if (sendMMS && tw && process.env.TWILIO_PHONE_NUMBER) {
      try {
        const twilioMessage = await tw.messages.create({
          body: mmsMessage,
          from: toE164(process.env.TWILIO_PHONE_NUMBER),
          to: toE164(phoneNumber),
          mediaUrl: [mediaUrl], // Include certificate/work image
          /*
           * Sin esto, un mensaje que Twilio acepta y luego no entrega no deja
           * rastro: el fallo llega minutos después y nadie lo ve. El webhook es
           * lo único que cierra ese hueco.
           */
          statusCallback: `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/status`,
        })

        /*
         * Twilio ACEPTA el mensaje y decide después si pudo entregarlo, así que
         * que `create` no lance NO significa que haya salido. Durante meses esta
         * ruta devolvió éxito mientras todos los mensajes quedaban en `failed`,
         * y el certificado —que es el producto— no llegaba a nadie.
         *
         * Un estado terminal de fallo se trata como fallo aquí mismo. Los que
         * fallan más tarde solo se pueden saber por el webhook de estado, que
         * todavía no existe.
         */
        const failed = twilioMessage.status === 'failed' || twilioMessage.status === 'undelivered'

        // Como en #18: esta fila la escribe la plataforma. Con el token del
        // usuario la RLS la deniega y el registro de entregas queda vacío —
        // que es justamente como estaba.
        const { error: twilioLedgerError } = await createAdminClient().from('mms_deliveries').insert({
          work_id: workId,
          user_id: userId,
          phone_number: phoneNumber,
          twilio_message_sid: twilioMessage.sid,
          status: failed ? 'failed' : 'sent',
          certificate_url: certificateUrl,
          gif_url: mediaUrl,
          sent_at: new Date().toISOString(),
        })
        if (twilioLedgerError) console.error('[send-sms] no se pudo registrar la entrega:', twilioLedgerError)

        if (failed) {
          console.error('Twilio rejected the message:', twilioMessage.status, twilioMessage.errorCode)
          return NextResponse.json(
            {
              error: 'delivery_failed',
              twilioStatus: twilioMessage.status,
              twilioErrorCode: twilioMessage.errorCode,
            },
            { status: 502 }
          )
        }

        return NextResponse.json({
          success: true,
          messageId: twilioMessage.sid,
          status: twilioMessage.status,
          message: 'MMS enviado exitosamente con imagen del certificado',
          type: 'mms',
        })
      } catch (twilioError: any) {
        // El código de Twilio (21606 sin número emisor, 21211 destino inválido)
        // se conserva para que quien llame pueda agruparlo.
        console.error('Twilio MMS error:', twilioError?.code, twilioError?.message)
        twilioFailure = { code: twilioError?.code ?? null, message: twilioError?.message ?? null }
        // Fall through to SMS fallback
      }
    }

    // Fallback: Check if AWS credentials are configured for simple SMS
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.log('⚠️ No messaging service configured. Message would be sent to:', phoneNumber)
      console.log('Message:', mmsMessage)
      console.log('Media URL:', mediaUrl)
      
      // Save to mms_deliveries with simulated status
      const { error: simLedgerError } = await createAdminClient().from('mms_deliveries').insert({
        work_id: workId,
        user_id: userId,
        phone_number: phoneNumber,
        status: isProduction ? 'failed' : 'simulated',
        certificate_url: certificateUrl,
        gif_url: mediaUrl,
      })
      if (simLedgerError) console.error('[send-sms] no se pudo registrar la entrega:', simLedgerError)

      /*
       * Simular NO es entregar.
       *
       * Esta rama devolvía éxito, y como complete-tbt cuelga de esa respuesta
       * su evento de observabilidad y su ticket de severidad financiera, el
       * resultado era que nadie se enteraba de que el certificado —que es el
       * producto— no había salido. Meses así.
       *
       * Fuera de producción sigue siendo útil para desarrollar sin credenciales,
       * y se marca como simulado para que quien lo lea no lo confunda con una
       * entrega.
       */
      if (isProduction) {
        return NextResponse.json(
          {
            error: 'no_messaging_provider',
            message: 'No messaging provider is configured, so the certificate was not delivered.',
            twilioErrorCode: twilioFailure?.code ?? null,
            twilioStatus: twilioFailure?.message ?? null,
          },
          { status: 502 }
        )
      }

      return NextResponse.json({
        success: true,
        simulated: true,
        message: 'MMS simulado (credenciales no configuradas)',
        messageId: `sim_${Date.now()}`,
        type: 'simulated',
      })
    }

    // Fallback: Send SMS via AWS SNS (no image support)
    const smsOnlyMessage = 
      `🎨 ¡Tu TBT está certificado!\n\n` +
      `"${work.title}" - ${creatorName || 'Artista'}\n` +
      `ID: ${work.tbt_id}\n\n` +
      `Ver certificado: ${certificateUrl}`

    const command = new PublishCommand({
      PhoneNumber: phoneNumber,
      Message: smsOnlyMessage,
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'TBT',
        },
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional',
        },
      },
    })

    const snsResponse = await snsClient().send(command)

    /*
     * Con el service role, como los otros dos sitios.
     *
     * Este se quedo con el cliente del usuario cuando se corrigieron los
     * demas, y el comentario de mas arriba describe con exactitud lo que le
     * pasaba: la RLS lo denegaba y el registro de entregas quedaba vacio. El
     * `error` se lee, ademas, para que una denegacion no vuelva a ser muda.
     */
    const { error: snsLedgerError } = await createAdminClient().from('mms_deliveries').insert({
      work_id: workId,
      user_id: userId,
      phone_number: phoneNumber,
      status: 'sent',
      certificate_url: certificateUrl,
      sent_at: new Date().toISOString(),
    })
    if (snsLedgerError) console.error('[send-sms] no se pudo registrar la entrega:', snsLedgerError)

    return NextResponse.json({
      success: true,
      messageId: snsResponse.MessageId,
      message: 'SMS enviado exitosamente (sin imagen)',
      type: 'sms',
    })

  } catch (error: any) {
    console.error('Error sending message:', error)

    /*
     * El libro de entregas tiene que saber decir que NO.
     *
     * Habia tres inserts y los tres colgaban de un camino de exito, asi que la
     * tabla que alguien abre para preguntar "¿salio el certificado?" era
     * incapaz de responder que no. Por eso quedo a cero despues de un intento
     * real que fallo dos veces.
     *
     * Se escribe aqui y no en el fallo de Twilio: ahi todavia queda el
     * respaldo por intentar, y una fila por intento contaria dos veces la
     * misma entrega.
     */
    if (delivery) {
      const { error: failedLedgerError } = await createAdminClient().from('mms_deliveries').insert({
        work_id: delivery.workId,
        user_id: delivery.userId,
        phone_number: delivery.phoneNumber,
        status: 'failed',
        // La columna que la tabla tiene de verdad. `status: 'failed'` ya lo
        // usa la rama de "sin proveedor", asi que no es un valor nuevo.
        error_message: [
          twilioFailure?.code ? `twilio ${twilioFailure.code}: ${twilioFailure.message ?? ''}`.trim() : null,
          error?.Code ?? error?.code ?? error?.name ?? null,
        ]
          .filter(Boolean)
          .join(' | ') || null,
      })
      if (failedLedgerError) console.error('[send-sms] no se pudo registrar el fallo:', failedLedgerError)
    }

    /*
     * La causa viaja. Esto devolvia solo 'Error al enviar mensaje', y como
     * `provider_events` se construye a partir de esta respuesta, el primer MMS
     * fallido quedo registrado como "[object Object]": hicieron falta los logs
     * del servidor para saber que eran DOS fallos, Twilio 21606 y unas
     * credenciales de AWS invalidas.
     *
     * Van el codigo y el nombre del error, nunca su cuerpo: un mensaje de un
     * proveedor puede llevar dentro parte de la peticion.
     */
    return NextResponse.json(
      {
        error: 'delivery_failed',
        provider: twilioFailure ? 'fallback' : 'twilio',
        failureCode: error?.Code ?? error?.code ?? error?.name ?? null,
        twilioErrorCode: twilioFailure?.code ?? null,
        twilioStatus: twilioFailure?.message ?? null,
      },
      { status: 500 }
    )
  }
}
