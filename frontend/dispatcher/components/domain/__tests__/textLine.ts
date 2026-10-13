// A text matcher for a line whose value tokens sit in their own spans (the numeric rule wraps a
// seal number or a count): `getByText('Seal FP-7204')` only sees an element's own text nodes, so
// it would miss the line. This matches the line by its full text, and only the innermost element
// that carries all of it, so an ancestor never matches as well.
export function line(expected: string | RegExp): (content: string, element: Element | null) => boolean {
  const matches = (text: string | null): boolean => text !== null && (typeof expected === 'string' ? text === expected : expected.test(text))
  return (_content, element) =>
    element !== null && matches(element.textContent) && Array.from(element.children).every(child => !matches(child.textContent))
}
