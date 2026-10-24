import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import { TYPE_ROLES } from '@/lib/constants/type-scale'

// The app's iOS type roles (text-body, text-footnote, …) are custom font sizes, and
// tailwind-merge only knows Tailwind's built-in ones — left unregistered it reads
// `text-body` as a text colour and drops the real colour it conflicts with
// ("text-primary-on text-body" merged to just "text-body": black label on a black button).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_ROLES] }],
    },
  },
})

// Standard shadcn/ui class combiner: clsx resolves conditional class arrays/objects,
// twMerge then dedupes conflicting Tailwind utilities (e.g. "px-2 px-4" -> "px-4") so
// a caller's className prop can safely override a component's own defaults.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
