// Deliberately does NOT fetch the scan server-side: the GET mints the browser-binding
// cookie, so it must be made by the receiver's browser, not this server (which would
// lock the real receiver out), and a server-rendered 404 would be wrongly cacheable.
import { HandoverPageClient } from './HandoverPageClient'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function HandoverPage({ params }: PageProps) {
  const { token } = await params
  return <HandoverPageClient token={token} />
}
