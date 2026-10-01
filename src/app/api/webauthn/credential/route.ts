import { NextRequest, NextResponse } from 'next/server'
import { verifyPrivateCode } from '@/lib/two-factor'
import { notify } from '@/lib/notify'

/**
 * DELETE /api/webauthn/credential — quitar un biometrico, Work Order 02, 10.1.
 *
 * Exige el codigo privado: el factor que se quita no puede ser el que autoriza
 * quitarlo, y una sesion sola no basta. El navegador ya no puede borrar la fila
 * (066); solo esta ruta, y solo la de quien llama.
 */
export async function DELETE(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const { credentialId, code } = (await request.json().catch(() => ({}))) as { credentialId?: string; code?: string }
  if (!credentialId) return NextResponse.json({ error: 'credential_required' }, { status: 400 })

  const gate = await verifyPrivateCode(token, code)
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status })

  const { data: removed, error } = await gate.admin
    .from('webauthn_credentials')
    .delete()
    .eq('user_id', gate.userId)
    .eq('credential_id', credentialId)
    .select('credential_id')
  if (error) return NextResponse.json({ error: 'remove_failed' }, { status: 500 })
  if (!removed?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await notify(gate.admin, {
    userId: gate.userId,
    eventKey: 'security_change',
    dedupeKey: `biometric:${credentialId}:removed`,
    data: { variant: 'factor' },
    href: '/settings/authentication',
  })
  return NextResponse.json({ ok: true })
}
