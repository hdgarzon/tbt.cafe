/**
 * El pais que sugiere un telefono — Work Order 02, Stage 2.4.
 *
 * Solo una sugerencia: la persona lo confirma o elige otro en la solicitud.
 * Cubre los paises de `provider_countries` (059). El +1 compartido se resuelve
 * a Estados Unidos salvo los prefijos de area de Republica Dominicana y
 * Jamaica; un canadiense lo cambia en la lista.
 */
const CODES: Record<string, string> = {
  '971': 'AE', '374': 'AM', '54': 'AR', '43': 'AT', '61': 'AU', '994': 'AZ', '32': 'BE', '359': 'BG',
  '973': 'BH', '229': 'BJ', '55': 'BR', '41': 'CH', '56': 'CL', '57': 'CO', '506': 'CR', '357': 'CY',
  '420': 'CZ', '49': 'DE', '45': 'DK', '593': 'EC', '372': 'EE', '34': 'ES', '358': 'FI', '33': 'FR',
  '44': 'GB', '233': 'GH', '350': 'GI', '30': 'GR', '852': 'HK', '385': 'HR', '36': 'HU', '353': 'IE',
  '972': 'IL', '39': 'IT', '962': 'JO', '81': 'JP', '254': 'KE', '82': 'KR', '965': 'KW', '7': 'KZ',
  '423': 'LI', '94': 'LK', '370': 'LT', '352': 'LU', '371': 'LV', '976': 'MN', '356': 'MT', '230': 'MU',
  '52': 'MX', '60': 'MY', '31': 'NL', '47': 'NO', '64': 'NZ', '507': 'PA', '51': 'PE', '63': 'PH',
  '48': 'PL', '351': 'PT', '595': 'PY', '40': 'RO', '966': 'SA', '46': 'SE', '65': 'SG', '386': 'SI',
  '421': 'SK', '503': 'SV', '66': 'TH', '216': 'TN', '598': 'UY', '998': 'UZ', '27': 'ZA',
}

const NANP_OTHER: Record<string, string> = { '809': 'DO', '829': 'DO', '849': 'DO', '876': 'JM' }

export function countryFromPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, '')
  if (!phone.trim().startsWith('+') || !digits) return null
  if (digits.startsWith('1')) return NANP_OTHER[digits.slice(1, 4)] ?? 'US'
  for (let len = 3; len >= 1; len--) {
    const hit = CODES[digits.slice(0, len)]
    if (hit) return hit
  }
  return null
}
