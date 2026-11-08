import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard behaviour of a drawer or modal: focus moves into it on open and
 * back to where it was on close, Tab stays inside, Escape calls `onClose`.
 * Put the returned ref on the element with role="dialog"; pass `open` when
 * the component stays mounted while closed.
 */
export function useDialog(onClose, open = true) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const el = ref.current
    // The panel itself (tabIndex -1): its name is read, Tab goes to its first control
    el?.focus()

    const onKeyDown = (e) => {
      if (!el) return
      if (e.key === "Escape") {
        // An open dropdown inside handles its own Escape
        if (e.defaultPrevented) return
        e.preventDefault()
        closeRef.current?.()
        return
      }
      if (e.key !== "Tab") return
      const items = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  return ref
}
