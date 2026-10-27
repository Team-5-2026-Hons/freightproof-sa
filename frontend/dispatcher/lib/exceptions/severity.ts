import type { ExceptionSeverity } from '@shared/lib/types/exception'

export const SEVERITY_RANK: Readonly<Record<ExceptionSeverity, number>> = { critical: 0, warning: 1, info: 2 }

/** Severities from most to least severe, derived from the rank so the two cannot drift. */
export const SEVERITIES_BY_RANK: readonly ExceptionSeverity[] = (Object.keys(SEVERITY_RANK) as ExceptionSeverity[])
  .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])
