// The address that opens a list page's Add pop-up (assistant spec B41). Pure, no React: the assistant's links
// build it without loading the sign-in code the opening hook needs (lib/fleet/add-form-link.ts).

export const ADD_FORM_PARAM = 'add'
export const ADD_FORM_VALUE = '1'

export function addFormHref(listPath: string): string {
  return `${listPath}?${ADD_FORM_PARAM}=${ADD_FORM_VALUE}`
}
