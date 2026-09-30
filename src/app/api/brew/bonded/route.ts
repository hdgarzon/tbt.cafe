import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { keepContact } from '@/lib/contact-suppression'

/**
 * POST /api/brew/bonded — lo que un coleccionista declara de una obra que no hizo.
 *
 * Work Order 01 Step 20. Se llama con el borrador ya creado y antes del pago.
 * Todo se escribe aquí, con el service role:
 *   - lo que puede verse del creador, en bonded_creators;
 *   - lo que nunca se publica —contactos de terceros, procedencia, lo que se
 *     pagó, el documento— en bonded_private;
 *   - el documento, en el bucket privado `provenance`, y su hash en
 *     works.provenance_hash: a la cadena va la huella, no el recibo.
 *
 * Las dos reglas legales del Step 20 se aplican aquí y no en el navegador:
 * de un creador vivo solo ciudad y país, y ningún contacto de un tercero que
 * haya pedido no ser contactado (contact_suppressions).
 */
export const dynamic = 'force-dynamic'

const STATUSES = ['living', 'deceased', 'unknown'] as const
const CATEGORIES = ['individual', 'group', 'corporation'] as const
const DOC_TYPES = ['bill', 'gallery', 'auction', 'inherit', 'gift', 'none'] as const
const MAX_TEXT = 2000
const MAX_DOC_BYTES = 15 * 1024 * 1024

type Creator = {
  status?: string
  category?: string
  name?: string
  unattributed?: boolean
  alias?: string
  city?: string
  reachable?: string
  contact?: string
  credentials?: string
  website?: string
  instagram?: string
  about?: string
  estateName?: string
  estateRep?: string
  estateContact?: string
  docType?: string
  source?: string
  acquired?: string
  pricePaid?: string
  provenance?: string
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : null)

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const workId = String(form.get('workId') ?? '')
  let c: Creator
  try {
    c = JSON.parse(String(form.get('creator') ?? '{}')) as Creator
  } catch {
    return NextResponse.json({ error: 'invalid_creator' }, { status: 400 })
  }
  const doc = form.get('document')

  const status = STATUSES.find((s) => s === c.status)
  if (!status) return NextResponse.json({ error: 'status_required' }, { status: 400 })
  const category = CATEGORIES.find((s) => s === c.category) ?? 'individual'
  const unattributed = status === 'unknown' && c.unattributed === true
  const name = unattributed ? null : text(c.name)
  if (!unattributed && !name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const docType = DOC_TYPES.find((s) => s === c.docType) ?? null

  const admin = createAdminClient()
  const { data: work } = await admin.from('works').select('id, creator_id, status').eq('id', workId).maybeSingle()
  if (!work || work.creator_id !== auth.user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (work.status !== 'draft') return NextResponse.json({ error: 'not_a_draft' }, { status: 409 })

  const known = status === 'living' || status === 'deceased'
  // Contactos de terceros: solo donde el formulario los pide, y nunca uno suprimido.
  const creatorContact = status === 'living' && c.reachable === 'yes' ? await keepContact(admin, c.contact) : { value: null, suppressed: false }
  const estateContact = status === 'deceased' ? await keepContact(admin, c.estateContact) : { value: null, suppressed: false }

  let docPath: string | null = null
  let provenanceHash: string | null = null
  if (doc instanceof Blob && doc.size > 0 && docType && docType !== 'none') {
    if (doc.size > MAX_DOC_BYTES) return NextResponse.json({ error: 'document_too_large' }, { status: 413 })
    const bytes = Buffer.from(await doc.arrayBuffer())
    const hex = createHash('sha256').update(bytes).digest('hex')
    docPath = `${auth.user.id}/${workId}/${hex}`
    const { error: upErr } = await admin.storage
      .from('provenance')
      .upload(docPath, bytes, { contentType: doc.type || 'application/octet-stream', upsert: true })
    if (upErr) return NextResponse.json({ error: 'document_upload_failed' }, { status: 502 })
    provenanceHash = `sha256:${hex}`
  }

  const { error: pubErr } = await admin.from('bonded_creators').upsert({
    work_id: workId,
    status,
    category,
    name,
    unattributed,
    alias: unattributed ? null : text(c.alias),
    // Ciudad y país, nada más: nunca una dirección de un creador vivo.
    city: text(c.city),
    credentials: known ? text(c.credentials) : null,
    website: known ? text(c.website) : null,
    instagram: known ? text(c.instagram) : null,
    about: known ? text(c.about) : null,
    estate_name: status === 'deceased' ? text(c.estateName) : null,
    estate_rep: status === 'deceased' ? text(c.estateRep) : null,
  })
  if (pubErr) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  const { error: privErr } = await admin.from('bonded_private').upsert({
    work_id: workId,
    creator_contact: creatorContact.value,
    estate_contact: estateContact.value,
    doc_type: docType,
    source: text(c.source),
    acquired: text(c.acquired),
    price_paid: text(c.pricePaid),
    doc_path: docPath,
    provenance: text(c.provenance),
  })
  if (privErr) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  const { error: workErr } = await admin
    .from('works')
    .update({ registered_as: 'collector', ...(provenanceHash ? { provenance_hash: provenanceHash } : {}) })
    .eq('id', workId)
  if (workErr) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  return NextResponse.json({ saved: true, suppressed: creatorContact.suppressed || estateContact.suppressed })
}
