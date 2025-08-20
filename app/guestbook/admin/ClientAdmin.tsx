'use client'

import { useEffect, useMemo, useState } from 'react'

type AdminEntry = {
  id: string
  name: string | null
  message: string
  created_at: string
  edited: boolean
  approved?: boolean
}

export default function ClientAdmin() {
  const [token, setToken] = useState('')
  const [items, setItems] = useState<AdminEntry[]>([])
  const [view, setView] = useState<'pending' | 'approved'>('pending')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    []
  )

  async function load(which: 'pending' | 'approved' = view) {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/guestbook/admin?status=${which}`, {
        headers: {
          'x-admin-token': token,
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load')
      }
      const data = await res.json()
      setItems(data.items || [])
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  async function approve(id: string, approved: boolean) {
    try {
      const res = await fetch('/api/guestbook/admin', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id, approved }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update')
      }
      await load(view)
    } catch (e: any) {
      setError(e.message || 'Error')
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/guestbook?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'x-admin-token': token,
          Authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete')
      }
      await load(view)
    } catch (e: any) {
      setError(e.message || 'Error')
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('guestbook_admin_token')
    if (saved) setToken(saved)
  }, [])

  return (
    <div>
      <h1 className='font-semibold mb-7 text-rurikon-600 text-balance'>Guestbook Admin</h1>
      <div className='flex gap-2 items-center'>
        <input
          placeholder='Admin token'
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className='flex-1 min-w-0 bg-transparent px-0 py-1 outline-none border-0 border-b border-rurikon-border rounded-none focus-visible:ring-0 focus-visible:border-rurikon-400'
          type='password'
        />
        <button
          onClick={() => {
            localStorage.setItem('guestbook_admin_token', token)
            load('pending')
          }}
          className='px-0 py-0 text-rurikon-600 underline underline-offset-2 hover:text-rurikon-700'
        >
          {loading ? 'Loading…' : 'Load pending'}
        </button>
        <button
          onClick={() => {
            localStorage.setItem('guestbook_admin_token', token)
            setView('approved')
            load('approved')
          }}
          className='px-0 py-0 text-rurikon-600 underline underline-offset-2 hover:text-rurikon-700'
        >
          {loading ? 'Loading…' : 'Load approved'}
        </button>
      </div>
      {error && <p className='mt-3 text-sm text-red-600'>{error}</p>}

      <ul className='mt-7 space-y-5'>
        {items.map((it) => (
          <li key={it.id} className='group'>
            <div className='text-rurikon-300 text-sm'>
              <span className='text-rurikon-400'>{it.name || 'Anonymous'}</span>
              <span className='mx-2 text-rurikon-200'>·</span>
              <time dateTime={it.created_at}>{dateFmt.format(new Date(it.created_at))}</time>
            </div>
            <p className='mt-1 break-words text-rurikon-600'>{it.message}</p>
            <div className='mt-2 flex gap-4'>
              {view === 'pending' ? (
                <>
                  <button
                    onClick={() => approve(it.id, true)}
                    className='px-0 py-0 text-rurikon-600 underline underline-offset-2 hover:text-rurikon-700'
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => approve(it.id, false)}
                    className='px-0 py-0 text-rurikon-300 underline underline-offset-2 hover:text-rurikon-500'
                  >
                    Reject
                  </button>
                </>
              ) : (
                <button
                  onClick={() => remove(it.id)}
                  className='px-0 py-0 text-rurikon-300 underline underline-offset-2 hover:text-rurikon-500'
                >
                  Delete
                </button>
              )}
            </div>
            <div className='mt-5 h-px w-full bg-rurikon-border opacity-60' />
          </li>
        ))}
      </ul>
    </div>
  )
}


