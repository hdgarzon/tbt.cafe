'use client'

import { useEffect, useState } from 'react'

/** Lo que falta hasta `until`, como HH:MM:SS. Neutro de idioma, como en ActionTab. */
export function useCountdown(until: string | null): string {
  const [left, setLeft] = useState('')
  useEffect(() => {
    if (!until) return
    const end = new Date(until).getTime()
    const tick = () => {
      const ms = Math.max(0, end - Date.now())
      const h = Math.floor(ms / 3_600_000)
      const m = Math.floor((ms % 3_600_000) / 60_000)
      const s = Math.floor((ms % 60_000) / 1000)
      setLeft(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [until])
  return left
}
