export const metadata = {
  title: 'Guestbook',
}
import ClientGuestbook from './ClientGuestbook'

export default function GuestbookPage() {
  return (
    <div>
      <h1 className='font-semibold mb-7 text-rurikon-600 text-balance'>Guestbook</h1>
      <ClientGuestbook />
    </div>
  )
}


