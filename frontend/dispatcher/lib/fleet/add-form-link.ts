'use client'

// A link that opens a list page's Add pop-up (Add Driver, Add Vehicle): the assistant's "add a driver" button
// (assistant spec B41, Tom: "a button i click that just takes me straight to the add driver").
//
// The pop-up opens EMPTY. Nothing is carried in the address but "add=1": the form asks for SA ID, phone and
// licence numbers, which never pass through the assistant or a URL (spec D1, D2a).

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { ADD_FORM_PARAM, ADD_FORM_VALUE } from '@/lib/fleet/add-form-href'
import { useAuth } from '@/lib/hooks/useAuth'

// The role the pages' Add buttons are shown to (components/auth/AdminOnly.tsx).
const ADD_ROLE = 'admin_dispatcher'

/** Open a list page's Add pop-up when its address asks for it, for the same people who see its Add button, then
 *  tidy the address so a refresh or Back doesn't open it again. Another role just gets the list. */
export function useAddFormLink(listPath: string, open: () => void): void {
  const asked = useSearchParams().get(ADD_FORM_PARAM) === ADD_FORM_VALUE
  const { user } = useAuth()
  const router = useRouter()
  const [handled, setHandled] = useState(false)

  // Adjusted during render, not in an effect (the react-hooks rule), as the trip form's prefill is.
  if (asked && user?.role === ADD_ROLE && !handled) {
    setHandled(true)
    open()
  }
  if (!asked && handled) setHandled(false)

  useEffect(() => {
    // Wait for the user, so an admin's link isn't tidied away before it could open the pop-up.
    if (asked && user) router.replace(listPath, { scroll: false })
  }, [asked, user, listPath, router])
}
