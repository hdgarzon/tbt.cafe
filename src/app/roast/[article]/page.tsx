import { notFound } from 'next/navigation'
import { roastArticle } from '@/lib/roast-content'
import { RoastBody } from '@/components/RoastBody'
import { RoastQuestions } from '@/components/RoastQuestions'
import { getPublicRules } from '@/lib/rules'
import { fillDeep, proseValues } from '@/lib/prose'

/**
 * /roast/[article] — un artículo.
 *
 * Leer está abierto; preguntar exige autenticación, y eso lo resuelve el
 * bloque de preguntas, que es lo único interactivo de la página.
 */

/*
 * Las cifras del texto vienen de configuracion (Work Order 02, 1.4): la pagina
 * se genera en la primera visita y se regenera cada minuto, en vez de
 * prerenderizarse en el build con los valores de ese momento.
 */
export const revalidate = 60

export default async function RoastArticlePage(props: { params: Promise<{ article: string }> }) {
  const params = await props.params;
  const found = roastArticle(params.article)
  if (!found) notFound()
  const article = fillDeep(found, proseValues(await getPublicRules()))

  return (
    <div className="px-4 pt-6 pb-10">
      <a href="/roast" className="back-link">
        ← Roast
      </a>

      <div className="urlbar">tbt.cafe/roast/{article.id}</div>

      <h1 className="font-display font-medium text-[26px] leading-[1.15] text-ink">
        {article.title}
      </h1>
      <div className="mt-2 text-[10px] tracking-[0.14em] uppercase text-placeholder">
        {article.minutes} min read
      </div>

      <div className="mt-6">
        <RoastBody body={article.body} />
      </div>

      <RoastQuestions articleId={article.id} />
    </div>
  )
}
