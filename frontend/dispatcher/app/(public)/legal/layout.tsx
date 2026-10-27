import type { ReactNode } from 'react'
import { CookieNotice } from '@/components/landing/CookieNotice'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingNav } from '@/components/landing/LandingNav'
import styles from '@/components/landing/landing.module.css'

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <LandingNav />
      <main id="main">{children}</main>
      <LandingFooter />
      <CookieNotice />
    </div>
  )
}
