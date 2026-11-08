import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * A button that opens a list of actions. `items` is a list of
 * `{ label, onSelect, danger?, disabled? }`, `{ header: "…" }` (section
 * title) or `{ separator: true }`. With more than `searchAbove` actions a
 * filter field is shown. The list is positioned fixed so table cells and
 * cards don't clip it, and opens upwards when there is no room below.
 * Keyboard: arrows move between actions, Escape closes.
 */
export function DropdownMenu({ label, items, disabled, align = "right", searchAbove = 8, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pos, setPos] = useState(null)
  const buttonRef = useRef(null)
  const popRef = useRef(null)

  const actions = items.filter(i => i.onSelect)
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? items.filter(i => i.onSelect && i.label.toLowerCase().includes(needle))
    : items

  // Under (or over) the button, kept inside the window
  useLayoutEffect(() => {
    if (!open) return
    const b = buttonRef.current.getBoundingClientRect()
    const pop = popRef.current
    const h = pop.scrollHeight
    const w = pop.offsetWidth
    const below = window.innerHeight - b.bottom - 12
    const above = b.top - 12
    // Below unless it doesn't fit and there's more room above; capped to the
    // room on that side (the list scrolls), so it never leaves the window
    const up = below < h && above > below
    const maxHeight = Math.max(120, up ? above : below)
    const height = Math.min(h, maxHeight)
    const top = up ? b.top - height - 4 : b.bottom + 4
    const left = align === "right" ? Math.max(8, b.right - w) : Math.min(b.left, window.innerWidth - w - 8)
    setPos({ top, left, maxHeight })
  }, [open, align, shown.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!popRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close()
    }
    // Page scroll or resize moves the button away; scrolling the list doesn't
    const onMove = (e) => {
      if (e?.target instanceof Node && popRef.current?.contains(e.target)) return
      close()
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("resize", onMove)
    window.addEventListener("scroll", onMove, true)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("resize", onMove)
      window.removeEventListener("scroll", onMove, true)
    }
  }, [open])

  // Focus the filter, or the first action
  useEffect(() => {
    if (!open || !pos) return
    const target = popRef.current?.querySelector(".menu-search, [role=menuitem]:not([disabled])")
    target?.focus()
  }, [open, pos])

  function close(refocus = false) {
    setOpen(false)
    setQuery("")
    setPos(null)
    if (refocus) buttonRef.current?.focus()
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); close(true); return }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const els = [...popRef.current.querySelectorAll("[role=menuitem]:not([disabled])")]
    if (!els.length) return
    const i = els.indexOf(document.activeElement)
    const next = e.key === "ArrowDown" ? (i + 1) % els.length : (i <= 0 ? els.length - 1 : i - 1)
    els[next].focus()
  }

  return (
    <>
      <button ref={buttonRef} type="button" className="btn sm" disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => (open ? close() : setOpen(true))}>
        {label}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div ref={popRef} className="menu-pop" role="menu" onKeyDown={onKeyDown}
          style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { visibility: "hidden", top: 0, left: 0 }}>
          {actions.length > searchAbove && (
            <input className="menu-search" placeholder="Rechercher…" value={query}
              onChange={e => setQuery(e.target.value)} aria-label="Filtrer les actions" />
          )}
          <div className="menu-list">
            {shown.map((it, i) =>
              it.separator ? <div key={i} className="menu-sep" role="separator" /> :
              it.header ? <div key={i} className="menu-label">{it.header}</div> :
              <button key={i} type="button" role="menuitem" disabled={it.disabled}
                className={"menu-item" + (it.danger ? " danger" : "")}
                onClick={() => { close(true); it.onSelect() }}>
                {it.label}
              </button>
            )}
            {needle && shown.length === 0 && <div className="menu-empty">Aucun résultat</div>}
          </div>
        </div>
      )}
    </>
  )
}
