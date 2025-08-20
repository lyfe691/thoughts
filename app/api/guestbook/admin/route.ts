export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { sql } from '@vercel/postgres'

;(function hydratePostgresEnv() {
  if (process.env.POSTGRES_URL) return
  const directCandidates = [
    'POSTGRES_URL',
    'DATABASE_URL',
    'POSTGRES_POSTGRES_URL',
    'POSTGRES_DATABASE_URL',
    'POSTGRES_URL_NON_POOLING',
    'POSTGRES_POSTGRES_URL_NON_POOLING',
    'POSTGRES_DATABASE_URL_NON_POOLING',
  ] as const
  for (const key of directCandidates) {
    const v = process.env[key as keyof NodeJS.ProcessEnv]
    if (v) {
      process.env.POSTGRES_URL = v
      return
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue
    const k = key.toUpperCase()
    if (/_PRISMA_/.test(k) || /NO_SSL/.test(k)) continue
    if (/^POSTGRES_.*_URL$/.test(k) || /^POSTGRES_.*_DATABASE_URL$/.test(k)) {
      process.env.POSTGRES_URL = value
      return
    }
  }
})()

function isDb() {
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL)
}

function getHeaderToken(req: NextRequest): string {
  const header = req.headers.get('x-admin-token') || ''
  if (header) return header.trim()
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const url = new URL(req.url)
  const qp = url.searchParams.get('token') || ''
  return qp.trim()
}

function requireAdmin(req: NextRequest): NextResponse | null {
  const provided = getHeaderToken(req)
  const expected = (process.env.GUESTBOOK_ADMIN_TOKEN || '').trim()
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

async function ensureTable() {
  if (!isDb()) return
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS guestbook (
        id TEXT PRIMARY KEY,
        name TEXT,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ,
        edited BOOLEAN NOT NULL DEFAULT FALSE,
        approved BOOLEAN NOT NULL DEFAULT TRUE,
        ip_hash TEXT
      )
    `
    await sql`ALTER TABLE guestbook ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE`
    await sql`ALTER TABLE guestbook ADD COLUMN IF NOT EXISTS ip_hash TEXT`
  } catch {
    // ignore DDL errors
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if (auth) return auth

  const url = new URL(req.url)
  const status = (url.searchParams.get('status') || 'pending').toLowerCase()

  await ensureTable()

  if (!isDb()) {
    return NextResponse.json({ items: [] })
  }

  try {
    const { rows } =
      status === 'approved'
        ? await sql`
            SELECT id, name, message, created_at, updated_at, edited, approved
            FROM guestbook
            WHERE approved = TRUE
            ORDER BY created_at DESC, id DESC
          `
        : await sql`
            SELECT id, name, message, created_at, updated_at, edited, approved
            FROM guestbook
            WHERE approved = FALSE
            ORDER BY created_at ASC
          `
    return NextResponse.json({ items: rows })
  } catch {
    // Missing table or DB issue
    return NextResponse.json({ items: [] })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireAdmin(req)
  if (auth) return auth

  await ensureTable()

  if (!isDb()) return NextResponse.json({ error: 'no_db' }, { status: 400 })

  const body = await req.json().catch(() => ({} as any))
  const id = (body.id || '').trim()
  const approved = Boolean(body.approved)
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  try {
    await sql`UPDATE guestbook SET approved = ${approved} WHERE id = ${id}`
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
}


