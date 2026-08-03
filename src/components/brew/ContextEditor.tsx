'use client'

import { useEffect, useRef } from 'react'

/**
 * Editor del Contexto con resaltado vivo (initCtx/paint del prototipo):
 * los #hashtags y los enlaces se pintan mientras se escribe.
 *
 * El demo reescribe el HTML en cada tecla y manda el cursor al final, lo que
 * hace imposible corregir en medio de un párrafo. Aquí se repinta igual, pero
 * restaurando la posición del cursor por número de caracteres, para no perder
 * dónde estaba escribiendo el creador.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function paint(text: string): string {
  return esc(text)
    .replace(
      /(https?:\/\/[^\s]+|(?:www\.|tbt\.cafe)[^\s]+)/g,
      '<span class="text-t-navy underline">$1</span>'
    )
    .replace(/(^|\s)(#[A-Za-z0-9_]+)/g, '$1<span class="text-t-navy font-medium">$2</span>')
    .replace(/\n/g, '<br>')
}

/** Desplazamiento del cursor medido en caracteres desde el inicio del nodo. */
function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0).cloneRange()
  range.selectNodeContents(root)
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset)
  return range.toString().length
}

function restoreCaret(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let seen = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0
    if (seen + len >= offset) {
      const range = document.createRange()
      range.setStart(node, Math.max(0, offset - seen))
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      return
    }
    seen += len
  }
}

export function ContextEditor({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  /** Lo último que escribimos nosotros, para no repintar mientras teclea. */
  const painted = useRef<string>('')

  useEffect(() => {
    const el = ref.current
    if (!el || painted.current === value) return
    painted.current = value
    el.innerHTML = paint(value)
  }, [value])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      onInput={() => {
        const el = ref.current
        if (!el) return
        const text = el.innerText
        const offset = caretOffset(el)
        painted.current = text
        el.innerHTML = paint(text)
        restoreCaret(el, offset)
        onChange(text)
      }}
      className={className}
    />
  )
}
