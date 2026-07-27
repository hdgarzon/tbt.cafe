import { TransbitMark } from '@/components/Brand'

/**
 * Pie fijo de 30px — marca Transbit × BROCHA.
 *
 * Va fijo al fondo del viewport pero recortado al ancho de la columna
 * bloqueada, igual que el prototipo: en desktop queda centrado bajo la
 * columna, no a lo ancho de la pantalla. El fondo es #141414 (más oscuro que
 * --ink) para que se lea como una banda distinta del lienzo.
 */
export function Footer() {
  return (
    <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[45] w-full max-w-col h-footer bg-[#141414] flex items-center justify-center gap-[10px] px-4">
      <TransbitMark className="block h-4 w-auto" />
      <span className="text-[#8A8A8A] font-light text-[12px] leading-none">&times;</span>
      <span className="text-white font-medium text-[10px] tracking-[0.30em] uppercase pl-px">
        BROCHA
      </span>
    </footer>
  )
}
