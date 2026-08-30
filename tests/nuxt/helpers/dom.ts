/** Structural shape of what we need from a `mountSuspended` result — narrow
 * on purpose so callers never need `VueWrapper<any>`. */
export interface ElementWrapper {
  find: (selector: string) => { element: Element }
}

export function inputElement(wrapper: ElementWrapper, selector: string): HTMLInputElement {
  const el = wrapper.find(selector).element
  if (!(el instanceof HTMLInputElement)) throw new Error(`expected an <input> at ${selector}`)
  return el
}

export function buttonElement(wrapper: ElementWrapper, selector: string): HTMLButtonElement {
  const el = wrapper.find(selector).element
  if (!(el instanceof HTMLButtonElement)) throw new Error(`expected a <button> at ${selector}`)
  return el
}
