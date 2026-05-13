import { DispatcherShell } from '@/components/layout/DispatcherShell'

/**
 * Authenticated route group layout.
 * Every page inside (app)/ is wrapped by DispatcherShell — the sidebar, header,
 * and toast viewport are rendered once here, not per-page (§6.4 shared shell rule).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <DispatcherShell>{children}</DispatcherShell>
}
