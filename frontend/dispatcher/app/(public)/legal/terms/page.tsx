import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalDoc } from '@/components/landing/LegalDoc'
import { ROUTES } from '@/lib/constants/routes'
import { COMPANY } from '@/lib/landing/content'

export const metadata: Metadata = {
  title: 'Terms of Use: FreightProof SA',
  description: 'The terms that apply to using the FreightProof SA website and platform.',
}

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Use"
      current={ROUTES.legalTerms}
      intro={
        <p>
          These terms apply when you use this website or sign in to the FreightProof platform,
          operated by {COMPANY.legalName}. By using either, you agree to them.
        </p>
      }
    >
      <h2>1. The website and the platform</h2>
      <p>
        Anyone may browse this website. Access to the platform is only available to
        organisations that have a written agreement with us, and to the people they authorise.
        If that agreement conflicts with these terms, the agreement wins.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>Accounts are created for you by us or by your organisation’s administrator.</li>
        <li>Keep your sign-in details private. You are responsible for activity under your account.</li>
        <li>Tell us straight away at <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> if you think someone else has used it.</li>
        <li>For security, sessions sign out automatically after a period of inactivity.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You must not:</p>
      <ul>
        <li>access data or parts of the platform you aren’t authorised to use;</li>
        <li>enter information you know to be false, or attempt to alter, delete or back-date a record;</li>
        <li>probe, scan or test the security of the service without our written permission;</li>
        <li>copy, reverse engineer or resell the service; or</li>
        <li>introduce malicious code, or overload or disrupt the service.</li>
      </ul>
      <p>We may suspend access that breaches these rules or puts the service or other users at risk.</p>

      <h2>4. What FreightProof does, and doesn’t do</h2>
      <p>
        FreightProof <strong>records</strong> what happens at each handover and makes those records
        tamper-evident. It does not prevent theft, dispatch a response or monitor trips on your
        behalf. <strong>In an emergency, contact the South African Police Service (10111) and your
        control room.</strong>
      </p>
      <p>
        A record is only as accurate as what goes into it: the devices, locations, counts and
        third-party systems involved. Records are evidence, not legal advice, and we don’t
        guarantee the outcome of any claim, dispute or proceeding.
      </p>

      <h2>5. Third-party services</h2>
      <p>
        The platform relies on services we don’t control, including cloud hosting, map providers
        and the Hedera public ledger. We choose them carefully but are not responsible for their
        availability.
      </p>

      <h2>6. Intellectual property</h2>
      <p>
        The website, the platform, the FreightProof name and logo belong to {COMPANY.legalName}.
        The data your organisation records belongs to your organisation, subject to its
        agreement with us.
      </p>

      <h2>7. Availability and changes</h2>
      <p>
        We work to keep the service available but can’t promise it will be uninterrupted or
        error-free. We may change or improve features. If a change materially affects your
        organisation’s agreement, we’ll give notice as that agreement requires.
      </p>

      <h2>8. Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential loss,
        including loss of cargo, profit or business, arising from your use of the website or
        the platform. Nothing in these terms limits liability that cannot lawfully be limited,
        including under the Consumer Protection Act 68 of 2008 where it applies, or liability for
        gross negligence or intentional misconduct.
      </p>

      <h2>9. Electronic Communications and Transactions Act</h2>
      <p>
        The information that section 43 of the Electronic Communications and Transactions Act 25
        of 2002 requires is on our <Link href={ROUTES.legalCompany}>company information page</Link>.
        No goods or services are sold through this website, so the cooling-off provisions of
        section 44 do not apply to it.
      </p>

      <h2>10. Privacy</h2>
      <p>
        The <Link href={ROUTES.legalPrivacy}>Privacy Notice</Link> explains how we handle personal
        information, and the <Link href={ROUTES.legalCookies}>Cookie Notice</Link> covers browser storage.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the law of the Republic of South Africa. Any dispute goes to
        the South African courts with jurisdiction, which by agreement includes the Western Cape
        Division of the High Court, Cape Town.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
      </p>
    </LegalDoc>
  )
}
