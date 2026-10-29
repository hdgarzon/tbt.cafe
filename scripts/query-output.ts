/**
 * Las filas de `supabase db query --output-format json`.
 *
 * La CLI da dos formas segun quien la llame: a una persona, un arreglo plano;
 * a un agente, un sobre `{ boundary, rows, warning }`. Antes de cualquiera de
 * las dos puede imprimir avisos ("Initialising login role..."). Lo que no sea
 * ninguna de las dos es un error: nunca se toma por cero filas.
 */
export function queryRows(out: string): Array<Record<string, unknown>> {
  const firstArray = out.indexOf('[')
  const firstObject = out.indexOf('{')
  const starts = [firstArray, firstObject].filter((i) => i >= 0)
  const start = starts.length ? Math.min(...starts) : -1
  const end = start === firstArray ? out.lastIndexOf(']') : out.lastIndexOf('}')

  let parsed: unknown = null
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(out.slice(start, end + 1))
    } catch {
      parsed = null
    }
  }
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
  const rows = (parsed as { rows?: unknown } | null)?.rows
  if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>
  throw new Error(`supabase db query: unreadable output, nothing assumed:\n${out.slice(0, 500)}`)
}
