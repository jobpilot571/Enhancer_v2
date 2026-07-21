-- JoBPilot.AI — Supabase / Postgres schema
-- Run this in Supabase → SQL Editor → New query → Run

create extension if not exists "pgcrypto";

-- ─── Users (accounts + builder memory) ───────────────────────────────────────
create table if not exists public.users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_salt text,
  password_hash text,
  google_id text unique,
  plan text not null default 'free',
  complimentary boolean not null default false,
  complimentary_plan_type text,
  complimentary_note text,
  complimentary_at timestamptz,
  email_verified_at timestamptz,
  builder_memory jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_email_idx on public.users (email);
create index if not exists users_google_id_idx on public.users (google_id);

-- ─── Monthly usage counters ───────────────────────────────────────────────
create table if not exists public.usage_monthly (
  user_id uuid not null references public.users (id) on delete cascade,
  month text not null,
  enhancer integer not null default 0,
  builder integer not null default 0,
  jd_builder integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

-- ─── Complimentary email whitelist ────────────────────────────────────
create table if not exists public.complimentary_emails (
  email text primary key,
  plan_type text not null default 'friend',
  note text,
  added_at timestamptz not null default now()
);

-- Server uses the service_role key (bypasses RLS).
-- Lock down anon/authenticated so the public API key cannot read auth data.
alter table public.users enable row level security;
alter table public.usage_monthly enable row level security;
alter table public.complimentary_emails enable row level security;

-- No policies for anon/authenticated = deny all via PostgREST for those roles.
-- service_role still has full access.
