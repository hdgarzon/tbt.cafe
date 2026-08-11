'use client'

/**
 * Feed de notificaciones — Backend Spec 06 §1.1.
 *
 * Este es EL canal de registro: todo el mundo recibe aquí todas sus
 * notificaciones, tenga correo o no. Por eso el correo puede seguir siendo
 * opcional sin que nadie se quede sin enterarse de nada.
 *
 * La base guarda la clave del evento y sus datos, no el texto traducido. El
 * idioma se resuelve aquí, al pintar, así que cambiar de idioma cambia también
 * el historial entero en lugar de dejar un archivo mezclado con el idioma que
 * cada persona tenía el día de cada evento.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, type Dictionary } from '@/i18n/LocaleProvider'

type Row = {
  id: string
  event_key: string
  category: string
  params: Record<string, string | number> | null
  href: string | null
  read_at: string | null
  created_at: string
}

/** Punto de color por categoría, igual que el prototipo. */
const DOT: Record<string, string> = {
  tbt: 'bg-t-magenta',
  security: 'bg-t-navy',
  transactional: 'bg-t-green',
  support: 'bg-t-yellow',
  payouts: 'bg-t-green',
}

function render(t: Dictionary, row: Row): string {
  const events = t.feed.events as Record<string, string | undefined>
  const template = events[row.event_key]
  // Un evento sin plantilla no se muestra con su clave cruda en la cara: mejor
  // decir algo neutro que enseñar 'offer_declined' a alguien.
  if (!template) return t.feed.title
  return Object.entries(row.params ?? {}).reduce(
    (text, [k, v]) => text.replace(`{${k}}`, String(v)),
    template
  )
}

export function NotificationFeed() {
  const { t } = useLocale()
  const [rows, setRows] = useState<Row[]>([])
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setSignedIn(!!user)
    if (!user) return

    const { data } = await supabase
      .from('notifications')
      .select('id, event_key, category, params, href, read_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setRows(data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function markAllRead() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null)
    load()
  }

  if (signedIn === false) {
    return <p className="text-[12px] leading-[1.6] text-ink-soft">{t.feed.needSignIn}</p>
  }

  if (rows.length === 0) {
    return <p className="text-[12px] leading-[1.6] text-placeholder">{t.feed.empty}</p>
  }

  const unread = rows.filter((r) => !r.read_at).length

  return (
    <div>
      {unread > 0 && (
        <button
          type="button"
          onClick={markAllRead}
          className="text-[10.5px] font-medium tracking-[0.12em] uppercase text-ink-soft hover:text-ink transition-colors mb-3"
        >
          {t.feed.markAll}
        </button>
      )}

      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const body = (
            <>
              <div className="flex items-start gap-2.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-[7px] ${DOT[row.category] ?? 'bg-hairline'}`} />
                <div className="flex-1">
                  <p className="text-[12.5px] leading-[1.55] text-ink">{render(t, row)}</p>
                  <div className="text-[10.5px] text-placeholder mt-1">
                    {new Date(row.created_at).toLocaleString()}
                  </div>
                </div>
                {/* Sin leer se marca, pero no se grita: no hace falta un badge
                    rojo por cada línea. */}
                {!row.read_at && <span className="w-1.5 h-1.5 rounded-full bg-ink shrink-0 mt-[7px]" />}
              </div>
            </>
          )

          return row.href ? (
            <a
              key={row.id}
              href={row.href}
              className={`block border rounded-xl p-3.5 transition-colors hover:bg-paper-warm ${
                row.read_at ? 'border-hairline' : 'border-hairline bg-paper-warm'
              }`}
            >
              {body}
            </a>
          ) : (
            <div
              key={row.id}
              className={`border rounded-xl p-3.5 ${row.read_at ? 'border-hairline' : 'border-hairline bg-paper-warm'}`}
            >
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
