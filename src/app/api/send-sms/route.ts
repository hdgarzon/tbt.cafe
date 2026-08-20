import { NextRequest, NextResponse } from 'next/server'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { createAdminClient } from '@/lib/supabase-admin'
import { isProduction } from '@/lib/app-env'
import { authenticate } from '@/lib/route-auth'
import twilio from 'twilio'

// Initialize SNS Client (fallback for simple SMS)
const snsClient = new SNSClient({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

// Initialize Twilio client for MMS
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null

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
  try {
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { supabase, user } = auth

    // Parse request body
    const body: SendSMSRequest = await request.json()
    const { phoneNumber, workId, userId, message, sendMMS = true } = body

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

    let twilioFailure: { code: number | string | null; message: string | null } | null = null

    // Try to send MMS via Twilio if configured
    if (sendMMS && twilioClient && process.env.TWILIO_PHONE_NUMBER) {
      try {
        const twilioMessage = await twilioClient.messages.create({
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
        await createAdminClient().from('mms_deliveries').insert({
          work_id: workId,
          user_id: userId,
          phone_number: phoneNumber,
          twilio_message_sid: twilioMessage.sid,
          status: failed ? 'failed' : 'sent',
          certificate_url: certificateUrl,
          gif_url: mediaUrl,
          sent_at: new Date().toISOString(),
        })

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
      await createAdminClient().from('mms_deliveries').insert({
        work_id: workId,
        user_id: userId,
        phone_number: phoneNumber,
        status: isProduction ? 'failed' : 'simulated',
        certificate_url: certificateUrl,
        gif_url: mediaUrl,
      })

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

    const snsResponse = await snsClient.send(command)

    // Save delivery record to database
    await supabase.from('mms_deliveries').insert({
      work_id: workId,
      user_id: userId,
      phone_number: phoneNumber,
      status: 'sent',
      certificate_url: certificateUrl,
      sent_at: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      messageId: snsResponse.MessageId,
      message: 'SMS enviado exitosamente (sin imagen)',
      type: 'sms',
    })

  } catch (error: any) {
    console.error('Error sending message:', error)

    return NextResponse.json(
      { error: 'Error al enviar mensaje' },
      { status: 500 }
    )
  }
}
