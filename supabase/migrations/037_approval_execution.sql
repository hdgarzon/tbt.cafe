-- ============================================================================
-- 037_approval_execution.sql — Una aprobacion se gasta al usarse
-- ============================================================================
-- Backend Spec 07 §1.3, la regla de dos personas.
--
-- LO QUE FALTABA
--
-- `gateHighRisk` funciona en dos tiempos: la primera llamada deja la solicitud
-- pendiente, y la SEGUNDA —la de quien la inicio, ya con el `approvalId`— es la
-- que ejecuta. La tabla registraba las dos primeras partes y ninguna de la
-- tercera: no habia forma de saber si una aprobacion ya se habia usado.
--
-- De ahi dos cosas. Una aprobacion servia INDEFINIDAS veces, porque nada la
-- marcaba consumida. Y una aprobacion concedida y nunca aplicada era invisible:
-- la lista del panel solo mira `status = 'pending'`, asi que en cuanto alguien
-- aprobaba, la solicitud desaparecia de la pantalla sin haber hecho nada.
--
-- `executed_at` cierra las dos. Es nula mientras la accion espera a que quien
-- la inicio la aplique —y con eso se puede mostrar— y se sella en el mismo
-- UPDATE condicional que autoriza la ejecucion, asi que dos llamadas a la vez
-- solo pueden ganar una.
--
-- No destructiva. Las solicitudes ya resueltas quedan con `executed_at` nula,
-- que es correcto: nadie las ejecuto.
-- ============================================================================

alter table public.admin_pending_approvals
  add column if not exists executed_at timestamptz;

comment on column public.admin_pending_approvals.executed_at is
  'Cuando la accion aprobada se ejecuto de verdad. Nula mientras espera a que quien la inicio la aplique. Una aprobacion sirve UNA vez.';

-- Para la lista de «aprobadas y esperandote». Parcial: solo interesan las que
-- todavia no se han ejecutado, y son siempre unas pocas.
create index if not exists admin_approvals_awaiting_idx
  on public.admin_pending_approvals (initiator_id, resolved_at desc)
  where status = 'approved' and executed_at is null;
