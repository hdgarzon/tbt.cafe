-- ============================================================================
-- 022_roast_questions.sql — Preguntas al pie de los artículos de Roast
-- ============================================================================
-- Roast es la superficie de aprendizaje, y el prototipo deja preguntar al pie
-- de cada artículo. Leer está abierto; preguntar exige autenticación.
--
-- En el prototipo las preguntas viven en memoria y vienen sembradas — el
-- README las lista entre las ayudas de demo a eliminar en el cutover. Aquí
-- necesitan tabla.
--
-- NO ESTÁ EN NINGUNA DE LAS SIETE ESPECIFICACIONES. Es comportamiento que solo
-- existe en el prototipo, así que esto implementa lo que el prototipo hace y
-- nada más. En particular NO hay moderación: `hidden` permite retirar una
-- pregunta desde la herramienta de administración, pero quién puede hacerlo y
-- bajo qué criterio es una decisión de producto que nadie ha tomado.
--
-- No destructiva.
-- ============================================================================

create table if not exists public.roast_questions (
  id uuid primary key default gen_random_uuid(),
  -- Id del artículo, no una foránea: los artículos viven en el código, no en
  -- la base. Una obra se borra; un artículo se despliega.
  article_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Congelado al escribir. Si alguien cambia su alias después, la pregunta
  -- sigue mostrando con qué nombre se hizo.
  author_name text not null,
  body text not null check (length(trim(body)) between 1 and 2000),

  -- Retirada. Sin política de moderación todavía: solo el service role la
  -- escribe, desde administración.
  hidden boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists roast_questions_article_idx
  on public.roast_questions (article_id, created_at desc) where not hidden;

create index if not exists roast_questions_user_idx
  on public.roast_questions (user_id);

alter table public.roast_questions enable row level security;

-- Lectura abierta: las preguntas y sus respuestas son parte del artículo, y
-- alguien que llega sin sesión a aprender qué es un TBT tiene que verlas.
drop policy if exists "roast questions readable" on public.roast_questions;
create policy "roast questions readable" on public.roast_questions
  for select using (not hidden);

-- Escribe quien tiene sesión, y solo a su propio nombre. El `with check` sobre
-- user_id es lo que impide firmar una pregunta como otra persona.
drop policy if exists "own roast questions insertable" on public.roast_questions;
create policy "own roast questions insertable" on public.roast_questions
  for insert with check ((select auth.uid()) = user_id);
