import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useExceptionListRestoration } from './useExceptionListRestoration'
function container(): HTMLDivElement { const el = document.createElement('div'); el.innerHTML = '<h2 data-results-heading tabindex="-1">Results</h2><a data-exception-id="remaining" href="#">Remaining</a>'; document.body.append(el); return el }
describe('scoped list restoration', () => {
  it('restores scroll and focuses remaining results when reviewed row disappears', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
    const el = container(); const ref = { current: el }
    const first = renderHook(() => useExceptionListRestoration({ userId: 'me', origin: '/exceptions?tab=mine', container: ref, ready: true }))
    el.scrollTop = 130
    act(() => first.result.current.save('gone'))
    first.unmount(); el.scrollTop = 0
    renderHook(() => useExceptionListRestoration({ userId: 'me', origin: '/exceptions?tab=mine', container: ref, ready: true }))
    expect(el.scrollTop).toBe(130); expect(document.activeElement).toBe(el.querySelector('a'))
    el.remove(); vi.unstubAllGlobals()
  })
  it('clears prior-user restoration and survives unavailable storage', () => {
    const el = container(); const ref = { current: el }
    const hook = renderHook(
      ({user}) => useExceptionListRestoration({ userId: user, origin: '/exceptions', container: ref, ready: false }),
      { initialProps: { user: 'first' as string | null } },
    )
    act(() => hook.result.current.save('row'))
    hook.rerender({user: 'second'})
    expect(Object.keys(sessionStorage).some(key => key.includes('first'))).toBe(false)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => hook.result.current.save('row')).not.toThrow()
    vi.restoreAllMocks(); el.remove()
  })
})

it('restores after expansion state has rendered, without cancelling the only animation frame', () => {
  const callbacks=new Map<number,FrameRequestCallback>();let sequence=0
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{callbacks.set(++sequence,cb);return sequence})
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id))
  const el=container();const ref={current:el}
  const first=renderHook(()=>useExceptionListRestoration({ userId: 'delayed', origin: '/exceptions?group=trip', container: ref, ready: true }))
  act(()=>first.result.current.setExpanded({'trip':false}))
  el.scrollTop=250;act(()=>first.result.current.save('remaining'));first.unmount();el.scrollTop=0
  renderHook(()=>useExceptionListRestoration({ userId: 'delayed', origin: '/exceptions?group=trip', container: ref, ready: true }))
  act(()=>{for(const callback of callbacks.values()) callback(0)})
  expect(el.scrollTop).toBe(250)
  el.remove();vi.unstubAllGlobals()
})
