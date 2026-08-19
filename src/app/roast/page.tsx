import { ROAST_ARTICLES } from '@/lib/roast-content'

/**
 * /roast — el índice de los once artículos.
 *
 * Roast es la superficie de aprendizaje: qué es un TBT, cómo funciona la
 * certificación, las regalías y la verificación. Leer está abierto y no pide
 * sesión — es lo primero que ve alguien que llega sin saber qué es esto.
 *
 * Server component: es texto, y conviene que exista en el HTML servido para
 * quien lo lea sin JavaScript o lo indexe.
 */
export default function RoastPage() {
  return (
    <div className="px-4 pt-6 pb-10">
      <a href="/" className="back-link">
        ← tbt.cafe
      </a>

      <div className="urlbar">tbt.cafe/roast</div>

      <h1 className="page-title">Roast</h1>
      <div className="page-sub">TBT 101</div>

      <div className="mt-6 flex flex-col">
        {ROAST_ARTICLES.map((a) => (
          <a
            key={a.id}
            href={`/roast/${a.id}`}
            className="block py-4 border-b border-hairline last:border-b-0 group"
          >
            <div className="font-display text-[17px] leading-[1.25] text-ink group-hover:underline underline-offset-[3px]">
              {a.title}
            </div>
            <div className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-soft">{a.summary}</div>
            <div className="mt-2 text-[10px] tracking-[0.14em] uppercase text-placeholder">
              {a.minutes} min read
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
