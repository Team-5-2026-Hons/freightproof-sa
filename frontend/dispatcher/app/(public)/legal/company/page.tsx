import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalDoc, LegalTable } from '@/components/landing/LegalDoc'
import { ROUTES } from '@/lib/constants/routes'
import { COMPANY } from '@/lib/landing/content'

export const metadata: Metadata = {
  title: 'Company information, PAIA and ECT Act: FreightProof SA',
  description: 'FreightProof SA company particulars under the ECT Act, and how to request information under PAIA.',
}

export default function CompanyPage() {
  const particulars = [
    ['Full name', COMPANY.legalName],
    ['Trading name', COMPANY.tradingName],
    ['Legal status', COMPANY.legalStatus],
    ['Registration number', COMPANY.registrationNumber],
    ['VAT number', COMPANY.vatNumber],
    ['Directors', COMPANY.directors.join(', ')],
    ['Physical address', COMPANY.physicalAddress],
    ['Address for service of legal documents', COMPANY.physicalAddress],
    ['Postal address', COMPANY.postalAddress],
    ['Telephone', COMPANY.phone],
    ['Email', <a key="e" href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>],
    ['Website', COMPANY.website],
    ['Information Officer', COMPANY.informationOfficer],
  ] as const

  return (
    <LegalDoc
      title="Company information"
      current={ROUTES.legalCompany}
      intro={
        <p>
          The particulars required by section 43 of the Electronic Communications and
          Transactions Act 25 of 2002, and how to request records under the Promotion of Access
          to Information Act 2 of 2000 (“PAIA”).
        </p>
      }
    >
      <h2>Company particulars</h2>
      <LegalTable caption="Company particulars" head={['', 'Details']} rows={particulars} />
      <p>
        FreightProof SA is not a member of any self-regulatory body or code of conduct for
        electronic transactions.
      </p>

      <h2>Requesting records under PAIA</h2>
      <p>
        PAIA gives you the right to request records we hold, subject to the grounds for refusal
        in the Act. To make a request:
      </p>
      <ul>
        <li>email the Information Officer at <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>, using Form 2 (Request for Access to Record) published by the Information Regulator;</li>
        <li>describe the record clearly and say how you would like to receive it;</li>
        <li>include proof of identity, and proof of authority if you are acting for someone else.</li>
      </ul>
      <p>
        We’ll respond within 30 days, as PAIA requires. Prescribed fees may apply to some
        requests, and we’ll tell you before any are charged. Our full PAIA manual is available on
        request from the Information Officer, free of charge.
      </p>
      <p>
        Requests about your own personal information can also be made under POPIA, as set out
        in the <Link href={ROUTES.legalPrivacy}>Privacy Notice</Link>.
      </p>

      <h2>Information Regulator</h2>
      <p>
        If a request is refused, you may complain to the Information Regulator (South Africa):
        JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001 ·{' '}
        <a href="mailto:PAIAComplaints@inforegulator.org.za">PAIAComplaints@inforegulator.org.za</a> ·{' '}
        <a href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">inforegulator.org.za</a>.
      </p>
    </LegalDoc>
  )
}
