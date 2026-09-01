import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * El libro de la obra — Chain Spec 01, Item 10 Change A.
 *
 * Publica: una obra certificada es publica y su cadena tambien. Lo que hay que
 * enseñar es precisamente que cualquiera puede comprobarlo sin nosotros.
 *
 * POR QUE UNA RUTA Y NO LECTURA DIRECTA
 *
 * `chain_anchors` tiene RLS activa y sin politicas —solo el service role—, asi
 * que el cliente no puede unirla por su cuenta. Abrirla entera daria acceso a
 * enumerar todas las anclas del sistema; esto devuelve las de UNA obra, con la
 * forma que la pagina necesita y nada mas.
 */
export const dynamic = 'force-dynamic'

type Anchor = {
  status: string
  blockHeight: number | null
  attestedAt: string | null
}

export async function GET(_request: NextRequest, props: { params: Promise<{ tbtId: string }> }) {
  const params = await props.params;
  try {
    const admin = createAdminClient()

    const { data: work } = await admin
      .from('works')
      .select('id, tbt_id, status, mint_address, certified_at, registration_record_uri, registration_record_hash')
      .eq('tbt_id', params.tbtId)
      .single()

    // Un borrador no tiene libro que enseñar, y su existencia no es publica.
    if (!work || work.status !== 'certified') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const { data: history } = await admin
      .from('ownership_history')
      .select('id, event_type, owner_name, previous_owner_name, transfer_type, sequence_number, created_at, record_uri, record_hash')
      .eq('work_id', work.id)
      .order('sequence_number', { ascending: false })

    // Las anclas de todos los hashes de esta obra, de una consulta.
    const hashes = [
      work.registration_record_hash,
      ...(history ?? []).map((h) => h.record_hash),
    ].filter(Boolean) as string[]

    const anchorsByHash = new Map<string, Anchor>()
    if (hashes.length > 0) {
      const { data: anchors } = await admin
        .from('chain_anchors')
        .select('record_hash, status, block_height, attested_at')
        .in('record_hash', hashes)

      for (const a of anchors ?? []) {
        anchorsByHash.set(a.record_hash, {
          status: a.status,
          blockHeight: a.block_height,
          attestedAt: a.attested_at,
        })
      }
    }

    /*
     * Dos columnas, como pide el spec: la registracion (y en su dia las
     * enmiendas) por un lado, la procedencia por otro. Ambas de mas reciente a
     * mas antigua.
     */
    return NextResponse.json({
      tbtId: work.tbt_id,
      mintAddress: work.mint_address,
      registration: work.registration_record_uri
        ? {
            sequence: 1,
            occurredAt: work.certified_at,
            recordUri: work.registration_record_uri,
            recordHash: work.registration_record_hash,
            anchor: anchorsByHash.get(work.registration_record_hash ?? '') ?? null,
          }
        : null,
      provenance: (history ?? []).map((h) => ({
        id: h.id,
        sequence: h.sequence_number,
        event: h.event_type,
        transferType: h.transfer_type,
        actor: h.owner_name,
        from: h.previous_owner_name,
        occurredAt: h.created_at,
        recordUri: h.record_uri,
        recordHash: h.record_hash,
        anchor: anchorsByHash.get(h.record_hash ?? '') ?? null,
      })),
    })
  } catch (error) {
    console.error('[ledger] no se pudo componer el libro:', error)
    return NextResponse.json({ error: 'ledger_unavailable' }, { status: 500 })
  }
}
