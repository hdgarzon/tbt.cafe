import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isProduction } from '@/lib/app-env'

/**
 * Anota el intento en `email_deliveries`.
 *
 * Simular no es enviar y aceptado no es entregado: los tres desenlaces se
 * escriben con su nombre, porque un libro que solo sabe decir que si no sirve
 * para preguntarle si algo salio. Es lo que `mms_deliveries` hace por el MMS —
 * y lo unico por lo que hoy se puede saber que ningun certificado ha salido
 * nunca por ese canal.
 *
 * SIEMPRE CON EL CLIENTE DE SERVICIO. Con el token del usuario la RLS deniega
 * la escritura y la tabla queda vacia sin que nadie se entere; por eso el error
 * de la insercion se lee y se registra, en lugar de descartarse.
 */
async function recordDelivery(row: {
  workId: string | null
  userId: string | null
  email: string
  status: 'sent' | 'failed' | 'simulated'
  resendMessageId?: string | null
  certificateUrl?: string | null
  errorMessage?: string | null
}): Promise<void> {
  try {
    const { error } = await createAdminClient().from('email_deliveries').insert({
      work_id: row.workId,
      user_id: row.userId,
      email: row.email,
      resend_message_id: row.resendMessageId ?? null,
      status: row.status,
      certificate_url: row.certificateUrl ?? null,
      error_message: row.errorMessage ?? null,
      sent_at: row.status === 'sent' ? new Date().toISOString() : null,
    })
    if (error) console.error('[send-email] no se pudo registrar la entrega:', error)
  } catch (ledgerError) {
    /*
     * Anotar no puede romper lo anotado. Si el cliente de servicio no se puede
     * construir —falta la clave, por ejemplo— esto lanzaría en mitad de la rama
     * de éxito y convertiría un correo entregado en un 500, además de escribir
     * una segunda fila desde el catch de abajo. El libro observa; no decide.
     */
    console.error('[send-email] el registro de la entrega falló:', ledgerError)
  }
}



interface SendEmailRequest {
  email: string
  workId: string
  userId: string
  mintAddress?: string
  solscanUrl?: string
}

// HTML Email Template
function generateEmailTemplate(data: {
  title: string
  tbtId: string
  creatorName: string
  category: string
  certifiedDate: string
  price?: string
  currency?: string
  mediaUrl?: string
  tbtUrl: string
  solscanUrl?: string
  mintAddress?: string
}) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Tu TBT está certificado!</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0f;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <img src="${process.env.NEXT_PUBLIC_APP_URL}/logos/transbit.png" alt="TBT" width="120" style="max-width: 120px;">
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px; border: 1px solid #2d2d44;">
              
              <!-- Success Icon -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #00d4aa 0%, #00b894 100%); border-radius: 50%; display: inline-block; text-align: center; line-height: 80px;">
                      <span style="font-size: 40px;">✓</span>
                    </div>
                  </td>
                </tr>
              </table>
              
              <!-- Title -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding-bottom: 10px;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">
                      ¡Tu TBT está certificado!
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 30px;">
                    <p style="margin: 0; color: #a0a0b0; font-size: 16px;">
                      Gracias por proteger tu obra con TBT
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- Work Image -->
              ${data.mediaUrl ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding-bottom: 30px;">
                    <img src="${data.mediaUrl}" alt="${data.title}" width="400" style="max-width: 100%; border-radius: 12px; border: 2px solid #2d2d44;">
                  </td>
                </tr>
              </table>
              ` : ''}
              
              <!-- Work Details -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0d0d15; border-radius: 12px; padding: 24px;">
                <tr>
                  <td style="padding: 24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <!-- Title -->
                      <tr>
                        <td style="padding-bottom: 16px;">
                          <p style="margin: 0 0 4px 0; color: #a0a0b0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Obra</p>
                          <p style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">"${data.title}"</p>
                        </td>
                      </tr>
                      
                      <!-- TBT ID -->
                      <tr>
                        <td style="padding-bottom: 16px;">
                          <p style="margin: 0 0 4px 0; color: #a0a0b0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">ID de Certificación</p>
                          <p style="margin: 0; color: #00d4aa; font-size: 16px; font-family: monospace; font-weight: 600;">${data.tbtId}</p>
                        </td>
                      </tr>
                      
                      <!-- Creator -->
                      <tr>
                        <td style="padding-bottom: 16px;">
                          <p style="margin: 0 0 4px 0; color: #a0a0b0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Creador</p>
                          <p style="margin: 0; color: #ffffff; font-size: 16px;">${data.creatorName}</p>
                        </td>
                      </tr>
                      
                      <!-- Category & Date Row -->
                      <tr>
                        <td>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr>
                              <td width="50%" style="padding-bottom: 16px;">
                                <p style="margin: 0 0 4px 0; color: #a0a0b0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Categoría</p>
                                <p style="margin: 0; color: #ffffff; font-size: 14px;">${data.category}</p>
                              </td>
                              <td width="50%" style="padding-bottom: 16px;">
                                <p style="margin: 0 0 4px 0; color: #a0a0b0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Certificado</p>
                                <p style="margin: 0; color: #ffffff; font-size: 14px;">${data.certifiedDate}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      
                      <!-- Price (if available) -->
                      ${data.price ? `
                      <tr>
                        <td style="padding-bottom: 16px;">
                          <p style="margin: 0 0 4px 0; color: #a0a0b0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Valor</p>
                          <p style="margin: 0; color: #00d4aa; font-size: 18px; font-weight: 600;">$${data.price} ${data.currency || 'USD'}</p>
                        </td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Action Buttons -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding-top: 30px;">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <a href="${data.tbtUrl}" style="display: inline-block; background: linear-gradient(135deg, #ff6b35 0%, #f7931a 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                      Ver mi Certificado TBT
                    </a>
                  </td>
                </tr>
                
                ${data.solscanUrl ? `
                <tr>
                  <td align="center">
                    <a href="${data.solscanUrl}" style="display: inline-block; background: transparent; color: #9945FF; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; border: 1px solid #9945FF;">
                      🔗 Ver en Solana (SolScan)
                    </a>
                  </td>
                </tr>
                ` : ''}
              </table>
              
              ${data.mintAddress ? `
              <!-- NFT Address -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding-top: 24px;">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 8px 0; color: #a0a0b0; font-size: 12px;">Dirección NFT en Solana:</p>
                    <p style="margin: 0; color: #9945FF; font-size: 12px; font-family: monospace; word-break: break-all; background: #0d0d15; padding: 12px; border-radius: 8px;">
                      ${data.mintAddress}
                    </p>
                  </td>
                </tr>
              </table>
              ` : ''}
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding-top: 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 8px 0; color: #606070; font-size: 14px;">
                      Tu obra está ahora protegida y verificable en la blockchain de Solana.
                    </p>
                    <p style="margin: 0 0 16px 0; color: #606070; font-size: 12px;">
                      Puedes compartir el enlace de tu certificado con cualquier persona.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 20px; border-top: 1px solid #2d2d44;">
                    <p style="margin: 0; color: #404050; font-size: 12px;">
                      © ${new Date().getFullYear()} TBT - Token Basado en Trabajo<br>
                      Powered by BROCHA & Transbit
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

// Plain text version
function generatePlainTextEmail(data: {
  title: string
  tbtId: string
  creatorName: string
  category: string
  certifiedDate: string
  price?: string
  currency?: string
  tbtUrl: string
  solscanUrl?: string
  mintAddress?: string
}) {
  return `
¡Tu TBT está certificado!

Gracias por proteger tu obra con TBT.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DETALLES DE TU CERTIFICACIÓN

📜 Obra: "${data.title}"
🆔 ID: ${data.tbtId}
👤 Creador: ${data.creatorName}
🏷️ Categoría: ${data.category}
📅 Certificado: ${data.certifiedDate}
${data.price ? `💰 Valor: $${data.price} ${data.currency || 'USD'}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENLACES IMPORTANTES

🔗 Ver tu certificado TBT:
${data.tbtUrl}

${data.solscanUrl ? `⛓️ Ver en Solana (SolScan):
${data.solscanUrl}` : ''}

${data.mintAddress ? `📍 Dirección NFT:
${data.mintAddress}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tu obra está ahora protegida y verificable en la blockchain de Solana.
Puedes compartir el enlace de tu certificado con cualquier persona.

© ${new Date().getFullYear()} TBT - Token Basado en Trabajo
Powered by BROCHA & Transbit
  `.trim()
}

export async function POST(request: NextRequest) {
  /*
   * Fuera del try a proposito: el catch exterior necesita saber a quien se le
   * estaba escribiendo para poder anotar el fallo. Si ni siquiera se llego a
   * leer el cuerpo, se queda nulo y no se inventa una fila.
   */
  let parsed: SendEmailRequest | null = null

  try {
    /*
     * La sesion primero. La rama de abajo respondia antes de mirar quien
     * llamaba, asi que cualquiera podia preguntarle a esta ruta si hay
     * proveedor de correo configurado.
     */
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { supabase, user } = auth

    /*
     * La comprobación del proveedor va MÁS ABAJO, después de saber de qué obra
     * se habla.
     *
     * Estaba aquí, y desde aquí no se puede anotar nada: `workId` y `userId`
     * llegan en el cuerpo, que todavía no se ha leído. Una fila de entrega sin
     * obra ni destinatario no responde a la única pregunta que se le hace al
     * libro —«¿salió el certificado de ESTA obra?»—, así que la rama se movió
     * en lugar de registrar huecos.
     *
     * Lo que no se mueve es la sesión: sigue siendo lo primero, para que un
     * extraño no pueda preguntarle a esta ruta si hay proveedor configurado.
     * Bajarla sólo refuerza esa propiedad.
     */

    // Parse request body
    const body: SendEmailRequest = await request.json()
    parsed = body
    const { email, workId, userId, mintAddress, solscanUrl } = body

    if (!email || !workId || !userId) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: email, workId, userId' },
        { status: 400 }
      )
    }

    // Verify the caller is the user the notification is for
    if (user.id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get work details with creator info
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

    // Verify the caller is the creator of the work
    if ((work as any).creator_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const certificateUrl = `${process.env.NEXT_PUBLIC_APP_URL}/work/${work.tbt_id}`

    if (!process.env.RESEND_API_KEY) {
      /*
       * Simular no es enviar. Esta rama devolvía éxito, y complete-tbt registra
       * `emailSent` a partir de esta respuesta: por eso nadie supo nunca que los
       * correos de certificación no salían. Mismo fallo que el MMS, misma
       * corrección — en producción se dice, fuera de producción se simula y se
       * marca como tal.
       *
       * Y ahora ambas dejan rastro, cada una con su nombre: en producción esto
       * es un fallo de entrega, y fuera de ella es un simulacro. Un libro que
       * anotase las dos como envío repetiría el fallo que vino a registrar.
       */
      console.error('⚠️ Resend not configured — the email was NOT sent.')
      if (isProduction) {
        await recordDelivery({
          workId, userId, email, status: 'failed', certificateUrl,
          errorMessage: 'no_email_provider: RESEND_API_KEY is not configured',
        })
        return NextResponse.json(
          { error: 'no_email_provider', message: 'No email provider is configured.' },
          { status: 502 }
        )
      }
      await recordDelivery({ workId, userId, email, status: 'simulated', certificateUrl })
      return NextResponse.json({
        success: true,
        simulated: true,
        message: 'Email simulado (Resend no configurado)',
      })
    }

    // Get creator name
    const creatorData = work.creator as any
    const creatorName = Array.isArray(creatorData) 
      ? (creatorData[0]?.public_alias || creatorData[0]?.display_name || 'Artista')
      : (creatorData?.public_alias || creatorData?.display_name || 'Artista')

    // Get commerce data
    const commerce = Array.isArray(work.work_commerce) 
      ? work.work_commerce[0] 
      : work.work_commerce

    // Format certified date
    const certifiedDate = work.certified_at 
      ? new Date(work.certified_at).toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
      : new Date().toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })

    // Build email data
    const emailData = {
      title: work.title,
      tbtId: work.tbt_id,
      creatorName,
      category: work.category || 'Arte',
      certifiedDate,
      price: commerce?.initial_price?.toString(),
      currency: commerce?.currency || 'USD',
      mediaUrl: work.media_url,
      tbtUrl: certificateUrl,
      solscanUrl: solscanUrl || undefined,
      mintAddress: mintAddress || undefined,
    }

    const fromName = process.env.RESEND_FROM_NAME || 'tbt.cafe'
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@tbt.cafe'

    try {
      /*
       * Resend NO lanza cuando rechaza: devuelve { data, error }. Un try/catch
       * por sí solo daría por enviado lo que no salió, que es exactamente cómo
       * esta ruta pasó meses reportando éxito sin mandar nada.
       */
      const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: email,
        subject: `🎨 ¡Tu TBT "${work.title}" está certificado!`,
        text: generatePlainTextEmail(emailData),
        html: generateEmailTemplate(emailData),
      })

      if (error) {
        console.error('📧 Resend refused the message:', error.name, error.message)
        await recordDelivery({
          workId, userId, email, status: 'failed', certificateUrl,
          errorMessage: `${error.name}: ${error.message}`,
        })
        return NextResponse.json(
          { error: 'delivery_failed', name: error.name, message: error.message },
          { status: 502 }
        )
      }

      console.log('📧 Email accepted by Resend for:', email)

      /*
       * ACEPTADO NO ES ENTREGADO. Resend responde con un id en cuanto toma el
       * mensaje y decide después si pudo entregarlo, igual que Twilio. Aquí se
       * anota 'sent' porque es lo que se sabe; `delivered_at` queda nula hasta
       * que exista el webhook que la cierre.
       */
      await recordDelivery({
        workId, userId, email, status: 'sent', certificateUrl,
        resendMessageId: data?.id ?? null,
      })

      return NextResponse.json({
        success: true,
        message: 'Email enviado exitosamente',
        messageId: data?.id,
      })
    } catch (sendError: any) {
      // Resend rechaza devolviendo `error`, no lanzando; llegar aqui es que
      // fallo la llamada misma.
      console.error('[send-email] la llamada a Resend fallo:', sendError)
      await recordDelivery({
        workId, userId, email, status: 'failed', certificateUrl,
        errorMessage: sendError?.message ?? 'the call to Resend failed',
      })

      return NextResponse.json(
        { error: 'Error al enviar email' },
        { status: 500 }
      )
    }

  } catch (error: any) {
    console.error('Error in send-email:', error)

    /*
     * Un fallo antes de llegar a Resend —la obra no carga, la plantilla
     * revienta— tambien es un certificado que no salio. Sin esta linea el libro
     * solo sabe de los fallos del proveedor, y un correo que murio antes es
     * indistinguible de uno que nadie intento enviar.
     */
    if (parsed?.email) {
      await recordDelivery({
        workId: parsed.workId ?? null,
        userId: parsed.userId ?? null,
        email: parsed.email,
        status: 'failed',
        errorMessage: error?.message ?? 'send-email failed before reaching the provider',
      })
    }

    return NextResponse.json(
      { error: 'Error al procesar solicitud de email' },
      { status: 500 }
    )
  }
}
