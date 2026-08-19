import { notFound } from 'next/navigation'
import { ROAST_ARTICLES, roastArticle } from '@/lib/roast-content'
import { RoastBody } from '@/components/RoastBody'
import { RoastQuestions } from '@/components/RoastQuestions'

/**
 * /roast/[article] — un artículo.
 *
 * Leer está abierto; preguntar exige autenticación, y eso lo resuelve el
 * bloque de preguntas, que es lo único interactivo de la página.
 */

export function generateStaticParams() {
  return ROAST_ARTICLES.map((a) => ({ article: a.id }))
}

export default function RoastArticlePage({ params }: { params: { article: string } }) {
  const article = roastArticle(params.article)
  if (!article) notFound()

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
