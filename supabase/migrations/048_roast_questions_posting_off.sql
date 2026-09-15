-- ============================================================================
-- 048_roast_questions_posting_off.sql — Nadie publica preguntas en Roast, por ahora
-- ============================================================================
-- Update Package 01, N11.
--
-- Una pregunta era publica en cuanto se escribia: la 022 dejaba insertar a
-- quien tuviera sesion y leer a cualquiera, y `hidden` existia sin nadie que la
-- escribiera. No hay herramienta de administracion para revisar preguntas antes
-- de publicarlas, asi que se apaga el envio hasta que la haya. Es una de las dos
-- salidas que da el paquete. Hoy no hay ninguna pregunta: no se pierde nada.
--
-- Se retira la politica de insercion. Sin ella la RLS rechaza cualquier insert
-- desde el cliente, exista o no el formulario, que tambien se retira. La lectura
-- se queda como estaba.
--
-- Volver a abrirlo es crear la politica otra vez JUNTO con la moderacion, no
-- revertir esta migracion a secas.
--
-- No destructiva: no toca filas.
-- ============================================================================

drop policy if exists "own roast questions insertable" on public.roast_questions;

do $$
begin
  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'roast_questions'
       and cmd in ('INSERT', 'ALL')
  ) then
    raise exception '048: roast_questions todavia acepta inserciones desde el cliente';
  end if;
end
$$;
