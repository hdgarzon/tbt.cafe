/**
 * Lo que se dice de un titular — Chains 01, Stage 3.
 *
 * En un registro permanente (3.2): el nombre publico solo si la persona eligio
 * mostrarlo en esa adquisicion; si no, el codigo de esa tenencia. Nunca el
 * nombre que tecleo quien envio la transferencia (Work Order 02, 5.8).
 *
 * En la web (3.4): sigue el interruptor de coleccionista anonimo del perfil, en
 * vivo y reversible, sin tocar nada publicado.
 */

export type HolderFacts = { holder_code: number; holder_named: boolean; holder_public_name: string | null }

/** Para un registro permanente. `Private collector` es la etiqueta del registro, en ingles como el resto del esquema. */
export function holderLabel(row: HolderFacts): string {
  return row.holder_named ? (row.holder_public_name ?? `Private collector · ${row.holder_code}`) : `Private collector · ${row.holder_code}`
}

/** Para la web, en el idioma de quien mira. */
export function holderDisplay(
  row: { holder_code: number | null },
  profile: { public_alias?: string | null; display_name?: string | null; collector_anonymous?: boolean | null } | null,
  privateLabel: string,
  isCreatorRow = false
): string | null {
  if (!profile) return null
  // El creador es siempre el creador: su autoria ya es publica (3.3).
  if (!isCreatorRow && profile.collector_anonymous) return privateLabel.replace('{code}', String(row.holder_code ?? ''))
  return profile.public_alias || profile.display_name || null
}
