import type { ComponentType } from 'react'
import { ScanSearch, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react'
import { AccountSection } from '@/components/settings/AccountSection'
import { DisplaySection } from '@/components/settings/DisplaySection'
import { ForensicSection } from '@/components/settings/ForensicSection'
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from '@/lib/settings/section-query'
import type { DispatcherUser } from '@/lib/types/user'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  description: string
  icon: LucideIcon
  adminOnly?: boolean
  Component: ComponentType
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: SETTINGS_SECTION_IDS.account,
    label: 'Account',
    description: 'Who you are signed in as, and the IDs support may ask for.',
    icon: UserRound,
    Component: AccountSection,
  },
  {
    id: SETTINGS_SECTION_IDS.display,
    label: 'Display',
    description: 'How lists and sign-in behave on this browser.',
    icon: SlidersHorizontal,
    Component: DisplaySection,
  },
  {
    id: SETTINGS_SECTION_IDS.forensic,
    label: 'Forensic view',
    description: 'Evidence detail for admin dispatchers.',
    icon: ScanSearch,
    adminOnly: true,
    Component: ForensicSection,
  },
]

/** The sections a dispatcher of this role may open. */
export function visibleSections(role: DispatcherUser['role'] | undefined): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter(section => !section.adminOnly || role === 'admin_dispatcher')
}
