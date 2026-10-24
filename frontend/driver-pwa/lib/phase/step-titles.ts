// What each step asks of the driver, as the step's large title. The
// shared STEP_NAMES ("Verification", "Linehaul") name steps for the system and the
// dispatcher; a driver at a gate needs the action instead. Keyed by slug, the same key
// the step routes use, so a recipe change is caught by the test that walks STEP_SLUGS.
const STEP_TITLES: Record<string, string> = {
  '2-verification': 'Start your trip',
  '1-linehaul': 'Check the linehaul sheet',
  '2-capture-seal': 'Capture the seal',
  '4-departure': 'Ready to depart',
  '2-seal-verify': 'Inspect the seal',
  '4-visual-count': 'Count the parcels',
  '1-pod-photo': 'Photograph the delivery',
  '2-receiver-handover': 'Hand over to the receiver',
  '3-reconciliation': 'Check it all adds up',
  '4-closed': 'Delivered',
}

export function stepTitle(slug: string): string | null {
  return STEP_TITLES[slug] ?? null
}
