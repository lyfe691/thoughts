import { NextResponse, type NextRequest } from 'next/server'
import { sql } from '@vercel/postgres'
import crypto from 'crypto'

type GuestbookRow = {
  id: string
  name: string | null
  message: string
  created_at: string
  updated_at: string | null
  edited: boolean
}

// In-memory fallback for local dev when Postgres isn't configured
const memory: Array<GuestbookRow & { ip_hash?: string; approved?: boolean }> = []
function useDb() {
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL)
}

// Allow Neon setups that only expose DATABASE_URL
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL
}

const MAX_LIMIT = 50
const MAX_MESSAGE_LENGTH = 280

function isAutoApprove() {
  const v = (process.env.GUESTBOOK_AUTO_APPROVE || 'true').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

async function ensureTable() {
  if (!useDb()) return
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
    );
    ALTER TABLE guestbook ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE guestbook ADD COLUMN IF NOT EXISTS ip_hash TEXT;
    CREATE INDEX IF NOT EXISTS guestbook_created_at_idx ON guestbook (created_at DESC);
    CREATE INDEX IF NOT EXISTS guestbook_ip_hash_idx ON guestbook (ip_hash);
  `
}

function getClientIpHash(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const real = req.headers.get('x-real-ip') || ''
  const cf = req.headers.get('cf-connecting-ip') || ''
  const ip = (fwd.split(',')[0] || real || cf || '').trim()
  return crypto.createHash('sha256').update(ip).digest('hex')
}

export async function GET(req: NextRequest) {
  await ensureTable()

  const { searchParams } = new URL(req.url)
  const parsedLimit = parseInt(searchParams.get('limit') || '10', 10)
  const parsedOffset = parseInt(searchParams.get('offset') || '0', 10)
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 10, 1), MAX_LIMIT)
  const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0)

  if (!useDb()) {
    const items = memory
      .slice()
      .filter((a) => a.approved !== false)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(offset, offset + limit)
    return NextResponse.json({ items })
  }

  try {
    const { rows } = await sql<GuestbookRow>`
      SELECT id, name, message, created_at, updated_at, edited
      FROM guestbook
      WHERE approved = TRUE
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    return NextResponse.json({ items: rows })
  } catch {
    const items = memory
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(offset, offset + limit)
    return NextResponse.json({ items })
  }
}

export async function POST(req: NextRequest) {
  await ensureTable()

  const ipHash = getClientIpHash(req)

  let body: { name?: string; message?: string; hp?: string } = {}
  try {
    body = await req.json()
  } catch {
    // ignore
  }

  const { name = null, message = '', hp = '' } = body

  if (hp && hp.trim().length > 0) {
    return NextResponse.json({ error: 'rejected' }, { status: 400 })
  }

  const trimmed = (message || '').trim()
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 })
  }

  const safeName = name ? String(name).slice(0, 50).trim() : null

  // simple per-IP cooldown: 30 seconds
  if (!useDb()) {
    const lastForIp = memory
      .filter((r) => r.ip_hash === ipHash)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    if (lastForIp) {
      const last = new Date(lastForIp.created_at).getTime()
      if (Date.now() - last < 30_000) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
      }
    }

    const id = crypto.randomUUID()
    const row: GuestbookRow & { ip_hash: string; approved?: boolean } = {
      id,
      name: safeName,
      message: trimmed,
      created_at: new Date().toISOString(),
      updated_at: null,
      edited: false,
      ip_hash: ipHash,
      approved: isAutoApprove(),
    }
    memory.push(row)
    const { ip_hash, ...item } = row as any
    return NextResponse.json({ item, approved: row.approved !== false }, { status: 201 })
  }

  const recent = await sql<{ created_at: string }>`
    SELECT created_at FROM guestbook
    WHERE ip_hash = ${ipHash}
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (recent.rows.length > 0) {
    const last = new Date(recent.rows[0].created_at).getTime()
    const now = Date.now()
    if (now - last < 30_000) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
  }

  const id = crypto.randomUUID()
  const approved = isAutoApprove()

  const inserted = await sql<GuestbookRow>`
    INSERT INTO guestbook (id, name, message, ip_hash, approved)
    VALUES (${id}, ${safeName}, ${trimmed}, ${ipHash}, ${approved})
    RETURNING id, name, message, created_at, updated_at, edited
  `

  return NextResponse.json({ item: inserted.rows[0], approved }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  await ensureTable()

  const ipHash = getClientIpHash(req)
  let body: { id?: string; message?: string } = {}
  try {
    body = await req.json()
  } catch {}

  const id = (body.id || '').trim()
  const trimmed = (body.message || '').trim()

  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH)
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 })

  if (!useDb()) {
    const idx = memory.findIndex((r) => r.id === id && r.ip_hash === ipHash)
    if (idx === -1) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    memory[idx] = {
      ...memory[idx],
      message: trimmed,
      edited: true,
      updated_at: new Date().toISOString(),
    }
    const { ip_hash, ...item } = memory[idx] as any
    return NextResponse.json({ item })
  }

  const owner = await sql<{ id: string }>`
    SELECT id FROM guestbook WHERE id = ${id} AND ip_hash = ${ipHash} LIMIT 1
  `
  if (owner.rows.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const updated = await sql<GuestbookRow>`
    UPDATE guestbook
    SET message = ${trimmed}, edited = TRUE, updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, message, created_at, updated_at, edited
  `

  return NextResponse.json({ item: updated.rows[0] })
}

export async function DELETE(req: NextRequest) {
  await ensureTable()

  const { searchParams } = new URL(req.url)
  let id = (searchParams.get('id') || '').trim()
  if (!id) {
    try {
      const body = await req.json()
      id = (body?.id || '').trim()
    } catch {}
  }
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const adminHeader = req.headers.get('x-admin-token') || ''
  const isAdmin = Boolean(
    process.env.GUESTBOOK_ADMIN_TOKEN && adminHeader === process.env.GUESTBOOK_ADMIN_TOKEN
  )

  if (!useDb()) {
    if (isAdmin) {
      const idx = memory.findIndex((r) => r.id === id)
      if (idx === -1) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      memory.splice(idx, 1)
      return NextResponse.json({ ok: true })
    }
    const ipHash = getClientIpHash(req)
    const idx = memory.findIndex((r) => r.id === id && r.ip_hash === ipHash)
    if (idx === -1) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    memory.splice(idx, 1)
    return NextResponse.json({ ok: true })
  }

  if (isAdmin) {
    const result = await sql`DELETE FROM guestbook WHERE id = ${id}`
    if ((result as any).rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  const ipHash = getClientIpHash(req)
  const result = await sql`DELETE FROM guestbook WHERE id = ${id} AND ip_hash = ${ipHash}`
  if ((result as any).rowCount === 0) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return NextResponse.json({ ok: true })
}


