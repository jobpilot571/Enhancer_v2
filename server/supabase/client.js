/**
 * Supabase client for server-side durable storage.
 * Uses the service_role key (never expose to the browser).
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Node < 22 needs the `ws` package for supabase-js realtime transport.
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

let client = null

export function isSupabaseConfigured() {
  const url = (process.env.SUPABASE_URL || '').trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  return Boolean(url && key)
}

export function getSupabase() {
  if (!isSupabaseConfigured()) return null
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        // Required on Node 20 (Render default); harmless on Node 22+
        realtime: { transport: ws },
      },
    )
  }
  return client
}

export function rowToUser(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordSalt: row.password_salt ?? null,
    passwordHash: row.password_hash ?? null,
    googleId: row.google_id ?? null,
    plan: row.plan || 'free',
    complimentary: Boolean(row.complimentary),
    complimentaryPlanType: row.complimentary_plan_type ?? null,
    complimentaryNote: row.complimentary_note ?? null,
    complimentaryAt: row.complimentary_at ?? null,
    emailVerifiedAt: row.email_verified_at ?? null,
    builderMemory: row.builder_memory ?? undefined,
    createdAt: row.created_at || null,
  }
}

export function userToRow(user) {
  const row = {
    id: user.id,
    name: user.name,
    email: user.email,
    password_salt: user.passwordSalt ?? null,
    password_hash: user.passwordHash ?? null,
    google_id: user.googleId ?? null,
    plan: user.plan || 'free',
    complimentary: Boolean(user.complimentary),
    complimentary_plan_type: user.complimentaryPlanType ?? null,
    complimentary_note: user.complimentaryNote ?? null,
    complimentary_at: user.complimentaryAt ?? null,
    email_verified_at: user.emailVerifiedAt ?? null,
    builder_memory: user.builderMemory ?? null,
    created_at: user.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  return row
}

export function usageMapToRows(usageMap) {
  const rows = []
  for (const [key, counts] of Object.entries(usageMap || {})) {
    const idx = key.lastIndexOf(':')
    if (idx <= 0) continue
    const userId = key.slice(0, idx)
    const month = key.slice(idx + 1)
    if (!userId || !month) continue
    rows.push({
      user_id: userId,
      month,
      enhancer: Number(counts?.enhancer) || 0,
      builder: Number(counts?.builder) || 0,
      jd_builder: Number(counts?.jdBuilder) || 0,
      updated_at: new Date().toISOString(),
    })
  }
  return rows
}

export function usageRowsToMap(rows) {
  const usage = {}
  for (const row of rows || []) {
    if (!row?.user_id || !row?.month) continue
    usage[`${row.user_id}:${row.month}`] = {
      enhancer: Number(row.enhancer) || 0,
      builder: Number(row.builder) || 0,
      jdBuilder: Number(row.jd_builder) || 0,
    }
  }
  return usage
}
