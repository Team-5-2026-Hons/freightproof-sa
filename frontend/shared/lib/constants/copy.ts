// All user-facing strings in one place.
// Change copy here; pages and components pick it up automatically.

export const COPY = {
  emptyState: {
    activeTrips:  { title: 'No active trips',   body: 'All clear — no trips currently in progress.' },
    allClear:     { title: 'All clear',          body: 'No open exceptions. The evidence chain is clean.' },
    history:      { title: 'No trips found',     body: 'Try adjusting your filters or date range.' },
    noResults:    { title: 'No results',          body: 'No items match your current filters.' },
    driverNoTrip: { title: 'No trip assigned',   body: 'Check back with dispatch.' },
    slaNoData:    { title: 'No data',            body: 'No trips for this period. Adjust the date range or client filter.' },
  },

  errors: {
    generic:       'Something went wrong. Please try again.',
    notFound:      'This record does not exist or you do not have access to it.',
    networkOffline: 'You are offline. Actions will submit when reconnected.',
    photoRequired: 'A photo is required before continuing.',
    sealRequired:  'Seal number is required.',
    sealFormat:    'Seal number must be in format XX-####.',
  },

  actions: {
    back:               'Back',
    completeAndContinue: 'Complete & continue',
    submitPickup:       'Submit pickup · Anchor to chain',
    submitDelivery:     'Submit delivery · Anchor to chain',
    retakePhoto:        'Retake',
    viewTrip:           'View trip',
    resolve:            'Resolve',
    addReview:          'Add review',
    submitReview:       'Submit review',
    override:           'Override',
    escalate:           'Escalate',
    addNote:            'Add note',
    exportPdf:          'Export PDF',
    signOut:            'Sign out',
    logCheckpoint:      'Log checkpoint',
    reportException:    'Report exception',
    uploadDocument:     'Upload document',
    returnHome:         'Return home',
    returnToTrip:       'Return to trip',
    guardScansDone:     'Guard scans done · Continue',
    proceedToLoading:   'Proceed to loading bay',
  },

  toast: {
    tripCreated:       'Trip created · Journey lock anchored',
    panicSent:         'Panic alert sent · Dispatcher and security notified',
    exceptionLogged:   'Exception logged',
    overrideApplied:   'Override applied · Trip may continue',
    exceptionReviewed: 'Exception reviewed.',
    exportStarted:     'Export started — your PDF will download shortly',
    pickupAnchored:    (ref: string) => `Pickup anchored · Receipt #${ref}`,
    deliveryAnchored:  (ref: string) => `Delivery anchored · Receipt #${ref}`,
  },

  confirm: {
    panicHold:    'Swipe to send panic alert',
    panicSent:    'Panic alert sent · Dispatcher and reaction company notified',
    overrideNote: 'Describe why you are overriding this exception',
    addNote:      'Add a note to this exception',
    // Recording a review is evidence capture, not an operational resolution.
    reviewNote:         'Describe your assessment of this exception',
    // Disabled placeholder so it can never be submitted, unlike the contact-method
    // field's own blank option, which is a real, submittable answer.
    reviewOutcomeUnset: 'Select an outcome',
    // Stops a dispatcher reviewing a closed/cancelled trip from assuming the review reopens it.
    reviewNotice:       'Reviewing records your assessment. It does not change or reopen the trip.',
  },
} as const
