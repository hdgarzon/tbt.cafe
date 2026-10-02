'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * El pad de firma — Title Specification 02 §5.
 *
 * Dedo en el teléfono, mouse o trackpad en el portátil. Se guarda como trazos,
 * no como imagen: listas de puntos normalizadas a la caja 330 × 80 del título,
 * sin presión. Pesa poco, escala limpio y el renderer la dibuja idéntica cada
 * vez, que es lo que mantiene un título re-renderizable byte a byte.
 */

export const SIG_W = 330
export const SIG_H = 80
const MIN_STEP = 0.8 // en unidades de la caja: un punto nuevo solo si se movió
const MAX_POINTS = 3000

export type Strokes = number[][][]

function round(n: number) {
  return Math.round(n * 10) / 10
}

/** La firma dibujada como SVG, para la vista previa. Absent: nada. */
export function SignaturePreview({ strokes, className = '' }: { strokes: Strokes | null; className?: string }) {
  if (!strokes || strokes.length === 0) return null
  return (
    <svg viewBox={`0 0 ${SIG_W} ${SIG_H}`} className={className} aria-hidden="true">
      {strokes.map((s, i) =>
        s.length === 1 ? (
          <circle key={i} cx={s[0][0]} cy={s[0][1]} r={1.2} fill="currentColor" />
        ) : (
          <polyline
            key={i}
            points={s.map((p) => `${p[0]},${p[1]}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      )}
    </svg>
  )
}

export function SignaturePad({
  initial,
  onChange,
}: {
  initial: Strokes | null
  onChange: (strokes: Strokes) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [strokes, setStrokes] = useState<Strokes>(initial ?? [])
  const drawing = useRef<number[][] | null>(null)

  const paint = useCallback((all: Strokes) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    const sx = canvas.width / SIG_W
    const sy = canvas.height / SIG_H
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.4 * sx
    ctx.strokeStyle = getComputedStyle(canvas).color
    ctx.fillStyle = ctx.strokeStyle
    for (const s of all) {
      if (s.length === 1) {
        ctx.beginPath()
        ctx.arc(s[0][0] * sx, s[0][1] * sy, 1.2 * sx, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.beginPath()
      s.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0] * sx, p[1] * sy) : ctx.lineTo(p[0] * sx, p[1] * sy)))
      ctx.stroke()
    }
  }, [])

  useEffect(() => {
    paint(strokes)
    const onResize = () => paint(strokes)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [strokes, paint])

  function toBox(e: React.PointerEvent<HTMLCanvasElement>): number[] {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIG_W
    const y = ((e.clientY - rect.top) / rect.height) * SIG_H
    return [round(Math.min(SIG_W, Math.max(0, x))), round(Math.min(SIG_H, Math.max(0, y)))]
  }

  const pointCount = (all: Strokes) => all.reduce((n, s) => n + s.length, 0)

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (pointCount(strokes) >= MAX_POINTS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = [toBox(e)]
    setStrokes((prev) => [...prev, drawing.current as number[][]])
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const current = drawing.current
    if (!current) return
    const p = toBox(e)
    const last = current[current.length - 1]
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return
    if (pointCount(strokes) >= MAX_POINTS) return
    current.push(p)
    setStrokes((prev) => [...prev.slice(0, -1), [...current]])
  }

  function up() {
    if (!drawing.current) return
    drawing.current = null
    // Un render más para que el efecto de abajo entregue la firma completa.
    setStrokes((prev) => [...prev])
  }

  // Se avisa al terminar cada trazo, no en cada punto.
  useEffect(() => {
    if (!drawing.current) onChange(strokes)
  }, [strokes, onChange])

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="block w-full rounded-xl border border-hairline bg-paper text-ink touch-none"
      style={{ aspectRatio: `${SIG_W} / ${SIG_H}` }}
    />
  )
}
