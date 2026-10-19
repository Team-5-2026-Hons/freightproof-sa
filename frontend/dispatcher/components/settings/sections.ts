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
  /** One line under the heading saying what lives here. */
  description: string
  icon: LucideIcon
  /** Hidden from the list, and unreachable by URL, for anyone but an admin dispatcher. */
  adminOnly?: boolean
  Component: ComponentType
}

// Adding a settings group is one entry here plus one component. Order is display order, and
// Account stays first: it is the fallback for an unknown or forbidden ?section=.
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
