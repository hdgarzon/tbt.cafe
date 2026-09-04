-- ============================================================================
-- schema-snapshot.sql — El esquema completo de public, tal como esta hoy
-- ============================================================================
-- POR QUE NO SE LLAMA schema.sql
--
-- Ese nombre esta reservado, y con motivo: el .gitignore lo aparta porque es
-- donde `supabase db dump` deja SU volcado, que se regenera y no se versiona.
-- Este archivo es otra cosa —una foto hecha a mano contra el catalogo, para
-- que el repositorio deje de ser incapaz de describir su propia base— y por
-- eso lleva nombre propio.
--
-- El dia que se enlace el proyecto con la CLI de Supabase, `supabase db dump`
-- hace esto mejor y de forma mantenible. Entonces este archivo sobra.
--
-- QUE ES ESTO, Y QUE NO ES
--
-- Es una FOTOGRAFIA del destino, no una migracion. Describe donde tiene que
-- llegar una base vacia; no reproduce el camino por el que la de produccion
-- llego hasta aqui. No lo ejecutes contra la base de produccion: no hace
-- falta, y no esta pensado para eso.
--
-- POR QUE EXISTE
--
-- Las migraciones de `supabase/migrations/` empiezan en 001 y dan por supuesto
-- un esquema base que no esta en ninguna parte del repositorio. De las 44 tablas
-- que habia entonces, 28 se podian reconstruir desde alli y 16 no — y entre esas
-- 16 estaba el nucleo entero del producto: works, profiles, certificates,
-- context_snapshots, work_commerce, tbt_payments, ownership_history y transfers.
-- Este archivo llevaba 0 bytes.
--
-- (Las migraciones 031 y 032 quitaron seis de aquellas tablas por no tener
-- escritor, wallets entre ellas. Quedan 38.)
--
-- Sin el, si esta base se perdiera, el repositorio no podria rehacerla.
--
-- COMO SE GENERO, Y QUE FALTA
--
-- Leyendo el catalogo de la base viva: information_schema.columns, pg_
-- constraint, pg_indexes y pg_policies. Por tanto NO incluye:
--
--   funciones y triggers   viven en las migraciones que los crearon y si son
--                          reproducibles desde el repositorio
--   objetos de storage     el bucket `works-media` se crea desde el panel
--   datos semilla          payout_methods y platform_config traen filas de
--                          configuracion que las migraciones insertan
--
-- Las tablas se crean todas primero y las claves ajenas se anaden despues, a
-- proposito: asi el orden entre ellas deja de importar.
--
-- COMO MANTENERLO
--
-- Regenerar despues de cada migracion que cambie el esquema. Si diverge, la
-- base viva manda: esto es una copia, no la fuente.
-- ============================================================================

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Secuencias ──────────────────────────────────────────────────────────────

create sequence if not exists public.ticket_ref_seq;

-- ── Tipos enumerados ────────────────────────────────────────────────────────

do $$ begin
  create type public.creator_type as enum ('individual', 'group', 'corporation');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.originality_declaration as enum ('original', 'derivative', 'authorized_edition');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.royalty_type as enum ('fixed', 'percentage');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tbt_status as enum ('draft', 'pending_payment', 'immutable', 'transferred');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transfer_status as enum ('pending', 'payment_pending', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transfer_type as enum ('automatic', 'manual', 'gift');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.work_status as enum ('draft', 'certified', 'transferred', 'archived');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- TABLAS — el nucleo
-- ============================================================================

create table if not exists public.profiles (
  id uuid not null,
  email text,
  phone text,
  display_name text not null,
  legal_name text,
  bio text,
  avatar_url text,
  is_creator boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  creator_type text default 'individual'::text,
  collective_name text,
  lead_representative text,
  entity_name text,
  tax_id text,
  public_alias text,
  physical_address jsonb,
  credentials text,
  social_linkedin text,
  social_website text,
  social_instagram text,
  social_other text[],
  corporate_title text,
  social_facebook text[],
  social_youtube text[],
  collector_alias text,
  collector_anonymous boolean default false not null,
  creator_category text,
  language_override text,
  recovery_email text,
  recovery_email_verified boolean default false not null,
  private_code_hash text,
  private_code_freq text,
  collector_category text,
  collector_location text,
  collector_about text,
  collector_website text,
  covered_registrations_granted integer default 0 not null,
  payout_country text
);

create table if not exists public.works (
  id uuid default extensions.uuid_generate_v4() not null,
  tbt_id text not null,
  creator_id uuid not null,
  current_owner_id uuid not null,
  title text not null,
  description text,
  category text,
  technique text,
  media_url text,
  media_type text,
  status work_status default 'draft'::work_status,
  created_at timestamp with time zone default now(),
  certified_at timestamp with time zone,
  primary_material text,
  creation_date date,
  is_published boolean default false,
  asset_links text[],
  originality_type text default 'original'::text,
  original_work_reference text,
  context_data jsonb,
  context_summary text,
  context_signed_at timestamp with time zone,
  payment_status text default 'pending'::text,
  payment_intent_id text,
  payment_completed_at timestamp with time zone,
  mms_sent_at timestamp with time zone,
  mms_delivery_status text,
  work_visibility text default 'publicado'::text,
  about_work text,
  audio_video_url text,
  audio_video_type text,
  market_price numeric(12,2),
  currency text default 'USD'::text,
  royalty_type text default 'none'::text,
  royalty_value text,
  signature_phone text,
  transfer_status text default 'active'::text,
  transferred_at timestamp with time zone,
  cancelled_certificate_url text,
  mint_address text,
  blockchain text default 'solana'::text,
  token_uri text,
  nft_status text default 'pending'::text,
  series_id uuid,
  is_featured boolean default false not null,
  transfer_code_hash text,
  content_hash text,
  registration_record_uri text,
  registration_record_hash text
);

comment on column public.works.mint_address is
  'La direccion del NFT. La migracion 031 quito su gemela muerta nft_mint_address.';
comment on column public.works.transfer_code is
  'Resto anterior al hash. El codigo es un secreto al portador y se guarda en transfer_code_hash; nada lee esta columna.';

create table if not exists public.work_commerce (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid not null,
  initial_price numeric(12,2),
  currency text default 'USD'::text,
  royalty_type royalty_type default 'percentage'::royalty_type,
  royalty_value numeric(12,2) default 10.00,
  is_for_sale boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  availability text default 'not_for_sale'::text not null,
  taking_offers boolean default false not null,
  royalty_locked boolean default false not null
);

create table if not exists public.certificates (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid not null,
  owner_id uuid not null,
  certificate_url text,
  qr_code_data text,
  version integer default 1,
  generated_at timestamp with time zone default now(),
  valid_until timestamp with time zone
);

create table if not exists public.context_snapshots (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid,
  gps_coordinates jsonb,
  location_name text,
  country text,
  city text,
  weather_data jsonb,
  top_headlines text[],
  market_data jsonb,
  ai_summary text,
  ai_model text,
  user_edited_summary text,
  signed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  general_context text,
  contemporary_context text,
  elaboration_type text
);

create table if not exists public.ownership_history (
  id uuid default gen_random_uuid() not null,
  work_id uuid not null,
  owner_name text not null,
  owner_user_id uuid,
  event_type text not null,
  previous_owner_name text,
  transfer_type text,
  price numeric,
  currency text,
  sequence_number integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  record_uri text,
  record_hash text
);

create table if not exists public.transfers (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid not null,
  from_owner_id uuid not null,
  to_owner_id uuid not null,
  transfer_type transfer_type not null,
  sale_price numeric(12,2),
  royalty_amount numeric(12,2),
  royalty_paid boolean default false,
  payment_reference text,
  payment_link text,
  notes text,
  status transfer_status default 'pending'::transfer_status,
  initiated_at timestamp with time zone default now(),
  completed_at timestamp with time zone,
  new_owner_name text,
  new_owner_phone text,
  payment_status text default 'pending'::text,
  stripe_checkout_session_id text,
  created_at timestamp with time zone default now(),
  is_two_phase boolean default false not null,
  stripe_payment_intent_id text,
  authorized_at timestamp with time zone,
  outcome text
);

create table if not exists public.tbt_payments (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid,
  user_id uuid,
  amount numeric(10,2) default 8 not null,
  currency text default 'USD'::text,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  completed_at timestamp with time zone,
  metadata jsonb
);


-- ============================================================================
-- TABLAS — cuenta, admin y soporte
-- ============================================================================

create table if not exists public.admin_members (
  user_id uuid not null,
  display_name text not null,
  permissions jsonb default '{}'::jsonb not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.admin_audit_log (
  id uuid default gen_random_uuid() not null,
  actor_id uuid not null,
  actor_name text not null,
  approver_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  ip text,
  user_agent text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.admin_pending_approvals (
  id uuid default gen_random_uuid() not null,
  action text not null,
  entity_type text,
  entity_id text,
  payload jsonb default '{}'::jsonb not null,
  reason text not null,
  initiator_id uuid not null,
  approver_id uuid,
  status text default 'pending'::text not null,
  expires_at timestamp with time zone default (now() + '24:00:00'::interval) not null,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table if not exists public.admin_step_up (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  token_hash text not null,
  used_biometric boolean default false not null,
  used_private_code boolean default false not null,
  expires_at timestamp with time zone default (now() + '00:15:00'::interval) not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.biometric_proofs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  token_hash text not null,
  consumed_at timestamp with time zone,
  expires_at timestamp with time zone default (now() + '00:10:00'::interval) not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.webauthn_credentials (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  credential_id text not null,
  public_key text not null,
  sign_count bigint default 0 not null,
  transports text[],
  device_label text,
  bio_mode text default 'quick'::text not null,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone
);

create table if not exists public.webauthn_challenges (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  challenge text not null,
  kind text not null,
  expires_at timestamp with time zone default (now() + '00:05:00'::interval) not null,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.private_code_attempts (
  user_id uuid not null,
  failed_count integer default 0 not null,
  last_failed_at timestamp with time zone,
  locked_until timestamp with time zone
);

create table if not exists public.money_action_auth (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  action text not null,
  amount numeric(12,2),
  work_id uuid,
  required_biometric boolean default false not null,
  required_three_ds boolean default false not null,
  required_private_code boolean default false not null,
  satisfied_biometric boolean default false not null,
  satisfied_private_code boolean default false not null,
  biometric_threshold_at_time numeric(12,2),
  three_ds_threshold_at_time numeric(12,2),
  created_at timestamp with time zone default now() not null
);

create table if not exists public.tickets (
  id uuid default gen_random_uuid() not null,
  ref text default ('HR-'::text || nextval('ticket_ref_seq'::regclass)) not null,
  origin text not null,
  category text not null,
  severity text not null,
  status text default 'open'::text not null,
  subject text not null,
  body text not null,
  subject_user uuid not null,
  assigned_to uuid,
  context jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table if not exists public.ticket_replies (
  id uuid default gen_random_uuid() not null,
  ticket_id uuid not null,
  author_type text not null,
  author_name text not null,
  body text not null,
  internal boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.notifications (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  event_key text not null,
  category text not null,
  params jsonb default '{}'::jsonb not null,
  href text,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.notification_prefs (
  user_id uuid not null,
  prefs jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.platform_config (
  id boolean default true not null,
  covered_brews_enabled boolean default true not null,
  covered_brews_count integer default 10 not null,
  updated_at timestamp with time zone default now() not null,
  settlement_days_standard integer default 7 not null,
  settlement_days_high integer default 14 not null,
  settlement_high_threshold numeric(12,2) default 1000 not null,
  payout_platform_pct numeric(6,4) default 0.0230 not null,
  biometric_threshold numeric(12,2) default 500 not null,
  three_ds_threshold numeric(12,2) default 1000 not null
);

create table if not exists public.covered_registrations (
  id uuid default gen_random_uuid() not null,
  creator_id uuid not null,
  work_id uuid,
  amount numeric(12,2) not null,
  currency text default 'USD'::text not null,
  reason text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.provider_events (
  id uuid default gen_random_uuid() not null,
  provider text not null,
  operation text not null,
  ok boolean not null,
  error_code text,
  error_detail jsonb,
  latency_ms integer,
  entity_type text,
  entity_id text,
  created_at timestamp with time zone default now() not null
);

-- ============================================================================
-- TABLAS — pagos y cobros
-- ============================================================================

create table if not exists public.payout_methods (
  id text not null,
  display_name_key text not null,
  enabled boolean default true not null,
  countries text[] default ARRAY['*'::text] not null,
  provider text not null,
  dest_field_type text not null,
  dest_network text,
  dest_validation text,
  dest_requires_confirm boolean default false not null,
  dest_label_key text not null,
  platform_pct numeric(6,4) default 0.0230 not null,
  method_pct numeric(6,4) default 0 not null,
  method_flat numeric(12,2) default 0 not null,
  min_amount numeric(12,2),
  max_amount numeric(12,2),
  settlement_estimate_key text not null,
  sort_order integer default 0 not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.payout_destinations (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  method_id text not null,
  destination text not null,
  destination_masked text not null,
  network text,
  is_default boolean default false not null,
  verified_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.payout_connect_accounts (
  user_id uuid not null,
  account_id text not null,
  country text not null,
  status text default 'onboarding'::text not null,
  transfers_enabled boolean default false not null,
  requirements_due text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.payout_blocks (
  id uuid default gen_random_uuid() not null,
  block_id text not null,
  user_id uuid not null,
  method_id text not null,
  destination_masked text not null,
  gross numeric(12,2) not null,
  platform_fee numeric(12,2) not null,
  method_fee numeric(12,2) not null,
  net numeric(12,2) not null,
  status text default 'processing'::text not null,
  provider_reference text,
  failure_reason text,
  created_at timestamp with time zone default now() not null,
  settled_at timestamp with time zone
);

create table if not exists public.payout_earnings (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  source text not null,
  work_id uuid,
  source_ref uuid,
  amount numeric(12,2) not null,
  currency text default 'USD'::text not null,
  state text default 'pending'::text not null,
  releases_at timestamp with time zone,
  hold_reason text,
  payout_block_id uuid,
  created_at timestamp with time zone default now() not null,
  released_at timestamp with time zone,
  collected_at timestamp with time zone
);

create table if not exists public.chain_anchors (
  record_hash text not null,
  record_kind text not null,
  record_uri text,
  ots_proof bytea not null,
  status text default 'pending'::text not null,
  block_height integer,
  attested_at timestamp with time zone,
  upgrade_attempts integer default 0 not null,
  last_attempt_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

comment on table public.chain_anchors is
  'Anclas de OpenTimestamps. La prueba se guarda entera: sin ella el ancla no vale nada.';

create table if not exists public.payment_disputes (
  provider_ref text not null,
  kind text not null,
  charge_id text,
  payment_intent_id text,
  work_id uuid,
  transfer_id uuid,
  subject_user uuid,
  status text not null,
  amount numeric(12,2) not null,
  currency text not null,
  reason text,
  raw jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.mms_deliveries (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid,
  user_id uuid,
  phone_number text not null,
  twilio_message_sid text,
  status text default 'pending'::text,
  certificate_url text,
  gif_url text,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone default now()
);

create table if not exists public.email_deliveries (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid,
  user_id uuid,
  email text not null,
  resend_message_id text,
  status text default 'pending'::text,
  certificate_url text,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone default now()
);

-- ============================================================================
-- TABLAS — descubrimiento y comunidad
-- ============================================================================

create table if not exists public.work_series (
  id uuid default gen_random_uuid() not null,
  creator_id uuid not null,
  name text not null,
  slug text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.work_annotations (
  id uuid default gen_random_uuid() not null,
  work_id uuid not null,
  kind text not null,
  body text not null,
  supersedes uuid,
  actor_id uuid not null,
  actor_name text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.favorites (
  user_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.curations (
  id uuid default gen_random_uuid() not null,
  author_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  technique smallint,
  color smallint,
  meaning smallint,
  body text not null,
  is_public boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.offers (
  id uuid default gen_random_uuid() not null,
  work_id uuid not null,
  from_user uuid not null,
  amount numeric(12,2) not null,
  currency text default 'USD'::text not null,
  status text default 'open'::text not null,
  solicited boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.roast_questions (
  id uuid default gen_random_uuid() not null,
  article_id text not null,
  user_id uuid not null,
  author_name text not null,
  body text not null,
  hidden boolean default false not null,
  created_at timestamp with time zone default now() not null
);

-- ============================================================================
-- TABLAS — sin escritor
-- ============================================================================
-- Aqui habia seis. La migracion 031 quito cinco: email_deliveries, work_context,
-- work_views, plagiarism_checks y alerts, todas restos de disenos que algo mas
-- reemplazo.
--
-- Queda una, y no por descuido: `plagiarism_scans` tampoco tiene escritor, pero
-- la migracion 003 la designo canonica. Quitarla seria deshacer una decision de
-- diseno en vez de limpiar un resto.
-- ============================================================================

comment on table public.email_deliveries is
  'Sin escritor. Es de la epoca de SendGrid, que nunca se uso; provider_events la reemplazo.';

comment on table public.alerts is
  'Sin escritor. La reemplazo notifications; la pestana de la interfaz que se llama "alerts" lee de aquella.';

create table if not exists public.plagiarism_scans (
  id uuid default extensions.uuid_generate_v4() not null,
  work_id uuid not null,
  scan_result jsonb,
  similarity_score numeric(5,2),
  flagged_items jsonb[],
  is_original boolean default true,
  scanned_at timestamp with time zone default now()
);

comment on table public.plagiarism_scans is
  'Canonica, pero todavia sin escritor: las rutas de tbt-image reenvian al procesador y no guardan el resultado.';

-- ============================================================================
-- CLAVES Y RESTRICCIONES
-- ============================================================================
-- Van despues de todas las tablas a proposito: asi el orden de creacion entre
-- ellas deja de importar y una clave ajena nunca apunta a algo que aun no
-- existe.
-- ============================================================================

alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.works add constraint works_pkey PRIMARY KEY (id);
alter table public.works add constraint works_tbt_id_key UNIQUE (tbt_id);
alter table public.works add constraint valid_tbt_id CHECK ((tbt_id ~ '^TBT-[0-9]{4}-[A-Z0-9]{6}$'::text));
alter table public.works add constraint works_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public.works add constraint works_current_owner_id_fkey FOREIGN KEY (current_owner_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public.works add constraint works_series_id_fkey FOREIGN KEY (series_id) REFERENCES work_series(id) ON DELETE SET NULL;

alter table public.work_commerce add constraint work_commerce_pkey PRIMARY KEY (id);
alter table public.work_commerce add constraint work_commerce_work_id_key UNIQUE (work_id);
alter table public.work_commerce add constraint work_commerce_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.work_commerce add constraint work_commerce_availability_check CHECK ((availability = ANY (ARRAY['for_sale'::text, 'reserved'::text, 'not_for_sale'::text])));
alter table public.work_commerce add constraint valid_royalty_percentage CHECK (((royalty_type <> 'percentage'::royalty_type) OR ((royalty_value >= (0)::numeric) AND (royalty_value <= (50)::numeric))));
alter table public.work_commerce add constraint valid_royalty_fixed CHECK (((royalty_type <> 'fixed'::royalty_type) OR (royalty_value >= (0)::numeric)));

alter table public.certificates add constraint certificates_pkey PRIMARY KEY (id);
alter table public.certificates add constraint certificates_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.certificates add constraint certificates_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE RESTRICT;

alter table public.context_snapshots add constraint context_snapshots_pkey PRIMARY KEY (id);
alter table public.context_snapshots add constraint context_snapshots_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;

alter table public.ownership_history add constraint ownership_history_pkey PRIMARY KEY (id);
alter table public.ownership_history add constraint ownership_history_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.ownership_history add constraint ownership_history_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.ownership_history add constraint ownership_history_event_type_check CHECK ((event_type = ANY (ARRAY['creation'::text, 'transfer'::text])));
alter table public.ownership_history add constraint ownership_history_transfer_type_check CHECK ((transfer_type = ANY (ARRAY['sale'::text, 'gift'::text, NULL::text])));

alter table public.transfers add constraint transfers_pkey PRIMARY KEY (id);
alter table public.transfers add constraint transfers_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE RESTRICT;
alter table public.transfers add constraint transfers_from_owner_id_fkey FOREIGN KEY (from_owner_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public.transfers add constraint transfers_to_owner_id_fkey FOREIGN KEY (to_owner_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public.transfers add constraint different_owners CHECK ((from_owner_id <> to_owner_id));
alter table public.transfers add constraint transfers_outcome_check CHECK ((outcome = ANY (ARRAY['accepted'::text, 'rejected'::text, 'lapsed'::text, 'cancelled'::text])));

alter table public.tbt_payments add constraint tbt_payments_pkey PRIMARY KEY (id);
alter table public.tbt_payments add constraint tbt_payments_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.tbt_payments add constraint tbt_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;


alter table public.admin_members add constraint admin_members_pkey PRIMARY KEY (user_id);
alter table public.admin_members add constraint admin_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.admin_audit_log add constraint admin_audit_log_pkey PRIMARY KEY (id);
alter table public.admin_audit_log add constraint admin_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table public.admin_audit_log add constraint admin_audit_log_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES auth.users(id);
alter table public.admin_pending_approvals add constraint admin_pending_approvals_pkey PRIMARY KEY (id);
alter table public.admin_pending_approvals add constraint admin_pending_approvals_initiator_id_fkey FOREIGN KEY (initiator_id) REFERENCES auth.users(id);
alter table public.admin_pending_approvals add constraint admin_pending_approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES auth.users(id);
alter table public.admin_pending_approvals add constraint admin_pending_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])));
alter table public.admin_pending_approvals add constraint approver_is_not_initiator CHECK (((approver_id IS NULL) OR (approver_id <> initiator_id)));
alter table public.admin_step_up add constraint admin_step_up_pkey PRIMARY KEY (id);
alter table public.admin_step_up add constraint admin_step_up_token_hash_key UNIQUE (token_hash);
alter table public.admin_step_up add constraint admin_step_up_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.biometric_proofs add constraint biometric_proofs_pkey PRIMARY KEY (id);
alter table public.biometric_proofs add constraint biometric_proofs_token_hash_key UNIQUE (token_hash);
alter table public.biometric_proofs add constraint biometric_proofs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.webauthn_credentials add constraint webauthn_credentials_pkey PRIMARY KEY (id);
alter table public.webauthn_credentials add constraint webauthn_credentials_credential_id_key UNIQUE (credential_id);
alter table public.webauthn_credentials add constraint webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.webauthn_challenges add constraint webauthn_challenges_pkey PRIMARY KEY (id);
alter table public.webauthn_challenges add constraint webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.private_code_attempts add constraint private_code_attempts_pkey PRIMARY KEY (user_id);
alter table public.private_code_attempts add constraint private_code_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.money_action_auth add constraint money_action_auth_pkey PRIMARY KEY (id);
alter table public.money_action_auth add constraint money_action_auth_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.money_action_auth add constraint money_action_auth_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
alter table public.money_action_auth add constraint money_action_auth_action_check CHECK ((action = ANY (ARRAY['purchase'::text, 'offer_accept'::text, 'transfer_initiate'::text, 'payout_collect'::text, 'payout_destination'::text])));
alter table public.tickets add constraint tickets_pkey PRIMARY KEY (id);
alter table public.tickets add constraint tickets_ref_key UNIQUE (ref);
alter table public.tickets add constraint tickets_subject_user_fkey FOREIGN KEY (subject_user) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tickets add constraint tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.tickets add constraint tickets_origin_check CHECK ((origin = ANY (ARRAY['human'::text, 'system'::text, 'ai_escalation'::text])));
alter table public.tickets add constraint tickets_category_check CHECK ((category = ANY (ARRAY['payments'::text, 'payouts'::text, 'transfers'::text, 'registration'::text, 'authentication'::text, 'other'::text])));
alter table public.tickets add constraint tickets_severity_check CHECK ((severity = ANY (ARRAY['financial'::text, 'secondary'::text])));
alter table public.tickets add constraint tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'answered'::text, 'resolved'::text, 'closed'::text])));
alter table public.ticket_replies add constraint ticket_replies_pkey PRIMARY KEY (id);
alter table public.ticket_replies add constraint ticket_replies_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
alter table public.ticket_replies add constraint ticket_replies_author_type_check CHECK ((author_type = ANY (ARRAY['customer'::text, 'team'::text, 'system'::text, 'ai'::text])));
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_category_check CHECK ((category = ANY (ARRAY['tbt'::text, 'security'::text, 'transactional'::text, 'support'::text, 'payouts'::text])));
alter table public.notification_prefs add constraint notification_prefs_pkey PRIMARY KEY (user_id);
alter table public.notification_prefs add constraint notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.platform_config add constraint platform_config_pkey PRIMARY KEY (id);
alter table public.platform_config add constraint platform_config_id_check CHECK (id);
alter table public.platform_config add constraint platform_config_covered_brews_count_check CHECK ((covered_brews_count >= 0));
alter table public.platform_config add constraint platform_config_settlement_days_standard_check CHECK ((settlement_days_standard >= 0));
alter table public.platform_config add constraint platform_config_settlement_days_high_check CHECK ((settlement_days_high >= 0));
alter table public.platform_config add constraint platform_config_settlement_high_threshold_check CHECK ((settlement_high_threshold >= (0)::numeric));
alter table public.platform_config add constraint platform_config_payout_platform_pct_check CHECK ((payout_platform_pct >= (0)::numeric));
alter table public.platform_config add constraint platform_config_biometric_threshold_check CHECK ((biometric_threshold >= (0)::numeric));
alter table public.platform_config add constraint platform_config_three_ds_threshold_check CHECK ((three_ds_threshold >= (0)::numeric));
alter table public.covered_registrations add constraint covered_registrations_pkey PRIMARY KEY (id);
alter table public.covered_registrations add constraint covered_registrations_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.covered_registrations add constraint covered_registrations_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
alter table public.covered_registrations add constraint covered_registrations_reason_check CHECK ((reason = ANY (ARRAY['first_n_allowance'::text, 'admin_grant'::text])));
alter table public.provider_events add constraint provider_events_pkey PRIMARY KEY (id);

alter table public.payout_methods add constraint payout_methods_pkey PRIMARY KEY (id);
alter table public.payout_methods add constraint payout_methods_provider_check CHECK ((provider = ANY (ARRAY['stripe_connect_stablecoin'::text, 'stripe_connect_bank'::text, 'other'::text])));
alter table public.payout_methods add constraint payout_methods_dest_field_type_check CHECK ((dest_field_type = ANY (ARRAY['wallet_address'::text, 'bank_account'::text, 'pix_key'::text, 'phone'::text, 'email'::text])));
alter table public.payout_destinations add constraint payout_destinations_pkey PRIMARY KEY (id);
alter table public.payout_destinations add constraint payout_destinations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.payout_destinations add constraint payout_destinations_method_id_fkey FOREIGN KEY (method_id) REFERENCES payout_methods(id);
alter table public.payout_connect_accounts add constraint payout_connect_accounts_pkey PRIMARY KEY (user_id);
alter table public.payout_connect_accounts add constraint payout_connect_accounts_account_id_key UNIQUE (account_id);
alter table public.payout_connect_accounts add constraint payout_connect_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.payout_connect_accounts add constraint payout_connect_accounts_status_check CHECK ((status = ANY (ARRAY['onboarding'::text, 'active'::text, 'restricted'::text, 'rejected'::text])));
alter table public.payout_blocks add constraint payout_blocks_pkey PRIMARY KEY (id);
alter table public.payout_blocks add constraint payout_blocks_block_id_key UNIQUE (block_id);
alter table public.payout_blocks add constraint payout_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.payout_blocks add constraint payout_blocks_method_id_fkey FOREIGN KEY (method_id) REFERENCES payout_methods(id);
alter table public.payout_blocks add constraint payout_blocks_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'paid'::text, 'failed'::text])));
alter table public.payout_earnings add constraint payout_earnings_pkey PRIMARY KEY (id);
alter table public.payout_earnings add constraint payout_earnings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.payout_earnings add constraint payout_earnings_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
alter table public.payout_earnings add constraint payout_earnings_payout_block_id_fkey FOREIGN KEY (payout_block_id) REFERENCES payout_blocks(id) ON DELETE SET NULL;
alter table public.payout_earnings add constraint payout_earnings_amount_check CHECK ((amount > (0)::numeric));
alter table public.payout_earnings add constraint payout_earnings_source_check CHECK ((source = ANY (ARRAY['sale'::text, 'royalty'::text, 'transfer'::text, 'offer'::text])));
alter table public.payout_earnings add constraint payout_earnings_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'available'::text, 'collected'::text])));
alter table public.payout_earnings add constraint payout_earnings_hold_reason_check CHECK ((hold_reason = ANY (ARRAY['settlement_window'::text, 'awaiting_counterparty'::text])));
alter table public.chain_anchors add constraint chain_anchors_pkey PRIMARY KEY (record_hash);
alter table public.chain_anchors add constraint chain_anchors_record_kind_check CHECK ((record_kind = ANY (ARRAY['registration'::text, 'provenance'::text, 'amendment'::text])));
alter table public.chain_anchors add constraint chain_anchors_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'failed'::text])));
alter table public.payment_disputes add constraint payment_disputes_pkey PRIMARY KEY (provider_ref);
alter table public.payment_disputes add constraint payment_disputes_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
alter table public.payment_disputes add constraint payment_disputes_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE SET NULL;
alter table public.payment_disputes add constraint payment_disputes_subject_user_fkey FOREIGN KEY (subject_user) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.payment_disputes add constraint payment_disputes_kind_check CHECK ((kind = ANY (ARRAY['dispute'::text, 'refund'::text])));
alter table public.payment_disputes add constraint payment_disputes_amount_check CHECK ((amount >= (0)::numeric));
alter table public.mms_deliveries add constraint mms_deliveries_pkey PRIMARY KEY (id);
alter table public.mms_deliveries add constraint mms_deliveries_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.mms_deliveries add constraint mms_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.email_deliveries add constraint email_deliveries_pkey PRIMARY KEY (id);
alter table public.email_deliveries add constraint email_deliveries_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.email_deliveries add constraint email_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.work_series add constraint work_series_pkey PRIMARY KEY (id);
alter table public.work_series add constraint work_series_creator_id_slug_key UNIQUE (creator_id, slug);
alter table public.work_series add constraint work_series_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.work_annotations add constraint work_annotations_pkey PRIMARY KEY (id);
alter table public.work_annotations add constraint work_annotations_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.work_annotations add constraint work_annotations_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table public.work_annotations add constraint work_annotations_supersedes_fkey FOREIGN KEY (supersedes) REFERENCES work_annotations(id);
alter table public.work_annotations add constraint work_annotations_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'correction'::text, 'flag'::text])));
alter table public.favorites add constraint favorites_pkey PRIMARY KEY (user_id, target_type, target_id);
alter table public.favorites add constraint favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.favorites add constraint favorites_target_type_check CHECK ((target_type = ANY (ARRAY['creator'::text, 'series'::text, 'work'::text])));
alter table public.curations add constraint curations_pkey PRIMARY KEY (id);
alter table public.curations add constraint curations_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.curations add constraint curations_target_type_check CHECK ((target_type = ANY (ARRAY['creator'::text, 'series'::text, 'work'::text, 'featured'::text])));
alter table public.curations add constraint curations_technique_check CHECK (((technique >= 1) AND (technique <= 5)));
alter table public.curations add constraint curations_color_check CHECK (((color >= 1) AND (color <= 5)));
alter table public.curations add constraint curations_meaning_check CHECK (((meaning >= 1) AND (meaning <= 5)));
alter table public.offers add constraint offers_pkey PRIMARY KEY (id);
alter table public.offers add constraint offers_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
alter table public.offers add constraint offers_from_user_fkey FOREIGN KEY (from_user) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.offers add constraint offers_status_check CHECK ((status = ANY (ARRAY['open'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text, 'expired'::text])));
alter table public.roast_questions add constraint roast_questions_pkey PRIMARY KEY (id);
alter table public.roast_questions add constraint roast_questions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.roast_questions add constraint roast_questions_body_check CHECK (((length(TRIM(BOTH FROM body)) >= 1) AND (length(TRIM(BOTH FROM body)) <= 2000)));

alter table public.plagiarism_scans add constraint plagiarism_scans_pkey PRIMARY KEY (id);
alter table public.plagiarism_scans add constraint plagiarism_scans_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;

-- ============================================================================
-- INDICES
-- ============================================================================

create index if not exists idx_works_tbt_id ON public.works USING btree (tbt_id);
create index if not exists idx_works_creator_id ON public.works USING btree (creator_id);
create index if not exists idx_works_current_owner_id ON public.works USING btree (current_owner_id);
create index if not exists idx_works_status ON public.works USING btree (status);
create index if not exists idx_works_created_at ON public.works USING btree (created_at DESC);
create index if not exists idx_works_is_published ON public.works USING btree (is_published);
create index if not exists works_series_id_idx ON public.works USING btree (series_id);
create index if not exists works_featured_idx ON public.works USING btree (creator_id) WHERE is_featured;
create index if not exists idx_works_mint_address ON public.works USING btree (mint_address) WHERE (mint_address IS NOT NULL);
create index if not exists works_transfer_code_hash_idx ON public.works USING btree (transfer_code_hash) WHERE (transfer_code_hash IS NOT NULL);
create index if not exists works_registration_record_idx ON public.works USING btree (registration_record_uri) WHERE (registration_record_uri IS NOT NULL);
create index if not exists works_content_hash_idx ON public.works USING btree (content_hash) WHERE (content_hash IS NOT NULL);
create index if not exists works_payment_intent_idx ON public.works USING btree (payment_intent_id) WHERE (payment_intent_id IS NOT NULL);
create index if not exists idx_profiles_email ON public.profiles USING btree (email);
create index if not exists idx_profiles_phone ON public.profiles USING btree (phone);
create index if not exists idx_profiles_display_name ON public.profiles USING btree (display_name);
create index if not exists idx_certificates_work_id ON public.certificates USING btree (work_id);
create index if not exists idx_certificates_owner_id ON public.certificates USING btree (owner_id);
create index if not exists idx_context_snapshots_elaboration_type ON public.context_snapshots USING btree (elaboration_type);
create index if not exists idx_ownership_history_work_id ON public.ownership_history USING btree (work_id);
create index if not exists idx_ownership_history_owner_user_id ON public.ownership_history USING btree (owner_user_id);
create index if not exists idx_ownership_history_work_sequence ON public.ownership_history USING btree (work_id, sequence_number);
create index if not exists idx_transfers_work_id ON public.transfers USING btree (work_id);
create index if not exists idx_transfers_from_owner_id ON public.transfers USING btree (from_owner_id);
create index if not exists idx_transfers_to_owner_id ON public.transfers USING btree (to_owner_id);
create index if not exists idx_transfers_from_owner ON public.transfers USING btree (from_owner_id);
create index if not exists idx_transfers_to_owner ON public.transfers USING btree (to_owner_id);
create index if not exists idx_transfers_status ON public.transfers USING btree (status);
create index if not exists idx_transfers_payment_status ON public.transfers USING btree (payment_status);
create index if not exists idx_transfers_initiated_at ON public.transfers USING btree (initiated_at DESC);
create index if not exists transfers_payment_intent_idx ON public.transfers USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);
create index if not exists transfers_payment_reference_idx ON public.transfers USING btree (payment_reference) WHERE (payment_reference IS NOT NULL);
create index if not exists transfers_two_phase_open_idx ON public.transfers USING btree (work_id) WHERE (is_two_phase AND (payment_status = 'pending'::text) AND (outcome IS NULL));
create index if not exists idx_tbt_payments_work_id ON public.tbt_payments USING btree (work_id);
create index if not exists idx_tbt_payments_user_id ON public.tbt_payments USING btree (user_id);
create index if not exists idx_tbt_payments_status ON public.tbt_payments USING btree (status);
create index if not exists tbt_payments_payment_intent_idx ON public.tbt_payments USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);
create index if not exists tbt_payments_checkout_session_idx ON public.tbt_payments USING btree (stripe_checkout_session_id) WHERE (stripe_checkout_session_id IS NOT NULL);

create index if not exists admin_audit_actor_idx ON public.admin_audit_log USING btree (actor_id, created_at DESC);
create index if not exists admin_audit_entity_idx ON public.admin_audit_log USING btree (entity_type, entity_id, created_at DESC);
create index if not exists admin_pending_status_idx ON public.admin_pending_approvals USING btree (status, created_at DESC);
create index if not exists admin_step_up_user_idx ON public.admin_step_up USING btree (user_id, expires_at DESC);
create index if not exists biometric_proofs_user_idx ON public.biometric_proofs USING btree (user_id, expires_at DESC);
create index if not exists webauthn_credentials_user_id_idx ON public.webauthn_credentials USING btree (user_id);
create index if not exists webauthn_challenges_user_id_idx ON public.webauthn_challenges USING btree (user_id);
create index if not exists webauthn_challenges_expires_at_idx ON public.webauthn_challenges USING btree (expires_at);
create index if not exists money_action_auth_user_idx ON public.money_action_auth USING btree (user_id, created_at DESC);
create index if not exists money_action_auth_work_idx ON public.money_action_auth USING btree (work_id) WHERE (work_id IS NOT NULL);
create index if not exists tickets_queue_idx ON public.tickets USING btree (severity, status, created_at);
create index if not exists tickets_subject_user_idx ON public.tickets USING btree (subject_user, created_at DESC);
create unique index if not exists tickets_system_dedupe_idx ON public.tickets USING btree (((context ->> 'entity_type'::text)), ((context ->> 'entity_id'::text)), ((context ->> 'event_code'::text))) WHERE ((origin = 'system'::text) AND (status = ANY (ARRAY['open'::text, 'answered'::text])));
create index if not exists ticket_replies_ticket_idx ON public.ticket_replies USING btree (ticket_id, created_at);
create index if not exists notifications_user_idx ON public.notifications USING btree (user_id, created_at DESC);
create index if not exists notifications_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);
create index if not exists covered_registrations_creator_idx ON public.covered_registrations USING btree (creator_id);
create unique index if not exists covered_registrations_work_idx ON public.covered_registrations USING btree (work_id) WHERE (work_id IS NOT NULL);
create index if not exists provider_events_group_idx ON public.provider_events USING btree (provider, operation, error_code, created_at DESC);
create index if not exists provider_events_failures_idx ON public.provider_events USING btree (created_at DESC) WHERE (NOT ok);

create index if not exists payout_destinations_user_idx ON public.payout_destinations USING btree (user_id);
create index if not exists payout_destinations_method_idx ON public.payout_destinations USING btree (method_id);
create unique index if not exists payout_destinations_default_idx ON public.payout_destinations USING btree (user_id) WHERE is_default;
create index if not exists payout_connect_accounts_account_idx ON public.payout_connect_accounts USING btree (account_id);
create index if not exists payout_blocks_user_idx ON public.payout_blocks USING btree (user_id, created_at DESC);
create index if not exists payout_blocks_method_idx ON public.payout_blocks USING btree (method_id);
create index if not exists payout_earnings_user_idx ON public.payout_earnings USING btree (user_id, state);
create index if not exists payout_earnings_work_idx ON public.payout_earnings USING btree (work_id) WHERE (work_id IS NOT NULL);
create index if not exists payout_earnings_block_idx ON public.payout_earnings USING btree (payout_block_id) WHERE (payout_block_id IS NOT NULL);
create index if not exists payout_earnings_release_idx ON public.payout_earnings USING btree (releases_at) WHERE (state = 'pending'::text);
create unique index if not exists payout_earnings_source_idx ON public.payout_earnings USING btree (source, source_ref) WHERE (source_ref IS NOT NULL);
create index if not exists chain_anchors_pending_idx ON public.chain_anchors USING btree (created_at) WHERE (status = 'pending'::text);
create index if not exists payment_disputes_work_idx ON public.payment_disputes USING btree (work_id) WHERE (work_id IS NOT NULL);
create index if not exists payment_disputes_user_idx ON public.payment_disputes USING btree (subject_user) WHERE (subject_user IS NOT NULL);
create index if not exists payment_disputes_unresolved_idx ON public.payment_disputes USING btree (created_at DESC) WHERE (work_id IS NULL);
create index if not exists idx_mms_deliveries_work_id ON public.mms_deliveries USING btree (work_id);
create index if not exists idx_email_deliveries_work_id ON public.email_deliveries USING btree (work_id);
create index if not exists idx_email_deliveries_user_id ON public.email_deliveries USING btree (user_id);

create index if not exists work_annotations_work_idx ON public.work_annotations USING btree (work_id, created_at DESC);
create index if not exists favorites_user_idx ON public.favorites USING btree (user_id);
create index if not exists curations_target_idx ON public.curations USING btree (target_type, target_id) WHERE is_public;
create index if not exists roast_questions_article_idx ON public.roast_questions USING btree (article_id, created_at DESC) WHERE (NOT hidden);
create index if not exists roast_questions_user_idx ON public.roast_questions USING btree (user_id);
create index if not exists idx_plagiarism_scans_work_id ON public.plagiarism_scans USING btree (work_id);

-- ============================================================================
-- SEGURIDAD A NIVEL DE FILA
-- ============================================================================
-- Las 44 tablas la tienen activada. Seis no declaran NINGUNA politica, y eso
-- es deliberado: con RLS activa y sin politicas, solo entra el service role.
-- Son admin_step_up, biometric_proofs, private_code_attempts, plagiarism_scans
-- y payment_disputes — material de autenticacion y una disputa que nombra a
-- quien pago. Nada de eso es del cliente.
-- ============================================================================
alter table public.works enable row level security;
alter table public.profiles enable row level security;
alter table public.work_commerce enable row level security;
alter table public.certificates enable row level security;
alter table public.context_snapshots enable row level security;
alter table public.ownership_history enable row level security;
alter table public.transfers enable row level security;
alter table public.tbt_payments enable row level security;
alter table public.admin_members enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.admin_pending_approvals enable row level security;
alter table public.admin_step_up enable row level security;
alter table public.biometric_proofs enable row level security;
alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;
alter table public.private_code_attempts enable row level security;
alter table public.money_action_auth enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_replies enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.platform_config enable row level security;
alter table public.covered_registrations enable row level security;
alter table public.provider_events enable row level security;
alter table public.payout_methods enable row level security;
alter table public.payout_destinations enable row level security;
alter table public.payout_connect_accounts enable row level security;
alter table public.payout_blocks enable row level security;
alter table public.payout_earnings enable row level security;
alter table public.chain_anchors enable row level security;
alter table public.payment_disputes enable row level security;
alter table public.mms_deliveries enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.work_series enable row level security;
alter table public.work_annotations enable row level security;
alter table public.favorites enable row level security;
alter table public.curations enable row level security;
alter table public.offers enable row level security;
alter table public.roast_questions enable row level security;
alter table public.plagiarism_scans enable row level security;

-- ── Politicas ───────────────────────────────────────────────────────────────

create policy "Perfiles visibles públicamente" on public.profiles for select using (true);
create policy "Usuarios pueden insertar su propio perfil" on public.profiles for insert with check ((auth.uid() = id));
create policy "Usuarios pueden editar su propio perfil" on public.profiles for update using ((auth.uid() = id));

create policy "Obras certificadas son públicas" on public.works for select using (((status = 'certified'::work_status) OR (creator_id = auth.uid()) OR (current_owner_id = auth.uid())));
create policy "Creadores pueden crear obras" on public.works for insert with check (((auth.uid() = creator_id) AND (auth.uid() = current_owner_id)));
create policy "Creadores y propietarios pueden editar obras" on public.works for update using (((auth.uid() = creator_id) OR (auth.uid() = current_owner_id)));

create policy "Commerce visible para obras accesibles" on public.work_commerce for select using ((EXISTS ( SELECT 1 FROM works w WHERE ((w.id = work_commerce.work_id) AND ((w.status = 'certified'::work_status) OR (w.creator_id = auth.uid()) OR (w.current_owner_id = auth.uid()))))));
create policy "Creadores pueden gestionar commerce" on public.work_commerce for all using ((EXISTS ( SELECT 1 FROM works w WHERE ((w.id = work_commerce.work_id) AND (w.creator_id = auth.uid())))));

create policy "Certificados son públicos" on public.certificates for select using (true);
create policy "Sistema puede crear certificados" on public.certificates for insert with check ((EXISTS ( SELECT 1 FROM works w WHERE ((w.id = certificates.work_id) AND ((w.creator_id = auth.uid()) OR (w.current_owner_id = auth.uid()))))));

create policy "Context snapshots are viewable for certified works" on public.context_snapshots for select using ((EXISTS ( SELECT 1 FROM works w WHERE ((w.id = context_snapshots.work_id) AND ((w.status = 'certified'::work_status) OR (w.creator_id = auth.uid()))))));
create policy "Creators can manage their context snapshots" on public.context_snapshots for all using ((EXISTS ( SELECT 1 FROM works w WHERE ((w.id = context_snapshots.work_id) AND (w.creator_id = auth.uid())))));

create policy "public read" on public.ownership_history for select using (true);

create policy "Participantes pueden ver transferencias" on public.transfers for select using (((from_owner_id = auth.uid()) OR (to_owner_id = auth.uid())));
create policy "Propietarios pueden iniciar transferencias" on public.transfers for insert with check ((from_owner_id = auth.uid()));
create policy "Users can create transfers" on public.transfers for insert with check ((to_owner_id = auth.uid()));
create policy "Participantes pueden actualizar transferencias" on public.transfers for update using (((from_owner_id = auth.uid()) OR (to_owner_id = auth.uid())));

create policy "Users can view their own payments" on public.tbt_payments for select using ((user_id = auth.uid()));
create policy "Users can create their own payments" on public.tbt_payments for insert with check ((user_id = auth.uid()));


create policy "admin reads own membership" on public.admin_members for select using ((auth.uid() = user_id));
create policy "audit readable by viewers" on public.admin_audit_log for select using (admin_has('audit.view'::text));
create policy "pending readable by admins" on public.admin_pending_approvals for select using (admin_has('dashboard.view'::text));
create policy "own credentials" on public.webauthn_credentials for all using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "own challenges" on public.webauthn_challenges for all using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "own money action auth readable" on public.money_action_auth for select using ((( SELECT auth.uid() AS uid) = user_id));

create policy "own tickets read" on public.tickets for select using ((auth.uid() = subject_user));
create policy "own tickets insert" on public.tickets for insert with check (((auth.uid() = subject_user) AND (origin = 'human'::text)));
create policy "own replies read" on public.ticket_replies for select using (((NOT internal) AND (EXISTS ( SELECT 1 FROM tickets t WHERE ((t.id = ticket_replies.ticket_id) AND (t.subject_user = auth.uid()))))));
create policy "own replies insert" on public.ticket_replies for insert with check (((author_type = 'customer'::text) AND (NOT internal) AND (EXISTS ( SELECT 1 FROM tickets t WHERE ((t.id = ticket_replies.ticket_id) AND (t.subject_user = auth.uid()))))));

create policy "own notifications read" on public.notifications for select using ((auth.uid() = user_id));
create policy "own notifications mark read" on public.notifications for update using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "own prefs" on public.notification_prefs for all using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

create policy "config readable" on public.platform_config for select using (true);
create policy "creator reads own covered" on public.covered_registrations for select using ((auth.uid() = creator_id));
create policy "observability readable by team" on public.provider_events for select using (admin_has('observability.view'::text));

create policy "payout methods readable" on public.payout_methods for select using (true);
create policy "own destinations readable" on public.payout_destinations for select using ((( SELECT auth.uid() AS uid) = user_id));
create policy "own connect account readable" on public.payout_connect_accounts for select using ((( SELECT auth.uid() AS uid) = user_id));
create policy "own blocks readable" on public.payout_blocks for select using ((( SELECT auth.uid() AS uid) = user_id));
create policy "own earnings readable" on public.payout_earnings for select using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users can view their MMS deliveries" on public.mms_deliveries for select using ((user_id = auth.uid()));
create policy "Users can view their email deliveries" on public.email_deliveries for select using ((user_id = ( SELECT auth.uid() )));

create policy "series readable" on public.work_series for select using (true);
create policy "own series write" on public.work_series for all using ((auth.uid() = creator_id)) with check ((auth.uid() = creator_id));
create policy "annotations readable by team" on public.work_annotations for select using (admin_has('works.view'::text));
create policy "own favorites" on public.favorites for all using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "read public or own" on public.curations for select using ((is_public OR (auth.uid() = author_id)));
create policy "write own curation" on public.curations for all using ((auth.uid() = author_id)) with check ((auth.uid() = author_id));
create policy "offer parties read" on public.offers for select using (((auth.uid() = from_user) OR (auth.uid() = ( SELECT w.current_owner_id FROM works w WHERE (w.id = offers.work_id)))));
create policy "offerer writes" on public.offers for insert with check ((auth.uid() = from_user));
create policy "roast questions readable" on public.roast_questions for select using ((NOT hidden));
create policy "own roast questions insertable" on public.roast_questions for insert with check ((( SELECT auth.uid() AS uid) = user_id));

