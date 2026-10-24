// Shown for any URL that isn't a delivery link. Deliberately plain and link-free: this app
// has no home page to send anyone to, and nothing here may point at a token-bearing URL.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-medium text-neutral-900">This page doesn&apos;t exist</h1>
      <p className="max-w-sm text-sm text-neutral-600">
        If you were sent here from a delivery code, ask the driver to show you a fresh one.
      </p>
    </main>
  )
}
