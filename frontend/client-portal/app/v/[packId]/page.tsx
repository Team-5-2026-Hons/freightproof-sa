import { SealCheck } from '@/components/SealCheck'

export default async function SealPage({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params
  return <SealCheck packId={packId} />
}
