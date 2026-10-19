/**
 * Entrega fisica: las reglas de publicar y de comprar — Work Order 02,
 * Amendment Delivery 01 (decision 94), Stages 2–3 y 0/4.
 *
 * Funciones puras, sin red ni base: las usan la ruta y la hoja de compra, asi
 * que el navegador y el servidor no pueden decidir distinto. El servidor manda
 * de todos modos: la hoja solo decide que PEDIR.
 *
 * APAGADO HASTA QUE LOS TEXTOS ESTEN APROBADOS. La decision 75 dice que ninguna
 * regla opera antes de que su texto publico lo diga, y los textos de esta
 * enmienda estan en blanco: van como marcadores para que el arquitecto los
 * apruebe en los cuatro idiomas. Con `DELIVERY_LIVE = false` publicar y comprar
 * funcionan como antes. Encenderlo es un cambio de codigo revisado, y
 * `check:deliveryflow` falla si se enciende con un solo marcador en los
 * catalogos.
 */
export const DELIVERY_LIVE = false

/** El marcador de un texto que espera aprobacion. Nunca llega a una pantalla mientras DELIVERY_LIVE sea false. */
export const PENDING_WORDING = '[pending approval]'

export type WorkKind = 'physical' | 'digital'
export type DeliveryChoice = 'deliver' | 'collect' | 'none' | 'digital'

/** Una direccion de entrega. Solo existe con "entregamelo", y solo la ven las dos partes y los operadores. */
export type DeliveryAddress = {
  name: string
  line1: string
  line2?: string
  city: string
  region?: string
  postalCode?: string
  country: string
}

export type DeliveryInput = {
  choice?: DeliveryChoice | null
  address?: Partial<DeliveryAddress> | null
  consent?: boolean
}

export type DeliveryPlan =
  | { ok: true; choice: DeliveryChoice; workKind: WorkKind; address: DeliveryAddress | null; consent: boolean }
  | { ok: false; error: 'delivery_choice_required' | 'address_required' | 'consent_required' }

const MAX = 200
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, MAX) : '')

/**
 * La entrega de una compra. Una obra sin clase —publicada antes de la 079— se
 * trata como fisica: se le pregunta al comprador, nunca se supone digital. Una
 * obra digital nunca pide direccion. "Entregamelo" exige la direccion y el
 * consentimiento de pasarla al vendedor; las otras dos elecciones no guardan
 * ninguna aunque llegue.
 */
export function planDelivery(workKind: WorkKind | null | undefined, input: DeliveryInput | null | undefined): DeliveryPlan {
  const kind: WorkKind = workKind === 'digital' ? 'digital' : 'physical'
  if (kind === 'digital') return { ok: true, choice: 'digital', workKind: kind, address: null, consent: false }

  const choice = input?.choice
  if (choice !== 'deliver' && choice !== 'collect' && choice !== 'none') return { ok: false, error: 'delivery_choice_required' }
  if (choice !== 'deliver') return { ok: true, choice, workKind: kind, address: null, consent: false }

  const a = input?.address ?? {}
  const address: DeliveryAddress = {
    name: clean(a.name),
    line1: clean(a.line1),
    city: clean(a.city),
    country: clean(a.country).toUpperCase(),
    ...(clean(a.line2) ? { line2: clean(a.line2) } : {}),
    ...(clean(a.region) ? { region: clean(a.region) } : {}),
    ...(clean(a.postalCode) ? { postalCode: clean(a.postalCode) } : {}),
  }
  if (!address.name || !address.line1 || !address.city || !/^[A-Z]{2}$/.test(address.country)) return { ok: false, error: 'address_required' }
  if (input?.consent !== true) return { ok: false, error: 'consent_required' }
  return { ok: true, choice, workKind: kind, address, consent: true }
}

export type ListingPlan =
  | { ok: true; workKind: WorkKind | null; recordSellerAck: boolean }
  | { ok: false; error: 'work_kind_required' | 'seller_ack_required' }

/**
 * Poner una obra a la venta. Pide la clase de la obra (si aun no la tiene) y,
 * en la primera publicacion de quien vende, su reconocimiento: una vez, no en
 * cada venta. Quitarla de la venta no pide nada.
 */
export function planListing(f: {
  forSale: boolean
  currentKind: WorkKind | null | undefined
  patchKind: WorkKind | null | undefined
  sellerAcknowledgedBefore: boolean
  acknowledgedNow: boolean
}): ListingPlan {
  const patch = f.patchKind === 'physical' || f.patchKind === 'digital' ? f.patchKind : null
  if (!f.forSale) return { ok: true, workKind: patch, recordSellerAck: false }
  const kind = patch ?? (f.currentKind === 'physical' || f.currentKind === 'digital' ? f.currentKind : null)
  if (!kind) return { ok: false, error: 'work_kind_required' }
  if (!f.sellerAcknowledgedBefore && !f.acknowledgedNow) return { ok: false, error: 'seller_ack_required' }
  return { ok: true, workKind: patch, recordSellerAck: !f.sellerAcknowledgedBefore }
}

export type DigitalMethod = 'download_link' | 'file_sent' | 'email'
export const DIGITAL_METHODS: readonly DigitalMethod[] = ['download_link', 'file_sent', 'email']

export type DeliveryDetailsInput = { carrier?: string; tracking?: string; method?: string; note?: string }

export type DeliveryDetailsPlan =
  | { ok: true; kind: 'carrier' | 'collected' | 'digital'; details: Record<string, string> }
  | { ok: false; error: 'carrier_required' | 'method_required' | 'no_details_needed' }

/**
 * Los datos que da quien vende despues de la venta (Stage 7). El tipo lo da lo
 * que eligio el comprador, nunca lo que mande el navegador: con "entregamelo",
 * transportista y guia; con "lo recojo", la confirmacion de la recogida, sin
 * campos; con una obra digital, como se envio. "No hace falta entrega" no pide
 * nada. La base vuelve a derivar el tipo de la eleccion (submit_delivery_details).
 */
export function planDeliveryDetails(choice: DeliveryChoice, input: DeliveryDetailsInput | null | undefined): DeliveryDetailsPlan {
  if (choice === 'none') return { ok: false, error: 'no_details_needed' }
  if (choice === 'collect') return { ok: true, kind: 'collected', details: {} }
  if (choice === 'digital') {
    const method = clean(input?.method)
    if ((DIGITAL_METHODS as readonly string[]).indexOf(method) === -1) return { ok: false, error: 'method_required' }
    const note = clean(input?.note)
    return { ok: true, kind: 'digital', details: { method, ...(note ? { note } : {}) } }
  }
  const carrier = clean(input?.carrier)
  const tracking = clean(input?.tracking)
  if (!carrier || !tracking) return { ok: false, error: 'carrier_required' }
  return { ok: true, kind: 'carrier', details: { carrier, tracking } }
}
