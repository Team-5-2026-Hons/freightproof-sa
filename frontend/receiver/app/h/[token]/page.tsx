// Server Component. Renders the shell and hands the token to the client half.
//
// Deliberately does NOT fetch the scan server-side. Two reasons, both load-bearing:
// the GET is what mints the browser-binding cookie, so it has to be made BY the
// receiver's browser rather than by this server on its behalf — a server-side fetch
// would bind the token to our own container and lock the real receiver out. And a
// server-rendered 404 would be cacheable, which is not a property a token's liveness
// should ever have.
import { HandoverPageClient } from './HandoverPageClient'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function HandoverPage({ params }: PageProps) {
  const { token } = await params
  return <HandoverPageClient token={token} />
}
