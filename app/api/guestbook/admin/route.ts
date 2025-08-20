import { NextResponse, type NextRequest } from 'next/server'
import { sql } from '@vercel/postgres'

function isDb() {
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL)
}

function requireAdmin(req: NextRequest): NextResponse | null {
  const token = req.headers.get('x-admin-token') || ''
  if (!process.env.GUESTBOOK_ADMIN_TOKEN || token !== process.env.GUESTBOOK_ADMIN_TOKEN) {
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

  const { rows } = await sql`
    SELECT id, name, message, created_at, updated_at, edited, approved
    FROM guestbook
    WHERE approved = FALSE
    ORDER BY created_at ASC
  `
  return NextResponse.json({ items: rows })
}

export async function PATCH(req: NextRequest) {
  const auth = requireAdmin(req)
  if (auth) return auth

  if (!isDb()) return NextResponse.json({ error: 'no_db' }, { status: 400 })

  const body = await req.json().catch(() => ({} as any))
  const id = (body.id || '').trim()
  const approved = Boolean(body.approved)
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  await sql`UPDATE guestbook SET approved = ${approved} WHERE id = ${id}`
  return NextResponse.json({ ok: true })
}


