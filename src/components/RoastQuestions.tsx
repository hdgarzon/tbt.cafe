'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'

/**
 * Preguntas al pie de un artículo de Roast.
 *
 * Leer está abierto; preguntar exige autenticación. Sin sesión el campo se
 * enseña igual y es al pulsar cuando se abre el sheet: esconderlo dejaría a
 * quien llega sin saber que puede preguntar, y el prototipo hace lo mismo.
 */

type Question = {
  id: string
  author_name: string
  body: string
  created_at: string
}

export function RoastQuestions({ articleId }: { articleId: string }) {
  const { t } = useLocale()
  const { connected, openAuth } = useShell()
  const [rows, setRows] = useState<Question[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('roast_questions')
      .select('id, author_name, body, created_at')
      .eq('article_id', articleId)
      .eq('hidden', false)
      .order('created_at', { ascending: true })
    setRows(data ?? [])
  }, [articleId])

  useEffect(() => {
    load()
  }, [load])

  async function post() {
    const body = text.trim()
    if (!body || busy) return
    if (!connected) return openAuth()

    setBusy(true)
    setMsg('')
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return openAuth()

      // El nombre se congela al escribir: si alguien cambia su alias después,
      // la pregunta sigue mostrando con qué nombre se hizo.
      const { data: profile } = await supabase
        .from('profiles')
        .select('public_alias, display_name, collector_alias')
        .eq('id', user.id)
        .maybeSingle()

      const authorName =
        profile?.public_alias || profile?.display_name || profile?.collector_alias || t.roast.someone

      const { error } = await supabase.from('roast_questions').insert({
        article_id: articleId,
        user_id: user.id,
        author_name: authorName,
        body,
      })
      if (error) {
        setMsg(t.roast.postFailed)
        return
      }
      setText('')
      await load()
    } finally {
      setBusy(false)
    }
  }

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

      <div className="mt-5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.roast.askPlaceholder}
          rows={3}
          maxLength={2000}
          className="w-full rounded-[11px] border border-hairline bg-paper px-[13px] py-[13px] text-[13px] leading-[1.55] text-ink outline-none focus:border-ink transition-colors resize-none placeholder:text-placeholder"
        />
        <button
          type="button"
          onClick={post}
          disabled={busy || !text.trim()}
          className="w-full mt-2.5 py-3.5 text-[12px] font-semibold tracking-[0.14em] uppercase border border-hairline rounded-xl text-ink transition-colors hover:border-ink disabled:opacity-40 disabled:cursor-default"
        >
          {t.roast.ask}
        </button>
        {msg && <p className="mt-2 text-[11px] text-t-red">{msg}</p>}
      </div>
    </section>
  )
}
