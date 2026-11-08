import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * In-app replacement for window.confirm. Resolves true when the action is
 * confirmed, false when it is cancelled (button, Escape).
 *
 *   if (!(await confirmDialog({ title: "Supprimer l'objectif ?", message, confirmLabel: "Supprimer", danger: true }))) return
 *
 * Built on <dialog>.showModal(): focus stays inside and the page behind is
 * inert. Focus starts on "Annuler", so Enter alone never confirms a
 * destructive action, and goes back to the opener on close.
 */
export function confirmDialog({ title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler", danger = false }) {
  return new Promise((resolve) => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const opener = document.activeElement
    const done = (ok) => {
      root.unmount()
      host.remove()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
      resolve(ok)
    }
    root.render(
      <ConfirmDialog title={title} message={message} confirmLabel={confirmLabel}
        cancelLabel={cancelLabel} danger={danger} onDone={done} />,
    )
  })
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onDone }) {
  const ref = useRef(null)
  const cancelRef = useRef(null)
  useEffect(() => {
    ref.current?.showModal()
    cancelRef.current?.focus()
  }, [])

  return (
    <dialog ref={ref} className="modal confirm" role="alertdialog"
      aria-labelledby="confirm-title" aria-describedby="confirm-message"
      onCancel={(e) => { e.preventDefault(); onDone(false) }}
      // Keys stay here: a drawer underneath (useDialog) must not see this
      // Escape and close too, nor pull Tab focus back into itself
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Escape") { e.preventDefault(); onDone(false) }
      }}>
      <div className="modal-body">
        <div id="confirm-title" className="modal-title">{title}</div>
        {message && <p id="confirm-message" className="confirm-message">{message}</p>}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={() => onDone(false)}>{cancelLabel}</button>
          <button type="button" className={"btn " + (danger ? "danger" : "brand")} onClick={() => onDone(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
