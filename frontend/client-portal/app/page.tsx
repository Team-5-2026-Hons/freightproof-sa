import { Eyebrow } from '@/components/Eyebrow'

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <Eyebrow size="micro">FreightProof evidence portal</Eyebrow>
      <h1 className="mt-2 text-2xl font-extrabold">Open an audit pack from its link</h1>
      <p className="mt-3 text-sm text-muted">
        Audit packs are shared by the transport operator that issued them. Use the link you were sent, or the
        verification address printed on the PDF.
      </p>
    </main>
  )
}
