/**
 * La enmienda que supersede — Chain Implementation Spec 01, Item 5.
 *
 * La ruta de works ya lo prometia en su cabecera: no hay forma de quitar el
 * registro de un TBT ni de reescribir una registracion, «lo que si se puede es
 * anotar y emitir un correctivo que supersede sin borrar». Esto es el
 * correctivo.
 *
 * TRES TIEMPOS, COMO TODA ACCION DE ALTO RIESGO
 *
 * Alguien la pide con un motivo, otra persona la aprueba, y quien la pidio la
 * aplica con el `approvalId`. Solo el tercer paso publica. Y las dos identidades
 * quedan DENTRO del registro publicado, en seudonimo: lo que impide que este
 * camino se vuelva una reescritura silenciosa es que cada reescritura es
 * permanente, fechada por Bitcoin, y lleva el motivo de una persona en sus
 * propias palabras.
 *
 * SOLO LA CLASE MINOR
 *
 * Titulo, año, categoria, tecnica, serie, ciudad, pais y la redaccion del
 * Contexto. La identidad del creador y la declaracion de originalidad son la
 * clase `authorship`, que el spec deja expresamente sin construir: si la obra
 * superseida ya se vendio, quedan en el aire si la regalia sigue a la autoria,
 * que tiene el coleccionista y si la venta se sostiene. Pregunta 30.
 *
 * Y el hash del contenido no lo cambia nadie. Otro archivo es otra obra y
 * necesita otro TBT.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, gateHighRisk, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'
import { amendRecord, amendmentDiff, MINOR_FIELDS, type MinorPatch } from '@/lib/chain/amend'
import { recordHash } from '@/lib/chain/serialize'
import { pseudonymFor } from '@/lib/chain/pseudonym'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = {
  tbtId?: string
  patch?: MinorPatch
  /** La serie va por id, nunca por texto: cambiarla es mover la obra, no renombrar. */
  seriesId?: string
  reason?: string
  approvalId?: string
}

/**
 * Trae el registro vigente de Arweave y comprueba que es el que decimos.
 *
 * No se enmienda lo que no se puede reproducir. Si los bytes servidos no
 * hashean a lo que guardamos, o el registro ya no esta, la enmienda se para
 * aqui: superseder algo que no se puede leer publicaria una cadena rota, y eso
 * tampoco se puede deshacer.
 */
async function fetchCurrentRecord(uri: string, expectedHash: string): Promise<Record<string, unknown>> {
  const res = await fetch(uri, { cache: 'no-store' })
  if (!res.ok) throw new Error(`amend: el registro vigente no responde (${res.status}).`)

  const record = (await res.json()) as Record<string, unknown>
  const got = recordHash(record)
  if (got !== expectedHash) {
    throw new Error(`amend: el registro servido hashea a ${got.slice(0, 12)}… y guardamos ${expectedHash.slice(0, 12)}….`)
  }
  return record
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body
    const tbtId = body.tbtId?.trim()
    const reason = body.reason?.trim()

    if (!tbtId) return NextResponse.json({ error: 'tbtId required' }, { status: 400 })
    if (!reason) {
      // El motivo se PUBLICA. No es un desplegable ni una nota interna.
      return NextResponse.json({ error: 'reason_required' }, { status: 400 })
    }

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

    const admin = await loadAdmin(auth.supabase, auth.user.id)
    if (!can(admin, 'works.amend')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }

    const service = createAdminClient()

    const { data: work } = await service
      .from('works')
      .select('id, tbt_id, creator_id, title, category, technique, creation_date, context_summary, series_id, mint_address, registration_record_uri, registration_record_hash')
      .eq('tbt_id', tbtId)
      .single()

    if (!work) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!work.registration_record_uri || !work.registration_record_hash) {
      // Las obras anteriores a la cadena no tienen registro que superseder. Una
      // enmienda sobre ellas no seria una correccion, seria un origen.
      return NextResponse.json({ error: 'no_registration_record' }, { status: 409 })
    }

    // La serie se resuelve del lado del servidor y tiene que ser del mismo
    // creador: el nombre que va al registro no lo escribe quien enmienda.
    const patch: MinorPatch = { ...(body.patch ?? {}) }
    let nextSeriesId: string | null = null

    if (body.seriesId) {
      const { data: series } = await service
        .from('work_series')
        .select('id, name, creator_id')
        .eq('id', body.seriesId)
        .single()
      if (!series || series.creator_id !== work.creator_id) {
        return NextResponse.json({ error: 'series_not_found' }, { status: 400 })
      }
      patch.series = series.name
      nextSeriesId = series.id
    }

    const bad = Object.keys(patch).filter((k) => !(MINOR_FIELDS as readonly string[]).includes(k))
    if (bad.length) return NextResponse.json({ error: `not_minor: ${bad.join(', ')}` }, { status: 400 })

    const gate = await gateHighRisk(auth.supabase, {
      actor: admin!,
      action: 'work.amend',
      entityType: 'work',
      entityId: tbtId,
      payload: { tbtId, patch, seriesId: body.seriesId ?? null },
      reason,
      approvalId: body.approvalId,
    })

    if (!gate.proceed) {
      return NextResponse.json({ pending: true, approvalId: gate.pendingId, message: gate.message }, { status: 202 })
    }
    if (!gate.approverId) {
      return NextResponse.json({ error: 'no_approver' }, { status: 409 })
    }

    const current = await fetchCurrentRecord(work.registration_record_uri, work.registration_record_hash)

    const amendment = amendRecord(current, patch, {
      supersedes: work.registration_record_uri,
      reason,
      decidedBy: {
        initiator: pseudonymFor(admin!.userId),
        approver: pseudonymFor(gate.approverId),
      },
    })

    const changed = amendmentDiff(current, amendment)
    if (!Object.keys(changed).length) {
      return NextResponse.json({ error: 'nothing_changed' }, { status: 400 })
    }

    // Publicar ANTES de tocar nada nuestro, por lo mismo que en el Item 6: lo
    // que la base y la cadena van a nombrar tiene que existir ya.
    const { publishRecord } = await import('@/lib/chain/arweave')
    const published = await publishRecord(amendment as never)

    const { error: insertError } = await service.from('work_amendments').insert({
      work_id: work.id,
      tbt_id: work.tbt_id,
      sequence_number: amendment.sequence as number,
      record_uri: published.uri,
      record_hash: published.hash,
      supersedes_uri: work.registration_record_uri,
      supersedes_hash: work.registration_record_hash,
      amendment_class: 'minor',
      amendment_reason: reason,
      changed,
      initiated_by: admin!.userId,
      approved_by: gate.approverId,
      approval_id: body.approvalId ?? null,
    })
    if (insertError) throw new Error(`amend: no se pudo anotar la enmienda — ${insertError.message}`)

    /*
     * La cabeza de la cadena pasa a ser la enmienda, y las columnas vivas se
     * corrigen con ella.
     *
     * Van juntas a proposito. Si la fila dijera una cosa y el registro otra, la
     * pagina de la obra y su certificado se contradirian, que es exactamente lo
     * que una correccion viene a evitar.
     */
    const patchWork: Record<string, unknown> = {
      registration_record_uri: published.uri,
      registration_record_hash: published.hash,
    }
    if (patch.title !== undefined) patchWork.title = patch.title.trim()
    if (patch.category !== undefined) patchWork.category = patch.category.trim() || null
    if (patch.technique !== undefined) patchWork.technique = patch.technique.trim() || null
    if (patch.statement !== undefined) patchWork.context_summary = patch.statement.trim() || null
    if (nextSeriesId) patchWork.series_id = nextSeriesId

    // El año corrige la fecha de creacion conservando dia y mes. Si no hay
    // fecha, no se inventa una: el registro lleva el año correcto y la fila
    // sigue derivandolo de cuando se creo.
    let yearApplied = false
    if (patch.year !== undefined && work.creation_date) {
      const d = new Date(work.creation_date)
      if (!Number.isNaN(d.getTime())) {
        d.setUTCFullYear(patch.year)
        patchWork.creation_date = d.toISOString().slice(0, 10)
        yearApplied = true
      }
    }

    const { error: workError } = await service.from('works').update(patchWork).eq('id', work.id)
    if (workError) throw new Error(`amend: no se pudo mover la cabeza de la cadena — ${workError.message}`)

    if (patch.city !== undefined) {
      await service
        .from('context_snapshots')
        .update({ location_name: patch.city.trim() || null })
        .eq('work_id', work.id)
    }

    /*
     * El puntero de Solana se mueve al final y NO tumba la enmienda.
     *
     * La parte permanente ya esta hecha: el registro esta publicado y anclado, y
     * nombra hacia atras al que supersede. Si el repunte falla, la cadena sigue
     * siendo caminable —desde el registro nuevo hacia el viejo— y el puntero se
     * puede mover despues. `repointed_at` nula es justo eso.
     */
    let repointed = false
    if (work.mint_address) {
      try {
        const { repointNft } = await import('@/lib/solana/nft')
        await repointNft(work.mint_address, published.uri)
        await service
          .from('work_amendments')
          .update({ repointed_at: new Date().toISOString() })
          .eq('record_hash', published.hash)
        repointed = true
      } catch (repointError) {
        console.error('[chain] la enmienda se publicó pero el NFT no se repuntó:', repointError)
      }
    }

    await writeAudit(auth.supabase, request, {
      actor: admin!,
      approverId: gate.approverId,
      action: 'work.amend',
      entityType: 'work',
      entityId: tbtId,
      before: { record: work.registration_record_uri, hash: work.registration_record_hash },
      after: { record: published.uri, hash: published.hash, changed, repointed, yearApplied },
      reason,
    })

    return NextResponse.json({
      ok: true,
      sequence: amendment.sequence,
      record: published.uri,
      hash: published.hash,
      supersedes: work.registration_record_uri,
      changed,
      repointed,
      // Se dice: una fila que la interfaz no explique se convierte en una
      // divergencia silenciosa entre lo que se ve y lo que hay en cadena.
      note: !repointed && work.mint_address ? 'published_but_not_repointed' : undefined,
    })
  } catch (error) {
    console.error('[admin/works/amend] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'amend_failed' },
      { status: 500 }
    )
  }
}
