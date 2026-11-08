import { I } from '../icons'

/** Numbered step header: done steps show a check, the current one is filled. */
export function WizardSteps({ steps, current }) {
  return (
    <ol className="wiz-steps">
      {steps.map((label, n) => (
        <li key={label} className={n < current ? "done" : n === current ? "on" : ""} aria-current={n === current ? "step" : undefined}>
          <span className="wiz-dot">{n < current ? <I.Check size={12} strokeWidth={2.4}/> : n + 1}</span>
          <span className="wiz-label">{label}</span>
        </li>
      ))}
    </ol>
  )
}

/** Footer of a wizard step: optional Retour on the left, the step's actions on the right. */
export function WizardFoot({ onBack, backDisabled, children }) {
  return (
    <div className="wiz-foot">
      {onBack && <button className="btn" disabled={backDisabled} onClick={onBack}>‹ Retour</button>}
      <div className="filter-spacer"/>
      {children}
    </div>
  )
}
