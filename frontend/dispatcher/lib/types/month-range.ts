/** An inclusive range of whole calendar months. Both bounds are first-of-month
 *  "YYYY-MM-01" strings — the only form the analytics API accepts. */
export interface MonthRange {
  start: string
  end: string
}
