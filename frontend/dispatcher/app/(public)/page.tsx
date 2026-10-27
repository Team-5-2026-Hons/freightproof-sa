import type { Metadata } from 'next'
import { AccessSection } from '@/components/landing/AccessSection'
import { CookieNotice } from '@/components/landing/CookieNotice'
import { Hero } from '@/components/landing/Hero'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingNav } from '@/components/landing/LandingNav'
import { RoadJourney } from '@/components/landing/RoadJourney'
import { AboutSection, EvidenceSection, PrinciplesSection, WhySection } from '@/components/landing/StorySections'
import styles from '@/components/landing/landing.module.css'

export const metadata: Metadata = {
  title: 'FreightProof SA: every handover, on the record',
  description:
    'FreightProof records every handover of a road-freight trip and anchors a tamper-evident fingerprint of each one to a public ledger, giving South African carriers evidence for hijackings and disputed deliveries.',
}

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal focus:rounded-md focus:bg-surf-lowest focus:px-4 focus:py-2 focus:text-[0.875rem] focus:font-semibold focus:shadow-level-4"
      >
        Skip to content
      </a>
      <LandingNav onLanding />
      <main id="main">
        <Hero />
        <RoadJourney />
        <WhySection />
        <EvidenceSection />
        <PrinciplesSection />
        <AboutSection />
        <AccessSection />
      </main>
      <LandingFooter />
      <CookieNotice />
    </div>
  )
}
