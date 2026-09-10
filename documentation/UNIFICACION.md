# Unificar el backend en tbt-cafe

Terminada el 10 sep 2026. Este documento existió para que la sesión que hiciera
la migración no volviera a descubrir lo que ya costó descubrir; ahora queda como
registro de cómo se hizo y de sus trampas.

## El objetivo

Un solo proyecto de Vercel. Eran dos:

| Proyecto | Sirve | Qué es |
|---|---|---|
| `tbt-cafe` | `tbt.cafe` | el front, y el destino de todo |
| `brocha` | `www.tbt.cafe` | el backend: 27 rutas de API, sin interfaz |

El repo `hdgarzon/tbt` (carpeta local `Forms`) ya no tiene front: se podó en
el PR #33. Queda `src/app/api` (27 rutas), `src/lib` (27 módulos) y poco más.

## Lo que hay que mover

- **27 rutas** bajo `src/app/api`
- **27 libs**, incluidas `solana/`, `admin/`, `assistant/`, `stripe.ts`,
  `money.ts`, `payout-earnings.ts`, `auth-ladder.ts`, `cross-origin-auth.ts`
- **12 dependencias** que tbt-cafe no tiene: `@aws-sdk/client-sns`,
  `@metaplex-foundation/js`, `@solana/web3.js`, `@supabase/auth-helpers-nextjs`,
  `googleapis`, `resend`, `stripe`, `twilio`, y las que arrastren

## Lo que desaparece al unificar

Esto es la mitad del valor de hacerlo:

- `NEXT_PUBLIC_TBT_BACKEND_URL` y toda la indirección
- `cross-origin-auth.ts`: CORS, allowlist de orígenes y autenticación
  flexible por Bearer-o-cookie. Con un solo origen, sobra
- La duplicación de `money.ts` (Forms) y `fees.ts` (tbt-cafe), que hoy tienen
  que restar lo mismo o el creador ve una cifra y cobra otra

## Estado: hecho

**La unificacion esta terminada.** Comprobado el 10 sep 2026:

| | |
|---|---|
| `tbt.cafe` y `www.tbt.cafe` | los dos sirven el proyecto `tbt-cafe` |
| Proyecto `brocha` en Vercel | ya no existe |
| Repo `hdgarzon/tbt` | archivado en GitHub; su ultimo push fue el 21 ago |
| Las 27 rutas del backend | todas aqui (este repo sirve 43) |
| `NEXT_PUBLIC_TBT_BACKEND_URL` | ninguna referencia; `backend.ts` ya no existe |

| Fase | | |
|---|---|---|
| 1 | Libs sin estado | hecha |
| 2 | Rutas sin sesion: `tbt-image/*`, `generate-context`, `espresso/extract`, `assistant` | hecha |
| 3 | Stripe, transferencias, `complete-*`, `validate-coupon`, notificaciones | hecha |
| 4 | Admin: 8 rutas, el guard y la cadena de notificacion | hecha |
| 5 | Variables de entorno y repunte del front | hecha, con dos ausencias — ver abajo |
| 6 | `www.tbt.cafe` resuelto; `brocha` borrado | hecha |

### Por que dejo de importar que `brocha` guardase los secretos

Era la razon para no borrarlo, y dejo de serlo por los dos lados:

- **`WALLET_ENCRYPTION_KEY` ya no descifra nada.** La migracion 032 borro
  `wallets` —la tabla no existe en la base viva— y nada en `src/` la lee.
- **No habia un secreto que solo viviera alli.** La copia local del entorno del
  backend coincidia con la de este repo variable por variable.

### Lo que se quedo en el backend, y por que

Seis libs, todas reemplazadas y no descartadas:

| | |
|---|---|
| `cross-origin-auth.ts` | un solo origen: `route-auth.ts` |
| `supabase-service.ts`, `supabase-route.ts` | `supabase-admin.ts`, que comprueba su entorno y desactiva la persistencia de sesion. El de cookies ademas nunca hizo nada: las dos rutas que lo usaban llamaban a `getUser(token)` con un Bearer explicito |
| `money.ts`, `pricing.ts` | `fees.ts` es el superconjunto y se quedo con los centavos de Stripe |
| `solana/wallet.ts` | sin un solo importador, tambien en el backend |

### Variables que siguen sin estar en produccion

De la lista de la fase 5 estan todas salvo estas:

| | |
|---|---|
| `SOLANA_RPC_URL` | solo importa en mainnet, y alli `check:solana` impide caer en silencio al RPC publico |
| `OPENWEATHER_API_KEY` | opcional: sin ella no se sella un clima inventado (`check:context`) |
| `WALLET_ENCRYPTION_KEY` | ya no hace falta, ver arriba |

`GOOGLE_SHEETS_*` tampoco: los cupones se resuelven contra Stripe (#33), que es
donde vive el descuento.

### Lo que vivia fuera de git en la carpeta del backend

La carpeta local del backend tenia directorios ignorados que no estaban en
ningun repo. Antes de retirarla, cada uno encontro su sitio:

| | |
|---|---|
| `tbt_image_processor/` | es su propio repo, `cslucano/tbt_image_processor`, desplegado en AWS App Runner. **Produccion corria un middleware de `X-API-Key` y un `Dockerfile` que nunca se habian subido**: una peticion sin clave recibe su 401 exacto. Estan en `main` desde `ddca114` y `5b23614`, y la carpeta vive ahora junto a esta |
| Los `.docx` del spec y `tbt-auth.html` | copia identica en `Documentos/old/` |
| `Paginas/Landing.png` | en `Documentos/` |
| El resto | clones de repos de terceros y skills ya instaladas globalmente |

## Trampas que ya nos costaron tiempo

**El `vercel` de la carpeta `Forms` apuntaba al proyecto equivocado.** Estaba
vinculada a un proyecto muerto (`forms`, 140 días sin desplegar, ya borrado).
Cualquier `vercel env ls` ahí devolvía datos de otro sitio — y por eso llegué a
afirmar que Google Sheets no estaba configurado cuando no lo sabía. La carpeta
está desvinculada; el backend vivo es `brocha`.

**`✓ Compiled successfully` no significa que el build pasó.** Next compila y
*después* prerenderiza. Dos páginas compilaron limpias y fallaron al generar
por un `useSearchParams` sin límite de Suspense. Hay que leer más allá de esa
línea o mirar el código de salida.

**Las migraciones son de tbt-cafe.** `tbt-cafe/supabase/migrations`, contigua
desde 001. Las copias inertes que tenia el repo `tbt` se quedaron con el,
archivado.

**Variables de entorno.** Las cuatro `NEXT_PUBLIC_*` están en Production,
Preview y Development. `SUPABASE_SERVICE_ROLE_KEY` está **solo en Production**,
a propósito: las URLs de preview son compartibles y esa clave salta la RLS.
Eso implica que en preview fallan las rutas que la usan.

**El `CLAUDE.md` de `hdgarzon/tbt` está desactualizado**: dice que
`complete-transfer` llama a `POST /api/transfer-nft`. No es cierto — usa
`processTransferOnChain` de `@/lib/solana/transfer` directamente. Lo mismo con
el minteo. Esas dos rutas ya se borraron.

**Un `throw` en el cuerpo de un modulo rompe el build, no la ruta.** Lo tenian
`stripe.ts` y `app-env.ts`. Sin la clave, el `import` falla, y con el falla
cualquier ruta que lo importe y por transitividad el build entero. Los dos
construyen o comprueban ahora en el primer uso.

**`app-env` asumia localhost.** Si `NEXT_PUBLIC_APP_URL` no estaba, la
inferencia caia a `http://localhost:3000` y de ahi `isProduction` salia false —
que es lo unico que separa el cupon `TBT`, el que salta el pago entero, de estar
vivo. Aqui esa variable no existe, asi que copiar el archivo tal cual habria
puesto un bypass de pago en produccion. Ahora falla hacia produccion.

**`vercel env pull` NO devuelve los valores marcados Sensitive.** Devuelve el
literal `"[SENSITIVE]"`, doce caracteres, para cada uno. Un `env pull` seguido de
un `env add` en otro proyecto no copia diecisiete secretos: copia diecisiete
veces esa palabra. Todo falla despues con errores que apuntan a otra cosa
—`invalid_v2_key` en Stripe, un Account SID que no empieza por `AC`— porque el
valor existe y es basura, que es peor que ausente: ausente falla al arrancar y a
gritos; basura falla en el proveedor, horas mas tarde, con pinta de problema
suyo. Un secreto solo se recupera de su origen.

**zsh y los backticks.** Un mensaje de commit con `` `algo` `` se rompe por
sustitución de comandos. Escribirlos con `-F` desde archivo.

## Decisiones abiertas, no técnicas

- **Rotar** `SOLANA_PAYER_PRIVATE_KEY`: estuvo 140 días en un proyecto de
  Vercel que se borró, y borrarlo no la invalidó. `WALLET_ENCRYPTION_KEY` ya no
  protege nada desde la 032
- **`sk_test` o `sk_live`** en producción — sin confirmar
- **Moderación** de las preguntas de Roast, ya desplegadas
- **Cobertura de Connect por país**: mantiene `bank` deshabilitado y los
  bloques de payout en `processing`
- **Si la plataforma retiene el precio completo** (Spec 01 §1.1). Hoy Stripe
  solo cobra la tarifa y la regalía; el precio cambia de manos fuera
