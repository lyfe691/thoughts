'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Entry = {
  id: string
  name: string | null
  message: string
  created_at: string
  updated_at?: string | null
  edited?: boolean
}

const PAGE_SIZE = 10

export default function ClientGuestbook() {
  const [items, setItems] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  
  const honeypot = useRef<HTMLInputElement | null>(null)
  const myIdsRef = useRef<Set<string>>(new Set())

  const dateFmt = useMemo(() => {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [])

  async function fetchPage(offset: number) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/guestbook?limit=${PAGE_SIZE}&offset=${offset}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      const newItems: Entry[] = data.items || []
      setItems((prev) => (offset === 0 ? newItems : [...prev, ...newItems]))
      setHasMore(newItems.length === PAGE_SIZE)
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // hydrate myIds from localStorage
    try {
      const raw = localStorage.getItem('guestbook_my_ids')
      if (raw) myIdsRef.current = new Set(JSON.parse(raw))
    } catch {}
    fetchPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || null,
          message: message.trim(),
          hp: honeypot.current?.value || '',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to submit')
      }
      const data = await res.json()
      const created: Entry | undefined = data.item
      const approved: boolean = Boolean(data.approved ?? true)
      if (created?.id) {
        myIdsRef.current.add(created.id)
        try {
          localStorage.setItem(
            'guestbook_my_ids',
            JSON.stringify(Array.from(myIdsRef.current))
          )
        } catch {}
      }
      setName('')
      setMessage('')
      if (created) {
        if (approved) {
          setItems((prev) => [created, ...prev])
          setNotice('Thanks! Your message has been posted.')
        } else {
          setNotice('Thanks! Your message was submitted and is pending approval.')
        }
      } else if (!approved) {
        setNotice('Thanks! Your message was submitted and is pending approval.')
      }
      // Best-effort refresh, but ignore failures so UI stays responsive
      fetchPage(0).catch(() => {})
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setSubmitting(false)
    }
  }

  

  const canSubmit = message.trim().length > 0 && message.trim().length <= 280
  const isMine = (id: string) => myIdsRef.current.has(id)

  async function onDelete(id: string) {
    try {
      const res = await fetch(`/api/guestbook?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete')
      }
      setItems((prev) => prev.filter((x) => x.id !== id))
      myIdsRef.current.delete(id)
      try {
        localStorage.setItem('guestbook_my_ids', JSON.stringify(Array.from(myIdsRef.current)))
      } catch {}
    } catch (e: any) {
      setError(e.message || 'Error')
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit} className='space-y-3'>
        <div className='sr-only'>
          <label htmlFor='website' className='block text-sm'>Website</label>
          <input ref={honeypot} id='website' name='website' className='hidden' tabIndex={-1} autoComplete='off' />
        </div>
        <div className='flex gap-2'>
          <input
            type='text'
            placeholder='Name (optional)'
            value={name}
            onChange={(e) => setName(e.target.value)}
            className='flex-1 min-w-0 bg-transparent px-0 py-1 outline-none border-0 border-b border-rurikon-border rounded-none focus-visible:ring-0 focus-visible:border-rurikon-400'
            maxLength={50}
          />
          <input
            type='text'
            placeholder='Leave a message (max 280)'
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className='flex-[2] min-w-0 bg-transparent px-0 py-1 outline-none border-0 border-b border-rurikon-border rounded-none focus-visible:ring-0 focus-visible:border-rurikon-400'
            maxLength={280}
            required
          />
          <button
            type='submit'
            disabled={!canSubmit || submitting}
            className='px-0 py-0 text-rurikon-600 underline underline-offset-2 hover:text-rurikon-700 disabled:opacity-50'
          >
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </div>
        {notice && <p className='text-sm text-rurikon-600'>{notice}</p>}
        {error && <p className='text-sm text-red-600'>{error}</p>}
      </form>

      <ul className='mt-7 space-y-5'>
        {items.map((it) => (
          <li key={it.id} className='group'>
            <div className='flex items-start gap-2'>
              <div className='flex-1 min-w-0'>
                <div className='text-rurikon-300 text-sm'>
                  <span className='text-rurikon-400'>{it.name || 'Anonymous'}</span>
                  <span className='mx-2 text-rurikon-200'>·</span>
                  <time dateTime={it.created_at}>{dateFmt.format(new Date(it.created_at))}</time>
                </div>
                <p className='mt-1 break-words text-rurikon-600'>{it.message}</p>
              </div>
              {isMine(it.id) && (
                <button
                  onClick={() => onDelete(it.id)}
                  className='opacity-0 group-hover:opacity-100 transition-opacity px-0 py-0 text-rurikon-300 underline underline-offset-2 hover:text-rurikon-500 ml-3'
                >
                  Delete
                </button>
              )}
            </div>
            <div className='mt-5 h-px w-full bg-rurikon-border opacity-60' />
          </li>
        ))}
      </ul>

      <div className='mt-6'>
        {hasMore && (
          <button
            disabled={loading}
            onClick={() => fetchPage(items.length)}
            className='px-0 py-0 text-rurikon-600 underline underline-offset-2 hover:text-rurikon-700 disabled:opacity-50'
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}


