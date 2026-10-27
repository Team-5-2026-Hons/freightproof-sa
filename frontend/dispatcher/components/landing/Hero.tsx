import type { CSSProperties } from 'react'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { SECTIONS } from '@/lib/landing/content'
import { cn } from '@shared/lib/utils/cn'
import { CtaLink } from './CtaLink'
import styles from './landing.module.css'

const HERO_PHOTO = '/landing/hero-truck.webp'

export function Hero() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-[1240px] px-4 pt-14 text-center md:px-8 md:pt-20">
        <h1
          className={cn(styles.rise, 'text-[min(4rem,15vw)] font-extrabold leading-[0.95] tracking-[-0.05em] text-on-surf md:text-[min(7.5rem,9.5vw)]')}
          style={{ '--i': 0 } as CSSProperties}
        >
          FreightProof
        </h1>
        <p
          className={cn(styles.rise, 'mt-3 text-balance text-[min(1.75rem,7.5vw)] font-bold leading-[1.1] tracking-[-0.03em] text-on-surf md:mt-4 md:text-[min(2.75rem,3.8vw)]')}
          style={{ '--i': 1 } as CSSProperties}
        >
          Every handover. On the record.
        </p>
        <p
          className={cn(styles.rise, 'mx-auto mt-5 max-w-[58ch] text-[1.0625rem] leading-relaxed text-on-surf-v md:text-[1.1875rem]')}
          style={{ '--i': 2 } as CSSProperties}
        >
          Cargo goes missing between systems: at the gate, the loading bay and the receiving
          dock. FreightProof records every handover of a road-freight trip on a tamper-evident
          public ledger, so when a load is hijacked or a delivery is disputed, you have the evidence.
        </p>
        <div
          className={cn(styles.rise, 'mt-8 flex flex-wrap items-center justify-center gap-3')}
          style={{ '--i': 3 } as CSSProperties}
        >
          <CtaLink href={`#${SECTIONS.access}`} size="lg">
            Request access
            <ArrowRight className="h-4 w-4" />
          </CtaLink>
          <CtaLink href={ROUTES.login} variant="secondary" size="lg">
            Sign in
          </CtaLink>
        </div>
      </div>

      <div
        className={cn(styles.rise, styles.heroPhoto, 'relative -mt-6 h-[clamp(240px,32vw,460px)] md:-mt-10')}
        style={{ '--i': 4 } as CSSProperties}
      >
        <Image
          src={HERO_PHOTO}
          alt="A white articulated truck on an open highway at golden hour"
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover object-[50%_73%]"
        />
      </div>
    </section>
  )
}
