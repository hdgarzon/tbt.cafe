/**
 * Configuración plana de ESLint 9.
 *
 * Sustituye a `.eslintrc.json`. El cambio no es de gusto: `eslint-config-next@16`
 * exige ESLint >= 9, y ESLint 9 solo lee este formato. Por eso el bump de
 * eslint-config-next no podía entrar solo — arrastraba un tercer major.
 *
 * `next lint` tampoco existe ya en Next 16 (interpreta "lint" como un
 * directorio), así que el script del package llama a `eslint` directamente.
 */
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

export default [
  { ignores: ['.next/**', 'out/**', 'next-env.d.ts', '.claude/**'] },
  ...nextCoreWebVitals,

  /*
   * Dos reglas que el config de la 16 trae como ERROR y aqui quedan en aviso.
   *
   * No es taparlas: son opiniones nuevas sobre codigo que lleva tiempo
   * funcionando, no fallos recien descubiertos, y suman 59 sitios. Arreglarlos
   * es un refactor con su propio riesgo — cambiar 37 <a> por <Link> toca la
   * navegacion entera — y no cabe dentro de una subida de dependencias.
   *
   * En aviso siguen contandose y saliendo en cada `npm run lint`. En `off`
   * desaparecerian, que es como esta deuda se vuelve invisible.
   *
   *   @next/next/no-html-link-for-pages   37  navegacion interna con <a>,
   *                                           que recarga la pagina entera
   *   react-hooks/set-state-in-effect     22  setState en el cuerpo de un efecto
   */
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]
