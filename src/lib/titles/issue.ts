import type { SupabaseClient } from '@supabase/supabase-js'
import { recordProviderEvent } from '@/lib/provider-events'

/**
 * Emitir un título — Work Order 01 Stage 5, a Title Specification 02.
 *
 * Tres pasos, en este orden a propósito:
 *
 *   1. La fila. Se escribe primero, con lo que el título imprime congelado en
 *      `facts` y el hecho que lo emite en `source_key`. El índice único de la
 *      054 hace que un reintento —complete-tbt y complete-transfer se llaman
 *      más de una vez— encuentre la fila y no emita un segundo título.
 *   2. El render. El renderer en Fly devuelve el GIF, el PNG del cuadro cero y
 *      el WebP. Desde `facts` sale byte a byte igual cada vez (§4 a), así que
 *      si falla aquí la fila queda y el render se puede repetir sin perder nada.
 *   3. Los archivos, al bucket privado `titles`, y sus hashes a `title_files`.
 *
 * La entrega —SMS y e-Mail con el enlace— es otro paso y otra función: una
 * fila con archivos y `delivery_state: 'pending'` es un título emitido que
 * todavía no se avisó, que es un estado normal y no un fallo.
 *
 * Nunca lanza. Para cuando esto corre la obra ya es del titular; un problema
 * del render no puede deshacer la propiedad.
 */

export type TitleEvent = 'REGISTERED' | 'PURCHASED' | 'TRANSFERRED' | 'AUTHENTICATED'

export const TITLE_LINK_DAYS = 30
const RENDER_TIMEOUT_MS = 120_000

/** Lo que el renderer imprime. Es la entrada exacta de su POST /render. */
export type TitleFacts = {
  tbt_id: string
  owner_index: number
  work_title: string
  creator_name: string | null
  holder_name: string | null
  event: TitleEvent
  event_date: string // YYYY-MM-DD
  bonded: boolean
  signature: number[][][]
}

export type IssueInput = {
  workId: string
  holderId: string
  event: TitleEvent
  eventDate: Date
  /** El hecho que emite el título: `registration:<workId>`, `transfer:<transferId>`. */
  sourceKey: string
}

export type IssueOutcome =
  | { status: 'issued'; titleId: string; titleNumber: string }
  | { status: 'already_issued'; titleId: string; titleNumber: string }
  | { status: 'pending_render'; titleId: string; titleNumber: string; reason: string }
  | { status: 'failed'; reason: string }

/*
 * La fecha del evento en UTC. La zona horaria de la fecha impresa es una
 * pregunta abierta a Federico; mientras tanto se fija en UTC y queda congelada
 * en `facts`, así que cambiarla después solo afecta a los títulos nuevos.
 */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function displayName(p: { public_alias?: string | null; display_name?: string | null } | null): string | null {
  return p?.public_alias?.trim() || p?.display_name?.trim() || null
}

/*
 * El titular, como lo imprime el título. Un coleccionista anónimo sale como
 * holder_name null: el renderer imprime entonces su texto para un titular
 * privado. La palabra exacta es otra pregunta abierta a Federico, y Work Order
 * 02 (M19, 0.8a) moverá esta elección del perfil al movimiento.
 */
function holderName(
  p: { public_alias?: string | null; display_name?: string | null; collector_alias?: string | null; collector_anonymous?: boolean | null } | null,
  isCreator: boolean,
): string | null {
  if (!p) return null
  if (!isCreator && p.collector_anonymous) return null
  if (!isCreator && p.collector_alias?.trim()) return p.collector_alias.trim()
  return displayName(p)
}

function strokes(raw: unknown): number[][][] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is unknown[] => Array.isArray(s))
    .map((s) => s.filter((pt): pt is number[] => Array.isArray(pt) && pt.length >= 2).map((pt) => [Number(pt[0]), Number(pt[1])]))
    .filter((s) => s.length > 0)
}

type RenderResponse = {
  files: Record<string, string>
  sha256: { gif: string; png: string; webp: string }
  render_ms: number
}

async function render(facts: TitleFacts, imageUrl: string): Promise<RenderResponse> {
  const url = process.env.TBT_TITLE_RENDERER_URL
  const key = process.env.TBT_TITLE_RENDERER_API_KEY
  if (!url || !key) throw new Error('renderer_not_configured')
  const res = await fetch(`${url}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify({ facts, image_url: imageUrl }),
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`renderer_http_${res.status}`)
  return (await res.json()) as RenderResponse
}

/**
 * Renderiza y guarda los archivos de un título que ya tiene su fila. Se usa al
 * emitir y para completar uno que quedó sin render.
 */
export async function renderAndStore(admin: SupabaseClient, titleId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const started = Date.now()
  const { data: title } = await admin
    .from('titles')
    .select('id, work_id, version, title_number, facts, works(media_url)')
    .eq('id', titleId)
    .single()
  if (!title?.facts || !title.title_number) return { ok: false, reason: 'title_without_facts' }
  const work = (Array.isArray(title.works) ? title.works[0] : title.works) as { media_url: string | null } | null
  if (!work?.media_url) return { ok: false, reason: 'work_without_image' }

  let result: RenderResponse
  try {
    result = await render(title.facts as TitleFacts, work.media_url)
  } catch (error) {
    await recordProviderEvent({ provider: 'title_renderer', operation: 'render', ok: false, error, latencyMs: Date.now() - started, entityType: 'title', entityId: titleId })
    return { ok: false, reason: error instanceof Error ? error.message : 'render_failed' }
  }

  const base = `${title.work_id}/${title.version}/${title.title_number}`
  const kinds = [
    ['gif', 'image/gif'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const
  for (const [ext, type] of kinds) {
    const b64 = result.files[`${title.title_number}.${ext}`]
    if (!b64) return { ok: false, reason: `missing_${ext}` }
    const { error } = await admin.storage
      .from('titles')
      .upload(`${base}.${ext}`, Buffer.from(b64, 'base64'), { contentType: type, upsert: true })
    if (error) {
      await recordProviderEvent({ provider: 'title_renderer', operation: 'store', ok: false, error: { code: 'storage_upload', detail: error.message }, entityType: 'title', entityId: titleId })
      return { ok: false, reason: 'storage_upload' }
    }
  }

  const { error: filesError } = await admin.from('title_files').upsert({
    title_id: titleId,
    gif_path: `${base}.gif`,
    png_path: `${base}.png`,
    webp_path: `${base}.webp`,
    gif_sha256: result.sha256.gif,
    png_sha256: result.sha256.png,
    webp_sha256: result.sha256.webp,
    render_ms: result.render_ms,
    rendered_at: new Date().toISOString(),
    files_deleted_at: null,
  })
  if (filesError) return { ok: false, reason: 'title_files_write' }

  await recordProviderEvent({ provider: 'title_renderer', operation: 'render', ok: true, latencyMs: Date.now() - started, entityType: 'title', entityId: titleId })
  return { ok: true }
}

export async function issueTitle(admin: SupabaseClient, input: IssueInput): Promise<IssueOutcome> {
  try {
    const existing = await admin
      .from('titles')
      .select('id, title_number, title_files(title_id)')
      .eq('source_key', input.sourceKey)
      .maybeSingle()
    if (existing.data?.title_number) {
      const hasFiles = Array.isArray(existing.data.title_files) ? existing.data.title_files.length > 0 : !!existing.data.title_files
      if (hasFiles) return { status: 'already_issued', titleId: existing.data.id, titleNumber: existing.data.title_number }
      const retry = await renderAndStore(admin, existing.data.id)
      return retry.ok
        ? { status: 'issued', titleId: existing.data.id, titleNumber: existing.data.title_number }
        : { status: 'pending_render', titleId: existing.data.id, titleNumber: existing.data.title_number, reason: retry.reason }
    }

    const { data: work } = await admin
      .from('works')
      .select('id, tbt_id, title, creator_id, media_url, signature_strokes, creator:profiles!works_creator_id_fkey(public_alias, display_name)')
      .eq('id', input.workId)
      .single()
    if (!work?.tbt_id) return { status: 'failed', reason: 'work_without_tbt_id' }

    const { data: holder } = await admin
      .from('profiles')
      .select('public_alias, display_name, collector_alias, collector_anonymous')
      .eq('id', input.holderId)
      .single()

    // El índice del dueño cuenta tenencias, no personas: la última fila del
    // historial de la obra (UP01, la 051 retiró works.owner_index).
    const { data: lastHolding } = await admin
      .from('ownership_history')
      .select('sequence_number')
      .eq('work_id', input.workId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    const ownerIndex = Math.max(1, lastHolding?.sequence_number ?? 1)

    const { data: previous } = await admin
      .from('titles')
      .select('id, version')
      .eq('work_id', input.workId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const creator = Array.isArray(work.creator) ? work.creator[0] : work.creator
    const bonded = false // Los títulos bonded llegan con el registro por coleccionista (Step 20).
    const facts: TitleFacts = {
      tbt_id: work.tbt_id,
      owner_index: ownerIndex,
      work_title: work.title,
      creator_name: displayName(creator as { public_alias?: string | null; display_name?: string | null } | null),
      holder_name: holderName(holder, input.holderId === work.creator_id),
      event: input.event,
      event_date: isoDate(input.eventDate),
      bonded,
      // La copia congelada de la obra, nunca la del perfil (§5 c, f). Ausente en bonded (§5 d).
      signature: bonded ? [] : strokes(work.signature_strokes),
    }
    const titleNumber = `${work.tbt_id}-${ownerIndex}`
    const issuedAt = new Date()

    const { data: row, error } = await admin
      .from('titles')
      .insert({
        work_id: input.workId,
        owner_id: input.holderId,
        qr_code_data: `https://tbt.cafe/work/${work.tbt_id}`,
        version: (previous?.version ?? 0) + 1,
        supersedes: previous?.id ?? null,
        kind: bonded ? 'bonded' : 'standard',
        delivery_state: 'pending',
        title_number: titleNumber,
        event: input.event,
        event_date: facts.event_date,
        facts,
        source_key: input.sourceKey,
        issued_at: issuedAt.toISOString(),
        link_expires_at: new Date(issuedAt.getTime() + TITLE_LINK_DAYS * 86_400_000).toISOString(),
      })
      .select('id')
      .single()

    if (error || !row) {
      // Otra llamada ganó la carrera por el mismo hecho: su fila es la buena.
      if (error?.code === '23505') {
        const again = await admin.from('titles').select('id, title_number').eq('source_key', input.sourceKey).maybeSingle()
        if (again.data?.title_number) return { status: 'already_issued', titleId: again.data.id, titleNumber: again.data.title_number }
      }
      await recordProviderEvent({ provider: 'title_renderer', operation: 'issue', ok: false, error: { code: error?.code ?? 'no_row', detail: error?.message ?? null }, entityType: 'work', entityId: input.workId })
      return { status: 'failed', reason: 'title_insert' }
    }

    const stored = await renderAndStore(admin, row.id)
    return stored.ok
      ? { status: 'issued', titleId: row.id, titleNumber }
      : { status: 'pending_render', titleId: row.id, titleNumber, reason: stored.reason }
  } catch (error) {
    await recordProviderEvent({ provider: 'title_renderer', operation: 'issue', ok: false, error, entityType: 'work', entityId: input.workId })
    return { status: 'failed', reason: error instanceof Error ? error.message : 'issue_failed' }
  }
}
