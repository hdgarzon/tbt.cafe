import { createHash } from 'crypto'
import en from '@/i18n/messages/en.json'

/**
 * La version de un reconocimiento de entrega (decision 94): la huella de su
 * texto en ingles, igual que `termsVersion()` con los Terms (0.8b). Si el texto
 * cambia, la version cambia, y la fila guardada dice que texto acepto cada uno.
 *
 * Solo en el servidor: usa `crypto`, y la hoja de compra no la necesita.
 */
export function deliveryAckVersion(kind: 'buyer_delivery' | 'seller_delivery'): string {
  const text = kind === 'buyer_delivery' ? en.delivery.buyerAck : en.delivery.sellerAck
  const prefix = kind === 'buyer_delivery' ? 'buyer-delivery-' : 'seller-delivery-'
  return prefix + createHash('sha256').update(text).digest('hex').slice(0, 12)
}
