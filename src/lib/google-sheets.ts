import { google } from 'googleapis'

/**
 * Normaliza la clave privada de la cuenta de servicio.
 *
 * Esta variable se rompe al pegarla, y siempre de las mismas formas. Hoy en
 * produccion no se puede parsear —OpenSSL responde `DECODER routines::
 * unsupported`— y la validacion de cupones esta caida por eso: cualquier codigo
 * real se rechaza.
 *
 * El codigo solo deshacia los escapes. Eso deja fuera los dos descuidos mas
 * comunes:
 *
 *   comillas envolventes   copiar el campo desde el JSON de la cuenta de
 *                          servicio se lleva las comillas, y un PEM que empieza
 *                          por comilla no es un PEM.
 *   base64                 pegar la clave entera codificada, que es lo que
 *                          recomiendan varias guias para esquivar el problema
 *                          de los saltos de linea.
 *
 * Y OpenSSL exige salto de linea final, que un copiar-pegar se come.
 *
 * Nada de esto adivina una clave que no esta: si el valor no es una clave, sigue
 * fallando. Lo que cambia es que deja de fallar por como se pego.
 */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim()

  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }

  key = key.replace(/\\n/g, '\n')

  if (!key.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8')
      if (decoded.includes('-----BEGIN')) key = decoded
    } catch {
      // No era base64. Se deja como estaba y el diagnostico lo dira.
    }
  }

  return key.endsWith('\n') ? key : key + '\n'
}

/**
 * Que le pasa a la clave, dicho sin imprimirla.
 *
 * Va al log del servidor, nunca a la respuesta: quien llama a esta ruta no
 * tiene sesion, y describirle la forma de una credencial es contarle algo que
 * no le toca.
 */
function diagnosePrivateKey(key: string): string | null {
  if (!key.includes('-----BEGIN')) return 'sin cabecera PEM: el valor no parece una clave'
  if (!key.includes('-----END')) return 'sin cierre PEM: la clave llego truncada'
  if (key.split('\n').length < 3) return 'sin saltos de linea: se perdieron al pegarla'
  return null
}

export async function validateCouponCode(code: string) {
  try {
    // Check if configuration is present
    if (
      !process.env.GOOGLE_SHEETS_CLIENT_EMAIL ||
      !process.env.GOOGLE_SHEETS_PRIVATE_KEY ||
      !process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    ) {
      console.warn('Google Sheets configuration missing')
      return { 
        valid: false, 
        error: 'Configuration missing',
        details: 'Google Sheets credentials not set' 
      }
    }

    const privateKey = normalizePrivateKey(process.env.GOOGLE_SHEETS_PRIVATE_KEY)
    const keyProblem = diagnosePrivateKey(privateKey)
    if (keyProblem) {
      console.error(`[google-sheets] GOOGLE_SHEETS_PRIVATE_KEY ${keyProblem}`)
      return { valid: false, error: 'provider_unavailable' }
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })

    const sheets = google.sheets({ version: 'v4', auth })
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    
    // Assume codes are in "Sheet1!A:C" -> Code, DiscountType, Value
    // Example: "CODE10", "percentage", "10" 
    // or "FREE", "percentage", "100"
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:C', 
    })

    const rows = response.data.values
    
    if (!rows || rows.length === 0) {
      return { valid: false, error: 'No codes found' }
    }

    // Find the code (case insensitive)
    const discountRow = rows.find((row) => row[0]?.toString().trim().toUpperCase() === code.trim().toUpperCase())

    if (!discountRow) {
      return { valid: false, error: 'Invalid code' }
    }

    // Determine discount
    // Column B: Type (percentage, fixed)
    // Column C: Value (e.g., 100, 20)
    
    const type = discountRow[1]?.toLowerCase() || 'percentage'
    const value = parseFloat(discountRow[2] || '0')
    const isActive = discountRow[3] ? discountRow[3].toLowerCase() === 'true' : true // logic for active flag if needed, currently implied active if present

    // Basic validation on value
    if (isNaN(value)) {
       return { valid: false, error: 'Invalid discount configuration' }
    }

    return {
      valid: true,
      code: discountRow[0],
      type,
      value,
      isActive
    }

  } catch (error) {
    /**
     * El detalle va al log, no a la respuesta.
     *
     * Antes se devolvia el mensaje de la excepcion tal cual, asi que esta ruta
     * —que no pide sesion— publicaba el error interno: es como se vio desde
     * fuera que la clave no se podia decodificar. La interfaz nunca uso este
     * campo, muestra "cupon invalido" pase lo que pase, de modo que no se
     * pierde nada legible.
     */
    console.error('[google-sheets] no se pudo validar el cupon:', error)
    return { valid: false, error: 'provider_unavailable' }
  }
}
