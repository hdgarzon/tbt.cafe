# Unificar el backend en tbt-cafe

Estado al 20 ago 2026. Este documento existe para que la sesión que haga la
migración no vuelva a descubrir lo que ya costó descubrir.

## El objetivo

Un solo proyecto de Vercel. Hoy son dos:

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

## Estado: el codigo ya cruzo

**Las 27 rutas del backend estan en este repo**, desplegadas y verificadas en
produccion. Lo que queda no es codigo.

| Fase | | |
|---|---|---|
| 1 | Libs sin estado | hecha |
| 2 | Rutas sin sesion: `tbt-image/*`, `generate-context`, `espresso/extract`, `assistant` | hecha |
| 3 | Stripe, transferencias, `complete-*`, `validate-coupon`, notificaciones | hecha |
| 4 | Admin: 8 rutas, el guard y la cadena de notificacion | hecha |
| 5 | **Variables de entorno** y repunte del front | pendiente |
| 6 | Borrar `brocha` y resolver `www.tbt.cafe` | pendiente |

### Lo que se quedo en el backend, y por que

Seis libs, todas reemplazadas y no descartadas:

| | |
|---|---|
| `cross-origin-auth.ts` | un solo origen: `route-auth.ts` |
| `supabase-service.ts`, `supabase-route.ts` | `supabase-admin.ts`, que comprueba su entorno y desactiva la persistencia de sesion. El de cookies ademas nunca hizo nada: las dos rutas que lo usaban llamaban a `getUser(token)` con un Bearer explicito |
| `money.ts`, `pricing.ts` | `fees.ts` es el superconjunto y se quedo con los centavos de Stripe |
| `solana/wallet.ts` | sin un solo importador, tambien en el backend |

### Fase 5: lo que hace falta para que algo de esto se use

Hoy hay 27 rutas correctas a las que nadie llama: el front sigue apuntando a
`NEXT_PUBLIC_TBT_BACKEND_URL`. Faltan estas variables en este proyecto:

```
NEXT_PUBLIC_APP_URL              STRIPE_SECRET_KEY          STRIPE_WEBHOOK_SECRET
TBT_IMAGE_PROCESSOR_URL          TBT_IMAGE_PROCESSOR_API_KEY
GEMINI_API_KEY                   OPENWEATHER_API_KEY
RESEND_API_KEY                   RESEND_FROM_EMAIL
TWILIO_ACCOUNT_SID               TWILIO_AUTH_TOKEN          TWILIO_PHONE_NUMBER
AWS_ACCESS_KEY_ID                AWS_SECRET_ACCESS_KEY      AWS_REGION
GOOGLE_SHEETS_*                  SOLANA_*                   WALLET_ENCRYPTION_KEY
```

`SOLANA_PAYER_PRIVATE_KEY` y `WALLET_ENCRYPTION_KEY` **hay que rotarlas antes**:
estuvieron 140 dias en un proyecto de Vercel que se borro, y borrarlo no las
invalido.

Con eso puesto, el repunte son unas pocas lineas en `brew-data.ts`,
`admin/page.tsx` y `backend.ts`.

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
001→022, todas aplicadas en `tbt-brocha`. El repo `tbt` tiene copias inertes de
001, 002, 003 y 010 con un README que apunta aquí; conviene borrarlas cuando se
confirme que nadie las lee por ruta.

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

**zsh y los backticks.** Un mensaje de commit con `` `algo` `` se rompe por
sustitución de comandos. Escribirlos con `-F` desde archivo.

## Decisiones abiertas, no técnicas

- **Rotar** `SOLANA_PAYER_PRIVATE_KEY` y `WALLET_ENCRYPTION_KEY`: estuvieron
  140 días en el proyecto borrado. Borrarlo no las invalidó
- **`sk_test` o `sk_live`** en producción — sin confirmar
- **Moderación** de las preguntas de Roast, ya desplegadas
- **Cobertura de Connect por país**: mantiene `bank` deshabilitado y los
  bloques de payout en `processing`
- **Si la plataforma retiene el precio completo** (Spec 01 §1.1). Hoy Stripe
  solo cobra la tarifa y la regalía; el precio cambia de manos fuera
