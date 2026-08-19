import { TransbitMark } from '@/components/Brand'
import { LEGAL_DOCS } from '@/lib/legal-content'

/**
 * Pie fijo de 30px — portado con los valores del prototipo.
 *
 * Va fijo al fondo del viewport pero recortado al ancho de la columna
 * bloqueada, igual que el prototipo: en desktop queda centrado bajo la
 * columna, no a lo ancho de la pantalla. El fondo es #141414 (más oscuro que
 * --ink) para que se lea como una banda distinta del lienzo.
 *
 * Tres piezas, no una: copyright y lockup a la izquierda, enlaces legales a la
 * derecha, repartidos con `space-between`. Antes solo estaba el lockup y iba
 * centrado, así que los cuatro documentos legales no tenían ninguna puerta
 * desde la app.
 */
export function Footer() {
  return (
    <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[45] w-full max-w-col h-footer bg-[#141414] flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <span className="text-[#8A8A8A] text-[10px] leading-none whitespace-nowrap">&copy; 2026</span>
        <div className="flex items-center gap-1">
          <TransbitMark className="block h-4 w-auto" />
          <span className="text-[#8A8A8A] font-light text-[11px] leading-none">&times;</span>
          <span className="text-white font-medium text-[10px] tracking-[0.24em] uppercase pl-px">
            BROCHA
          </span>
        </div>
      </div>

      {/* En inglés a propósito: los documentos existen solo en inglés, así que
          un enlace traducido prometería una traducción que no hay. */}
      <nav className="flex items-center gap-[11px] shrink-0">
        {LEGAL_DOCS.map((doc) => (
          <a
            key={doc.slug}
            href={`/legal/${doc.slug}`}
            className="text-[#8A8A8A] text-[10px] tracking-[0.02em] hover:text-white transition-colors"
          >
            {doc.slug === 'about'
              ? 'About'
              : doc.slug === 'terms'
                ? 'Terms'
                : doc.slug === 'security'
                  ? 'Security'
                  : 'Privacy'}
          </a>
        ))}
      </nav>
    </footer>
  )
}
