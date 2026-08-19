import { TransbitMark } from '@/components/Brand'
import type { RoastBlock } from '@/lib/roast-content'

/**
 * Los cuatro tipos de bloque de un artículo de Roast.
 *
 * `triad` y `mark` se dibujan en casa y no con logos de terceros: es más claro
 * y no hace ninguna afirmación de respaldo por parte de esas cadenas — el
 * prototipo lo deja comentado y conviene que siga siendo cierto.
 */
export function RoastBody({ body }: { body: RoastBlock[] }) {
  return (
    <div className="flex flex-col gap-4">
      {body.map((block, i) => {
        if (block.kind === 'p') {
          return (
            <p
              key={i}
              className="text-[13.5px] leading-[1.7] text-ink-soft [&_b]:font-medium [&_b]:text-ink [&_i]:italic"
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          )
        }

        if (block.kind === 'mark') {
          return (
            <div key={i} className="flex flex-col items-center gap-2 py-3">
              {block.which === 'transbit' ? (
                <TransbitMark className="block h-8 w-auto" />
              ) : (
                <span className="text-[13px] font-medium tracking-[0.24em] uppercase text-ink">
                  BROCHA
                </span>
              )}
              {block.caption && (
                <div className="text-[10px] tracking-[0.16em] uppercase text-placeholder">
                  {block.caption}
                </div>
              )}
            </div>
          )
        }

        if (block.kind === 'triad') {
          return (
            <div key={i} className="flex flex-col gap-3 my-1">
              {block.rows.map((row) => (
                <div key={row.chain} className="flex gap-3 border-t border-hairline pt-3">
                  <div className="w-[68px] shrink-0 font-display text-[15px] leading-[1.2] text-ink">
                    {row.chain}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] tracking-[0.16em] uppercase text-placeholder">
                      {row.role}
                    </div>
                    <div className="mt-1 text-[12.5px] leading-[1.6] text-ink-soft">
                      {row.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        }

        // Ejemplo de dinero. Las cifras se leen alineadas, así que van tabulares.
        return (
          <div key={i} className="rounded-xl border border-hairline bg-paper-warm p-4 my-1">
            <div className="text-[10px] tracking-[0.16em] uppercase text-ink-soft">
              {block.title}
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {block.rows.map((row, j) => (
                <div
                  key={j}
                  className={`flex items-baseline justify-between text-[12.5px] ${
                    row.total
                      ? 'border-t border-hairline pt-2 mt-1 font-medium text-ink'
                      : 'text-ink-soft'
                  }`}
                >
                  <span>{row.label}</span>
                  <span className="tabular-nums">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
