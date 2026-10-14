/** A plain JSON object: narrows `unknown` response data without `any` or a cast. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
