/**
 * Puerta de la herramienta de administración — Backend Spec 07 §1 y §5.
 *
 * Tres cosas que la interfaz no puede garantizar y por eso viven aquí:
 *
 *  - Los permisos son casillas, y ver y actuar son casillas distintas.
 *    Diagnosticar un problema de cobro y forzar un cobro son privilegios
 *    diferentes.
 *  - Lo de alto riesgo exige dos personas distintas, y quien aprueba nunca es
 *    quien inició.
 *  - Toda acción queda en la bitácora, con antes y después. Sin excepciones.
 */
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

/** Capacidades de alto riesgo: irreversibles, y justo para lo que serviría una cuenta comprometida. */
export const HIGH_RISK = new Set([
  'transactions.refund',
  'transactions.reverse',
  'payouts.force',
  'payouts.cancel',
  'config.business_rules',
  'config.team',
])

export type AdminMember = { userId: string; displayName: string; permissions: Record<string, boolean> }

export async function loadAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<AdminMember | null> {
  const { data } = await supabase
    .from('admin_members')
    .select('user_id, display_name, permissions, active')
    .eq('user_id', userId)
    .single()

  if (!data || !data.active) return null
  return {
    userId: data.user_id,
    displayName: data.display_name,
    permissions: (data.permissions ?? {}) as Record<string, boolean>,
  }
}

export function can(admin: AdminMember | null, capability: string): boolean {
  return !!admin?.permissions[capability]
}

/**
 * Escribe en la bitácora.
 *
 * La tabla es append-only por trigger y por permisos revocados, así que esto
 * solo puede añadir. Nunca lanza: perder una acción por no poder registrarla
 * sería peor que la propia acción, pero el fallo se grita en el log del
 * servidor porque una bitácora con huecos deja de servir como evidencia.
 */
export async function writeAudit(
  supabase: SupabaseClient,
  request: NextRequest,
  entry: {
    actor: AdminMember
    approverId?: string | null
    action: string
    entityType?: string
    entityId?: string
    before?: unknown
    after?: unknown
    reason?: string
  }
): Promise<void> {
  try {
    // La bitácora es append-only y sin política de inserción para el cliente:
    // la escribe la plataforma, después de que la ruta ya comprobó permisos.
    const { error } = await createAdminClient().from('admin_audit_log').insert({
      actor_id: entry.actor.userId,
      actor_name: entry.actor.displayName,
      approver_id: entry.approverId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      before: entry.before ? JSON.parse(JSON.stringify(entry.before)) : null,
      after: entry.after ? JSON.parse(JSON.stringify(entry.after)) : null,
      reason: entry.reason ?? null,
      ip: request.headers.get('x-forwarded-for') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    })
    if (error) console.error('[admin-audit] WRITE FAILED', entry.action, error)
  } catch (err) {
    console.error('[admin-audit] WRITE THREW', entry.action, err)
  }
}

export type HighRiskOutcome =
  | { proceed: true; approverId: string | null }
  | { proceed: false; pendingId: string; message: string }

/**
 * Cuanto vale una autorizacion ya concedida.
 *
 * La solicitud ya caduca a las 24 horas si nadie la aprueba. Lo aprobado no
 * caducaba nunca, y una autorizacion de alto riesgo que sigue valiendo dentro
 * de un mes no autoriza lo mismo que autorizo: quien la concedio miraba otro
 * estado del sistema. Se le da la misma ventana.
 */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

/** Por que un `approvalId` no sirvio. Solo lee; el intento ya fallo. */
async function whyNot(
  service: SupabaseClient,
  approvalId: string,
  action: string,
  actorId: string
): Promise<string> {
  const { data } = await service
    .from('admin_pending_approvals')
    .select('status, action, initiator_id, approver_id, executed_at, resolved_at')
    .eq('id', approvalId)
    .maybeSingle()

  if (!data) return 'That approval does not exist.'
  if (data.executed_at) return 'That approval was already used. Each high-risk action needs its own.'
  if (data.status === 'pending') return 'That request is still waiting for a second person.'
  if (data.status !== 'approved') return `That request was ${data.status}.`
  if (data.action !== action) return 'That approval authorises a different action.'
  if (data.initiator_id !== actorId) return 'Only the person who started it can apply it.'
  if (data.approver_id === actorId) return 'The approver cannot be the initiator.'
  if (data.resolved_at && Date.parse(data.resolved_at) < Date.now() - APPROVAL_TTL_MS) {
    return 'That approval is more than a day old. Ask for it again.'
  }
  return 'That approval is not valid for this action.'
}

/**
 * Marca como caducadas las solicitudes que nadie resolvio a tiempo.
 *
 * `admin_resolve_approval` ya hace esta transicion, pero solo sobre la fila que
 * alguien intenta resolver — y una solicitud que NADIE puede aprobar no la
 * intenta nadie. Se quedaba «pendiente» para siempre en el panel, con una fecha
 * de caducidad ya pasada debajo, y contando en el tablero.
 *
 * No lanza: barrer es higiene, y no poder barrer no es motivo para no enseñar
 * la lista.
 */
export async function sweepExpiredApprovals(service: SupabaseClient): Promise<void> {
  const { error } = await service
    .from('admin_pending_approvals')
    .update({ status: 'expired', resolved_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
  if (error) console.error('[admin-approvals] sweep failed', error)
}

/**
 * Puerta de alto riesgo.
 *
 * Sin aprobación previa, la acción NO se ejecuta: se registra como pendiente y
 * espera a una segunda persona. Con una aprobación válida, se ejecuta y ambas
 * identidades quedan en la bitácora.
 *
 * La razón es obligatoria y de texto libre, no un desplegable: el valor está en
 * lo que alguien elige escribir.
 *
 * LA AUTORIZACION SE GASTA AL USARSE
 *
 * La comprobacion y el consumo son el MISMO escritorio condicional. Leer la
 * fila, decidir y ejecutar dejaba dos huecos: dos llamadas simultaneas pasaban
 * las dos, y nada impedia volver a presentar el mismo `approvalId` mañana. El
 * UPDATE lleva dentro todas las condiciones, asi que o sella la fila o no
 * devuelve nada — y si no devuelve nada, no se toco.
 *
 * Si la accion falla DESPUES de sellarla, la autorizacion se pierde y hay que
 * pedirla otra vez. Es el lado correcto en el que equivocarse: soltarla al
 * fallar reabriria la ventana que este escritorio cierra.
 */
export async function gateHighRisk(
  supabase: SupabaseClient,
  params: {
    actor: AdminMember
    action: string
    entityType?: string
    entityId?: string
    payload?: unknown
    reason: string
    /** Aprobación ya resuelta que autoriza esta ejecución. */
    approvalId?: string
  }
): Promise<HighRiskOutcome> {
  const service = createAdminClient()

  if (params.approvalId) {
    const { data: claimed } = await service
      .from('admin_pending_approvals')
      .update({ executed_at: new Date().toISOString() })
      .eq('id', params.approvalId)
      .eq('status', 'approved')
      .eq('action', params.action)
      // Quien ejecuta es quien inició, y quien aprobó es otra persona. La base
      // ya lo impide al aprobar; aquí tampoco se ejecuta sobre una suposición.
      .eq('initiator_id', params.actor.userId)
      .neq('approver_id', params.actor.userId)
      .is('executed_at', null)
      .gte('resolved_at', new Date(Date.now() - APPROVAL_TTL_MS).toISOString())
      .select('id, approver_id')
      .maybeSingle()

    if (claimed?.approver_id) return { proceed: true, approverId: claimed.approver_id }

    return {
      proceed: false,
      pendingId: params.approvalId,
      message: await whyNot(service, params.approvalId, params.action, params.actor.userId),
    }
  }

  const { data, error } = await service
    .from('admin_pending_approvals')
    .insert({
      action: params.action,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      payload: params.payload ? JSON.parse(JSON.stringify(params.payload)) : {},
      reason: params.reason,
      initiator_id: params.actor.userId,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`could not record approval request: ${error?.message}`)
  }

  return {
    proceed: false,
    pendingId: data.id,
    message: 'Recorded. A second person holding approve_high_risk must approve it.',
  }
}


/**
 * Step-up de administración — Backend Spec 07 §1.4.
 *
 * El acceso exige biométrico + código privado, sea cual sea el valor de la
 * acción, y la sesión es corta. El token lo emite tbt.cafe —que es donde se
 * verifica el WebAuthn— y aquí solo se valida.
 *
 * Se busca por el hash: la tabla nunca guarda el token en claro, así que leerla
 * no sirve para entrar.
 */
export async function hasValidStepUp(userId: string, token: string | null): Promise<boolean> {
  if (!token) return false
  try {
    const admin = createAdminClient()
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const { data } = await admin
      .from('admin_step_up')
      .select('user_id, used_biometric, used_private_code, expires_at')
      .eq('token_hash', tokenHash)
      .single()

    if (!data) return false
    // El token pertenece a quien lo presenta, no vale uno ajeno.
    if (data.user_id !== userId) return false
    if (new Date(data.expires_at) < new Date()) return false
    // Los dos factores, como pide el spec. Un step-up a medias no cuenta.
    return data.used_biometric === true && data.used_private_code === true
  } catch (err) {
    console.error('[admin] step-up check failed:', err)
    return false
  }
}

/** Cabecera donde viaja el step-up. */
export const STEP_UP_HEADER = 'x-admin-step-up'
