import { PackViewer } from '@/components/PackViewer'

// A server shell around a client viewer: the pack is fetched from the insurer's own
// browser, so the access log records their address rather than this server's.
export default async function PackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PackViewer token={token} />
}
