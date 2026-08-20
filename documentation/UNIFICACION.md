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

## Orden sugerido

Cada fase verificable sola, sin dejar `tbt.cafe` roto en medio.

1. **Dependencias y libs sin estado** — `money.ts`/`fees.ts` reconciliados,
   `pricing`, `transfer-code`, `solana/`. Nada las llama todavía.
2. **Rutas por familias**, empezando por las que menos dependen de sesión:
   `tbt-image/*`, `generate-context`, `espresso/extract`, `assistant`
3. **Stripe y transferencias** — `stripe/*`, `transfer/*`, `complete-*`.
   Aquí vive el dinero; una familia por PR
4. **Admin** — 8 rutas, todas detrás de permiso y step-up
5. **Notificaciones** — `send-email`, `send-sms`, `twilio/status`
6. **Corte de dominio** — `www` deja de servir la app y `brocha` se borra

Las rutas viejas pueden quedar vivas mientras tanto: mover no es borrar.
Borrar `brocha` es el último paso, no el primero.

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
