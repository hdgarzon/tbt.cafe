-- ============================================================================
-- 054_biometric_second_factor_only.sql — El biométrico se suma al código, nunca lo sustituye
-- ============================================================================
-- Lista maestra 26 sep, D1 (decidido: opción b). El biométrico es solo un
-- segundo factor. El camino de "autenticación rápida" —un toque en lugar del
-- código SMS— se retira: sus rutas (`/api/webauthn/auth/begin` y `finish`) y
-- su pantalla ya no existen.
--
-- `quick` era el valor por defecto desde la 002 y significaba "la aserción
-- basta para iniciar sesión". Sin ruta que lo honre, es un valor que dice algo
-- falso; se convierte en `extra` y se prohíbe. La política "own credentials"
-- deja al dueño escribir sus filas, así que la restricción es lo que impide que
-- el cliente vuelva a guardar `quick` por su cuenta.
--
-- No destructiva: ninguna credencial se borra; solo cambia su modo.
-- ============================================================================

update public.webauthn_credentials set bio_mode = 'extra' where bio_mode <> 'extra';

alter table public.webauthn_credentials alter column bio_mode set default 'extra';

alter table public.webauthn_credentials drop constraint if exists webauthn_credentials_bio_mode_extra;
alter table public.webauthn_credentials
  add constraint webauthn_credentials_bio_mode_extra check (bio_mode = 'extra');

comment on column public.webauthn_credentials.bio_mode is
  'Siempre extra: el biométrico se exige además del código SMS y nunca lo sustituye (lista maestra D1, migración 054). El antiguo quick se retiró.';
