import en from '@/i18n/messages/en.json'
import es from '@/i18n/messages/es.json'
import pt from '@/i18n/messages/pt.json'
import fr from '@/i18n/messages/fr.json'

/**
 * Los textos para el servidor — un SMS o un aviso en el idioma de la persona.
 * Los mismos catalogos que pinta el navegador, sin el proveedor de React.
 */
const DICTS = { en, es, pt, fr }
export type ServerLocale = keyof typeof DICTS

export function dictFor(locale: string | null | undefined) {
  return DICTS[(locale && locale in DICTS ? locale : 'en') as ServerLocale]
}
