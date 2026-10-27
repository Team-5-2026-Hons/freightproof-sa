import { PackViewer } from '@/components/PackViewer'

export default async function PackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PackViewer token={token} />
}
