import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Autenticar en el punto de consecuencia, y ofreciendo el paso.
 *
 * Gating Spec 01. Una acción que necesita sesión abre la autenticación y se
 * COMPLETA después. No falla en silencio, no escribe una frase y para, y no
 * cierra la puerta de una sala en la que la visita era bienvenida.
 *
 * `RoastQuestions.tsx` ya lo hacía bien y es la referencia. Esto comprueba que
 * el resto lo hace igual — y sobre construcciones del código, nunca sobre la
 * prosa que las explica.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const shell = read('src/components/AppShell.tsx')
const gate = read('src/components/SignInGate.tsx')
const favData = read('src/lib/favorites-data.ts')
const actions = read('src/components/WorkActions.tsx')
const curation = read('src/components/CurationModal.tsx')

// ---- la reanudación
{
  ok('openAuth acepta una acción pendiente', shell.includes('openAuth: (options?: { resume?: () => void }) => void'))
  ok('se guarda envuelta en una función',
     shell.includes('setResumeAfterAuth(() => options?.resume ?? null)'),
     'sin el envoltorio React la trataría como actualizador y la EJECUTARÍA sin sesión')
  ok('cancelar la descarta', shell.includes('onClose={() => closeAuth(false)}'),
     'una acción que sobrevive a un «no» se dispara sola la próxima vez')
  ok('el teléfono la reanuda', shell.includes('closeAuth(true)'))
  // Hubo una segunda entrada —el biométrico— que también reanudaba. Se retiró
  // con D1: el biométrico ya no inicia sesión, así que el teléfono es la única.
  ok('y es la única entrada', shell.split('closeAuth(true)').length - 1 === 1,
     'el biométrico se suma al código, nunca abre sesión por su cuenta (D1)')
}

// ---- favoritos: informar, ofrecer, reanudar
{
  ok('la capa de datos informa en la forma de la casa',
     favData.includes("return { error: 'needSignIn' as const }"))
  ok('y ya no devuelve un false mudo',
     !/if \(!user\) return false\n\n  const already/.test(favData),
     'ese false acababa en setSaved y el corazón no se llenaba')
  ok('el componente ofrece el paso y reanuda',
     actions.includes('openAuth({ resume: onFavorite })'))
}

// ---- curacion: leer no pide sesion, el boton "Add your curation" si
//
// Update Package 01, N6 (ya aplicado en PR #112). Antes la puerta iba al
// abrir el modal — un visitante bloqueado sin haber leido nada. Ahora la
// lectura queda abierta y `beginAdding` es la que pide autenticacion, con
// resume para reabrir el form ya listo para escribir.
{
  const effect = curation.slice(curation.indexOf('useEffect(() => {'), curation.indexOf('if (!open || !target) return null'))
  ok('leer no pide sesion al abrir el modal', !effect.includes('openAuth()'),
     'Federico N6: reading is open, the door goes on "Add your curation"')
  ok('el boton "Add your curation" es la puerta', curation.includes("openAuth({ resume: () => setAdding(true) })"),
     'y al volver reabre el form ya abierto, sin exigir buscar la obra otra vez')
  ok('el envio conserva su respaldo, con reanudacion', curation.includes('openAuth({ resume: submit })'),
     'sesion que caduca con el formulario abierto: se retoma con lo escrito')
  ok('el modal no se cierra al pedir sesion', !effect.includes('onClose()'),
     'el sheet se abre encima; cerrarlo obligaria a escribirlo todo otra vez')

  // "Se abre encima" solo es cierto si la capa lo dice. El login (Sheet) iba
  // en z-[70] y el panel de curacion (StandingSheet) en z-[80]: el visitante
  // tocaba "Add your curation" y el login quedaba detras, sin poder usarse.
  const sheetSrc = read('src/components/Sheet.tsx')
  const layer = (fn: string) => {
    const body = sheetSrc.slice(sheetSrc.indexOf(`export function ${fn}(`))
    const m = body.match(/className=\{?[`"]fixed inset-0 z-\[(\d+)\]/)
    return m ? Number(m[1]) : NaN
  };
  ok('el login queda por encima del panel que lo pide', layer('Sheet') > layer('StandingSheet'),
     `Sheet z-[${layer('Sheet')}] vs StandingSheet z-[${layer('StandingSheet')}]`)
}

// ---- el biométrico es solo un segundo factor — lista maestra D1
//
// Se suma al código SMS y nunca lo sustituye. El inicio de sesión rápido —un
// toque en lugar del código— se retiró entero: su pantalla, sus dos rutas, sus
// textos y el modo `quick` de la credencial.
{
  const gone = [
    'src/components/BiometricSignInSheet.tsx',
    'src/app/api/webauthn/auth/begin/route.ts',
    'src/app/api/webauthn/auth/finish/route.ts',
  ]
  for (const f of gone) ok(`no existe ${f}`, !existsSync(join(process.cwd(), f)))
  const authSheet = read('src/components/AuthSheet.tsx')
  const bioSheet = read('src/components/BiometricSheet.tsx')
  const regFinish = read('src/app/api/webauthn/register/finish/route.ts')
  ok('el login no ofrece entrar con biométrico', !authSheet.includes('onSwitchToBiometric') && !authSheet.includes('t.auth.bioInstead'))
  ok('el alta del biométrico no ofrece modo quick', !bioSheet.includes("'quick'"))
  ok('la credencial se guarda siempre como extra', regFinish.includes("bio_mode: 'extra'") && regFinish.includes('const { credential } = body'),
     'el modo no se lee del cliente')
  const m054 = read('supabase/migrations/054_biometric_second_factor_only.sql')
  ok('la 054 prohíbe quick', m054.includes("check (bio_mode = 'extra')"))
  for (const l of ['en', 'es', 'pt', 'fr']) {
    const m = JSON.parse(read(`src/i18n/messages/${l}.json`))
    ok(`${l}: sin auth.bioInstead ni biometricSignIn`, m.auth?.bioInstead === undefined && m.biometricSignIn === undefined)
  }
}

// ---- autenticación, nunca "sign in" — lista maestra D2, texto exacto
{
  const D2: Record<string, [string, string, string, string]> = {
    'header.signIn': ['Authenticate', 'Autentícate', 'Autentique-se', "S'authentifier"],
    'menu.needSignIn': ['Authenticate to open this section.', 'Autentícate para abrir esta sección.', 'Autentique-se para abrir esta seção.', 'Authentifiez-vous pour ouvrir cette section.'],
    'authHub.needSignIn': ['Authenticate to manage your authentication.', 'Autentícate para gestionar tu autenticación.', 'Autentique-se para gerenciar sua autenticação.', 'Authentifiez-vous pour gérer votre authentification.'],
    'profile.needSignIn': ['Authenticate to edit your profile.', 'Autentícate para editar tu perfil.', 'Autentique-se para editar seu perfil.', 'Authentifiez-vous pour modifier votre profil.'],
    'profileCreator.needSignIn': ['Authenticate to edit your profile.', 'Autentícate para editar tu perfil.', 'Autentique-se para editar seu perfil.', 'Authentifiez-vous pour modifier votre profil.'],
    'profileCollector.needSignIn': ['Authenticate to edit your profile.', 'Autentícate para editar tu perfil.', 'Autentique-se para editar seu perfil.', 'Authentifiez-vous pour modifier votre profil.'],
    'notifications.needSignIn': ['Authenticate to manage your notifications.', 'Autentícate para gestionar tus notificaciones.', 'Autentique-se para gerenciar suas notificações.', 'Authentifiez-vous pour gérer vos notifications.'],
    'work.errors.needSignIn': ['Authenticate to buy this piece.', 'Autentícate para comprar esta obra.', 'Autentique-se para comprar esta obra.', 'Authentifiez-vous pour acheter cette œuvre.'],
    'transfer.errors.needSignIn': ['Authenticate to transfer this work.', 'Autentícate para transferir esta obra.', 'Autentique-se para transferir esta obra.', 'Authentifiez-vous pour transférer cette œuvre.'],
    'transferAccept.needSignInTitle': ['Authenticate to continue', 'Autentícate para continuar', 'Autentique-se para continuar', 'Authentifiez-vous pour continuer'],
    'brew.errors.needSignIn': ['Authenticate to continue', 'Autentícate para continuar', 'Autentique-se para continuar', 'Authentifiez-vous pour continuer'],
    'myCollections.needSignIn': ['Authenticate to see this.', 'Autentícate para ver esto.', 'Autentique-se para ver isto.', 'Authentifiez-vous pour voir ceci.'],
    'curation.needSignIn': ['Authenticate to leave a curation.', 'Autentícate para dejar una curaduría.', 'Autentique-se para deixar uma curadoria.', 'Authentifiez-vous pour laisser une curation.'],
  }
  const locales = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < locales.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${locales[i]}.json`))
    for (const key of Object.keys(D2)) {
      const v = key.split('.').reduce((node: any, part) => (node ? node[part] : undefined), m)
      ok(`${locales[i]}: ${key} es el texto de D2`, v === D2[key][i], `tiene ${JSON.stringify(v)}`)
    }
  }
}

// ---- la puerta compartida
{
  ok('la puerta lleva botón', gate.includes('openAuth({ resume })'))
  ok('y siempre devuelve a la misma página',
     gate.includes('onSignedIn ?? (() => window.location.reload())'),
     'sin cargador propio se recarga la ruta: entrar y quedarse en la misma frase no es entrar')
  ok('y reusa una cadena que ya existe en los cuatro idiomas', gate.includes('t.header.signIn'))

  for (const page of ['favorites', 'creations', 'acquisitions']) {
    const src = read(`src/app/collections/${page}/page.tsx`)
    ok(`/collections/${page} ofrece la salida`, src.includes('<SignInGate'))
    ok(`  y vuelve a cargarse al entrar`, src.includes('onSignedIn={load}'),
       'la sesión se comprueba una vez al montar: sin esto se queda en la misma frase')
  }

  /*
   * NINGUNA página se queda con la frase a secas — ítem 6.
   *
   * Se recorre el árbol en vez de listar las diecisiete: una pantalla nueva que
   * escriba `needSignIn` y pare cae aquí sola, que es lo que impide que el
   * defecto vuelva de a una.
   */
  const pages: string[] = []
  const walkPages = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walkPages(p)
      else if (n === 'page.tsx') pages.push(p)
    }
  }
  walkPages(join(process.cwd(), 'src/app'))

  const deadEnds = pages.filter((f) => {
    const src = readFileSync(f, 'utf8')
    if (!src.includes('needSignIn')) return false
    // Ofrecer el paso vale con la puerta compartida o llamando a openAuth.
    return !src.includes('<SignInGate') && !src.includes('openAuth')
  })
  ok(`ninguna de las ${pages.length} páginas es un callejón sin salida`, deadEnds.length === 0,
     deadEnds.map((f) => f.replace(process.cwd() + '/', '')).join(', '))
}

// ---- el asistente, abierto a quien todavía no se ha unido
{
  const chat = read('src/components/AssistantChat.tsx')
  const route = read('src/app/api/assistant/route.ts')
  const ctx = read('src/lib/assistant/context.ts')
  const feed = read('src/components/NotificationFeed.tsx')

  ok('el icono del header abre el panel, sin preguntar',
     shell.includes('onNotifications={() => setNotifOpen(true)}'),
     'era el gate de fuera: sin sesión el panel no llegaba a abrirse')
  ok('la pestaña del asistente ya no exige sesión',
     !chat.includes('if (signedIn === false)'),
     'es la única superficie cuyo trabajo es explicar la plataforma a quien no se ha unido')
  ok('y envía sin cabecera cuando no la hay',
     chat.includes('...(session ? { Authorization: `Bearer ${session.access_token}` } : {})'))
  ok('la de notificaciones SIGUE cerrada', feed.includes('if (signedIn === false)'),
     'es personal por definición y no tiene nada que enseñarle a una visita')

  ok('el servidor ya no rechaza sin sesión',
     !route.includes('if (!auth.ok) return NextResponse.json(auth.body'))
  ok('y solo carga el contexto personal si hay quien',
     route.includes('auth.ok ? await loadPersonContext(auth.supabase, auth.user.id) : null'))
  ok('el conocimiento se recupera igual para todos',
     route.includes('const docs = retrieve(question, locale, await getRules())'),
     'retrieve() es puro sobre los documentos y las reglas globales; no toca dato de nadie')

  ok('a una visita se le DICE que lo es', ctx.includes('You are speaking to a visitor who has not signed in.'),
     'un contexto vacío el modelo lo lee como «no tiene nada», y de ahí inventa una cifra')
  ok('y que no invente cifras', ctx.includes('Never estimate, guess or invent a figure about them.'))

  ok('escalar sin destinatario pide la sesión en ese momento',
     route.includes('needsSignIn = true') && chat.includes('if (body.needsSignIn) openAuth()'),
     'un ticket sin persona a quien responder no es una escalada')
}

// ---- el asistente no manda a nadie a una página que no existe
//
// Abrirlo a visitas lo sacó a la luz: lo que inventa con más naturalidad al
// hablar con quien no ha entrado es `/signin`, y aquí autenticarse es un sheet.

{
  const { ALLOWED_CTA } = require('../src/lib/assistant/provider') as { ALLOWED_CTA: readonly string[] }
  const provider = read('src/lib/assistant/provider.ts')

  ok('el enlace se compara contra una lista, no contra «empieza por /»',
     provider.includes('(ALLOWED_CTA as readonly string[]).includes(parsed.cta.href)') &&
     !provider.includes("parsed.cta.href?.startsWith('/') ? parsed.cta"))
  ok('y al modelo se le dice que no hay página de acceso',
     provider.includes('There is NO sign-in page'))

  /** Existe si hay carpeta con ese nombre, o si el padre tiene un segmento dinámico. */
  const routeExists = (route: string): boolean => {
    const parts = route.replace(/^\//, '').split('/')
    let dir = join(process.cwd(), 'src/app')
    for (const part of parts) {
      const literal = join(dir, part)
      try {
        if (statSync(literal).isDirectory()) { dir = literal; continue }
      } catch { /* sigue: puede ser dinámico */ }
      const dynamic = readdirSync(dir).find((n) => n.startsWith('[') && n.endsWith(']'))
      if (!dynamic) return false
      dir = join(dir, dynamic)
    }
    return true
  }
  const missing = ALLOWED_CTA.filter((route) => !routeExists(route))
  ok(`las ${ALLOWED_CTA.length} rutas ofrecidas existen en src/app`, missing.length === 0,
     'no existen: ' + missing.join(', '))
  ok('y ninguna es la de acceso inventada',
     !ALLOWED_CTA.some((r) => ['/signin', '/login', '/account'].includes(r)))
}

// ---- la trampa del evento como opciones
{
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) files.push(p)
    }
  }
  walk('src')
  const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('onClick={openAuth}'))
  ok('nadie pasa el evento del clic como opciones', offenders.length === 0,
     offenders.join(', ') + ' — onClick={openAuth} manda un MouseEvent donde van las opciones')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
