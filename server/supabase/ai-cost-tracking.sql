-- JoBPilot.AI — AI cost tracking tables only
-- Paste into Supabase → SQL Editor → Run

create extension if not exists "pgcrypto";

-- ─── AI cost tracking (per-request ledger) ────────────────────────────────
create table if not exists public.ai_usage_events (
  id uuid primary key,
  operation_id uuid,
  user_id uuid,
  session_id text,
  job_id text,
  service_name text not null,
  feature_name text not null,
  provider text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  usage_source text not null default 'unknown',
  input_cost_usd numeric(14, 8) not null default 0,
  output_cost_usd numeric(14, 8) not null default 0,
  total_cost_usd numeric(14, 8) not null default 0,
  pricing_missing boolean not null default false,
  pricing_version text,
  pricing_effective_date text,
  processing_time_ms integer not null default 0,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.ai_usage_events add column if not exists operation_id uuid;
alter table public.ai_usage_events add column if not exists usage_source text;
alter table public.ai_usage_events add column if not exists pricing_missing boolean;
alter table public.ai_usage_events add column if not exists pricing_version text;
alter table public.ai_usage_events add column if not exists pricing_effective_date text;

create index if not exists ai_usage_events_user_id_idx on public.ai_usage_events (user_id);
create index if not exists ai_usage_events_session_id_idx on public.ai_usage_events (session_id);
create index if not exists ai_usage_events_operation_id_idx on public.ai_usage_events (operation_id);
create index if not exists ai_usage_events_service_name_idx on public.ai_usage_events (service_name);
create index if not exists ai_usage_events_provider_idx on public.ai_usage_events (provider);
create index if not exists ai_usage_events_model_idx on public.ai_usage_events (model);
create index if not exists ai_usage_events_created_at_idx on public.ai_usage_events (created_at);
create index if not exists ai_usage_events_feature_name_idx on public.ai_usage_events (feature_name);
create index if not exists ai_usage_events_status_idx on public.ai_usage_events (status);
create index if not exists ai_usage_events_pricing_missing_idx on public.ai_usage_events (pricing_missing);

-- Operation-level totals
create table if not exists public.ai_service_costs (
  id uuid primary key,
  operation_id uuid,
  user_id uuid,
  session_id text,
  job_id text,
  service_name text not null,
  total_prompt_tokens integer not null default 0,
  total_completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  input_cost_usd numeric(14, 8) not null default 0,
  output_cost_usd numeric(14, 8) not null default 0,
  total_cost_usd numeric(14, 8) not null default 0,
  request_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  pricing_missing_count integer not null default 0,
  features jsonb,
  status text not null,
  created_at timestamptz not null default now()
);

alter table public.ai_service_costs add column if not exists operation_id uuid;
alter table public.ai_service_costs add column if not exists input_cost_usd numeric(14, 8);
alter table public.ai_service_costs add column if not exists output_cost_usd numeric(14, 8);
alter table public.ai_service_costs add column if not exists pricing_missing_count integer;

create index if not exists ai_service_costs_user_id_idx on public.ai_service_costs (user_id);
create index if not exists ai_service_costs_session_id_idx on public.ai_service_costs (session_id);
create index if not exists ai_service_costs_operation_id_idx on public.ai_service_costs (operation_id);
create index if not exists ai_service_costs_service_name_idx on public.ai_service_costs (service_name);
create index if not exists ai_service_costs_created_at_idx on public.ai_service_costs (created_at);
create unique index if not exists ai_service_costs_operation_id_uidx
  on public.ai_service_costs (operation_id)
  where operation_id is not null;

alter table public.ai_usage_events enable row level security;
alter table public.ai_service_costs enable row level security;
