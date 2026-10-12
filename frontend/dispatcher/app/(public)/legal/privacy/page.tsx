import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalDoc } from '@/components/landing/LegalDoc'
import { ROUTES } from '@/lib/constants/routes'
import { COMPANY } from '@/lib/landing/content'

export const metadata: Metadata = {
  title: 'Privacy Notice: FreightProof SA',
  description: 'How FreightProof SA collects, uses and protects personal information under POPIA.',
}

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Notice"
      current={ROUTES.legalPrivacy}
      intro={
        <p>
          This notice explains what personal information {COMPANY.legalName} (“FreightProof”, “we”)
          collects, why, where it is kept and what your rights are under the Protection of
          Personal Information Act 4 of 2013 (“POPIA”).
        </p>
      }
    >
      <h2>1. Who we are</h2>
      <p>
        {COMPANY.legalName}, registration number {COMPANY.registrationNumber}, of {COMPANY.physicalAddress}.
        Our Information Officer is {COMPANY.informationOfficer}, reachable at{' '}
        <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
      </p>

      <h2>2. Two roles: this website, and the platform</h2>
      <p>
        <strong>On this website</strong> we decide what information is collected and why, so we
        are the responsible party.
      </p>
      <p>
        <strong>On the FreightProof platform</strong>, we process trip information on behalf of
        the transport operator that uses it. That operator is the responsible party for its
        drivers’ and trips’ information, and we act as its operator under section 21 of POPIA,
        bound by a written agreement to process that information only on its instructions and
        to keep it secure. Questions about that information can also go to the operator directly.
      </p>

      <h2>3. What we collect</h2>
      <h3>When you visit this website</h3>
      <ul>
        <li>No analytics, advertising or tracking tools. See the <Link href={ROUTES.legalCookies}>Cookie Notice</Link>.</li>
        <li>Our hosting provider keeps standard server logs (IP address, browser type, time of request) to keep the service secure and working.</li>
        <li>If you request access, the details you choose to put in your email: name, work email, company, role, fleet size and any note.</li>
      </ul>
      <h3>When the platform is used</h3>
      <ul>
        <li><strong>Dispatcher accounts:</strong> name, work email, role and organisation.</li>
        <li><strong>Drivers:</strong> name, identity-verification result, licence details and the position of the company-issued device while a trip is in progress.</li>
        <li><strong>Trip records:</strong> vehicles, consignment references, precincts, seal numbers, unit counts, photos of trip documents, timestamps and locations of each handover, and any exceptions raised.</li>
        <li><strong>Receivers:</strong> the contact detail used to send a one-time PIN, and the confirmation itself.</li>
      </ul>

      <h2>4. Why we use it</h2>
      <p>We process personal information only for these purposes, on the lawful grounds in section 11 of POPIA:</p>
      <ul>
        <li>to provide the platform under our agreement with the operator (performing a contract);</li>
        <li>to create a reliable evidence record that helps prevent cargo crime and resolve disputed deliveries (the legitimate interests of the operator, its customers and the people involved);</li>
        <li>to keep the service secure, and to comply with the law or a lawful request;</li>
        <li>to reply to you when you contact us or request access.</li>
      </ul>

      <h2>5. What goes on the public ledger, and what never does</h2>
      <p>
        To make records tamper-evident, we write a SHA-256 fingerprint of each record to the
        Hedera Consensus Service, a public ledger. A fingerprint is a fixed-length string
        calculated from the record. It cannot be reversed to reveal the record and contains no
        personal information. <strong>Names, identity details, locations and photos are never
        written to the ledger.</strong> Fingerprints on a public ledger are permanent, but they
        only become meaningful when compared with the original record, which we hold and can delete.
      </p>

      <h2>6. Where your information is kept</h2>
      <p>
        Platform data, including photos, is stored in South Africa, in Amazon Web Services’
        Cape Town region (af-south-1), through our database and storage provider.
      </p>
      <p>
        Some information may leave South Africa. Emails you send us are handled by our email
        provider (Google), whose servers may be outside South Africa. Map images inside the
        dashboard are loaded from OpenStreetMap and Esri, which see the viewer’s IP address. We
        transfer information across borders only where section 72 of POPIA allows it, for example
        where the recipient is bound by protections substantially similar to POPIA or the
        transfer is needed to perform a contract.
      </p>

      <h2>7. How long we keep it</h2>
      <p>
        Trip records are kept for {'[retention period]'} after a trip closes, because claims and
        disputes can arise long after delivery. They are kept longer only if a claim, an
        investigation or the law requires it. Access-request emails that don’t lead to a working
        relationship are deleted within {'[12 months]'}. When information is no longer needed, we
        delete it or de-identify it.
      </p>

      <h2>8. How we protect it</h2>
      <p>
        As section 19 of POPIA requires, we use reasonable technical and organisational measures:
        encryption in transit, role-based access limited to each operator’s own organisation, an
        audit trail of changes, and tamper-evident fingerprints on every record. If we believe
        personal information has been accessed without authorisation, we will notify the
        Information Regulator and the people affected, as section 22 requires.
      </p>

      <h2>9. Automated flags</h2>
      <p>
        The platform automatically flags events that need attention, such as a device that
        isn’t where the trip says it should be. A flag is a record for a person to review. We do
        not make decisions with legal consequences about anyone solely by automated means.
      </p>

      <h2>10. Your rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>ask whether we hold personal information about you, and request a copy (section 23);</li>
        <li>ask us to correct or delete information that is inaccurate, out of date or unlawfully held (section 24);</li>
        <li>object to processing based on legitimate interests (section 11(3));</li>
        <li>withdraw consent where processing relies on it;</li>
        <li>not receive direct marketing you haven’t agreed to. We don’t send unsolicited marketing.</li>
      </ul>
      <p>
        Email <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> to exercise any of these rights.
        Formal access requests follow our{' '}
        <Link href={ROUTES.legalCompany}>PAIA information</Link>. We may need to verify your
        identity first, and where the operator is the responsible party, we will pass your
        request to them.
      </p>

      <h2>11. Complaints</h2>
      <p>
        Please contact us first and we’ll try to resolve your concern. You may also complain to
        the Information Regulator (South Africa): JD House, 27 Stiemens Street, Braamfontein,
        Johannesburg, 2001.{' '}
        <a href="mailto:POPIAComplaints@inforegulator.org.za">POPIAComplaints@inforegulator.org.za</a> ·{' '}
        <a href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">inforegulator.org.za</a>.
      </p>

      <h2>12. Changes</h2>
      <p>
        We will update this notice when our practices change, and the date at the top will show
        when it last changed.
      </p>
    </LegalDoc>
  )
}
