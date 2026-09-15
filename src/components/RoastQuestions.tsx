'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Preguntas al pie de un artículo de Roast.
 *
 * SOLO LECTURA, por ahora (Update Package 01, N11). Una pregunta era pública en
 * cuanto se escribía y no existe herramienta para revisarlas antes, así que el
 * envío está apagado hasta que la haya: sin campo para preguntar aquí, y sin
 * política de inserción en la base (048). La sección sigue, con lo que ya haya.
 *
 * Volver a abrirlo va junto con la moderación, no antes.
 */

type Question = {
  id: string
  author_name: string
  body: string
  created_at: string
}

export function RoastQuestions({ articleId }: { articleId: string }) {
  const { t } = useLocale()
  const [rows, setRows] = useState<Question[]>([])

  useEffect(() => {
    let alive = true
    supabase
      .from('roast_questions')
      .select('id, author_name, body, created_at')
      .eq('article_id', articleId)
      .eq('hidden', false)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (alive) setRows(data ?? [])
      })
    return () => {
      alive = false
    }
  }, [articleId])

  return (
    <section className="mt-10 pt-6 border-t border-hairline">
      <h2 className="text-[10px] font-medium tracking-[0.16em] uppercase text-ink-soft">
        {t.roast.questions}
      </h2>

      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-placeholder">{t.roast.noQuestions}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {rows.map((q) => (
            <div key={q.id} className="border-b border-hairline pb-4 last:border-b-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium text-ink">{q.author_name}</span>
                <span className="text-[10px] text-placeholder">
                  {new Date(q.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-soft whitespace-pre-wrap">
                {q.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
