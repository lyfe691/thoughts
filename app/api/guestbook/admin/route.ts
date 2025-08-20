import { NextResponse, type NextRequest } from 'next/server'
import { sql } from '@vercel/postgres'

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

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if (auth) return auth

  if (!isDb()) {
    return NextResponse.json({ items: [] })
  }

  try {
    const { rows } = await sql`
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


