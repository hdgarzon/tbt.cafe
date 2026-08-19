import { SupportPanel } from '@/components/SupportPanel'

/**
 * /help — la ruta del panel de soporte.
 *
 * El contenido vive en `SupportPanel` porque el mismo panel cuelga del icono
 * de notificaciones del header, que es su sitio en el prototipo. Esta ruta se
 * mantiene: el menú enlaza aquí y una URL a la que volver es útil.
 */
export default function HelpPage() {
  return <SupportPanel />
}
