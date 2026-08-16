-- Anotaciones y registros correctivos — Backend Spec 07 §6.
--
-- Hay cosas que la herramienta NO puede hacer, y no por falta de tiempo: quitar
-- el registro de un TBT, revertir una transferencia en cadena, reescribir un
-- registro de registración, alterar una regalía ya congelada. El activo en
-- Solana y el registro en Arweave son permanentes.
--
-- Eso no es una limitación que haya que rodear: ES LA PROMESA DEL PRODUCTO. Un
-- certificado que el emisor puede revisar en silencio no es un certificado.
--
-- Lo que sí puede hacer es esto: anotar el registro y emitir un registro
-- correctivo que SUPERSEDE sin borrar. Por eso esta tabla solo crece, y por eso
-- una corrección apunta a lo que corrige en vez de reemplazarlo.
--
-- El spec avisa de que llegarán peticiones de "arréglalo en la base y ya". La
-- respuesta para lo escrito en cadena es no, y la herramienta debería hacerlo
-- estructuralmente cierto en vez de dejarlo a la disciplina de quien esté de
-- turno.

create table if not exists public.work_annotations (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,

  kind text not null check (kind in ('note', 'correction', 'flag')),
  body text not null,

  -- Una corrección señala la anotación que supersede. Nada se borra: se lee la
  -- cadena entera y la última vigente manda.
  supersedes uuid references public.work_annotations(id),

  actor_id uuid not null references auth.users(id),
  actor_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists work_annotations_work_idx
  on public.work_annotations (work_id, created_at desc);

alter table public.work_annotations enable row level security;

-- Solo el equipo las lee, y solo a través de la herramienta.
drop policy if exists "annotations readable by team" on public.work_annotations;
create policy "annotations readable by team" on public.work_annotations
  for select using (public.admin_has('works.view'));

-- Igual que la bitácora: se añade, no se reescribe. Una anotación editable
-- valdría lo mismo que no tenerla.
create or replace function public.work_annotations_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'work_annotations is append-only — supersede instead of editing';
end;
$$;

drop trigger if exists work_annotations_no_update on public.work_annotations;
create trigger work_annotations_no_update
  before update or delete on public.work_annotations
  for each row execute function public.work_annotations_append_only();

revoke update, delete on public.work_annotations from anon, authenticated, service_role;
