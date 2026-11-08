import { useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../components'

const SIDES = [
  { key: "front", label: "Recto" },
  { key: "back",  label: "Verso" },
]

/** Drawing of an ID card shown where no photo was provided (front: photo + lines, back: barcode + MRZ). */
function CardPlaceholder({ side }) {
  const line = (x, y, w) => <rect x={x} y={y} width={w} height="5" rx="2.5" fill="currentColor" opacity="0.35"/>
  return (
    <svg viewBox="0 0 172 108" aria-hidden="true" className="id-placeholder-art">
      <rect x="1" y="1" width="170" height="106" rx="9" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeDasharray="4 4"/>
      {side === "front" ? <>
        <rect x="12" y="20" width="44" height="56" rx="5" fill="currentColor" opacity="0.15"/>
        <circle cx="34" cy="40" r="10" fill="currentColor" opacity="0.3"/>
        <path d="M18 72c3-11 10-16 16-16s13 5 16 16" fill="currentColor" opacity="0.3"/>
        {line(66, 24, 80)}{line(66, 38, 60)}{line(66, 52, 90)}{line(66, 66, 50)}
      </> : <>
        {Array.from({ length: 22 }, (_, i) => (
          <rect key={i} x={14 + i * 6.5} y="16" width={i % 3 ? 2 : 4} height="30" fill="currentColor" opacity="0.3"/>
        ))}
        {line(14, 62, 144)}{line(14, 74, 144)}{line(14, 86, 120)}
      </>}
    </svg>
  )
}

/**
 * Front and back photos of a customer's ID document. A side not provided
 * shows a card placeholder; staff with customers:verify_identity can add or
 * replace either photo (uploaded to Convex storage).
 */
export default function IdDocument({ customerId }) {
  const me = useQuery(api.users.me)
  const images = useQuery(api.customers.idImages, { customerId })
  const generateUrl = useMutation(api.customers.generateIdUploadUrl)
  const setImage = useMutation(api.customers.setIdImage)
  const [busy, setBusy] = useState(null)       // side being uploaded
  const [error, setError] = useState(null)
  const inputs = useRef({})
  const canEdit = !!me?.can?.verifyIdentity

  const upload = async (side, file) => {
    if (!file) return
    setBusy(side); setError(null)
    try {
      const url = await generateUrl({ customerId })
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file })
      if (!res.ok) throw new Error("upload")
      const { storageId } = await res.json()
      const result = await setImage({ customerId, side, storageId })
      if (result !== "ok") setError(errorMessage({ data: result }))
    } catch (e) {
      setError(e?.message === "upload" ? "L'envoi de la photo a échoué. Réessayez." : errorMessage(e))
    } finally {
      setBusy(null)
      if (inputs.current[side]) inputs.current[side].value = ""
    }
  }

  return (
    <div>
      <div className="id-slots">
        {SIDES.map(({ key, label }) => {
          const url = images?.[key]
          return (
            <figure key={key} className="id-slot">
              {images === undefined ? (
                <div className="id-frame skel" aria-hidden="true"/>
              ) : url ? (
                <a className="id-frame" href={url} target="_blank" rel="noreferrer" title={`Ouvrir le ${label.toLowerCase()} en grand`}>
                  <img src={url} alt={`Pièce d'identité, ${label.toLowerCase()}`}/>
                </a>
              ) : (
                <div className="id-frame id-placeholder" role="img" aria-label={`${label} non fourni`}>
                  <CardPlaceholder side={key}/>
                </div>
              )}
              <figcaption>
                <span>{label}{!url && images !== undefined && <span className="cell-sub"> · non fourni</span>}</span>
                {canEdit && (
                  <>
                    <button className="btn ghost sm" style={{ padding: "2px 6px" }} disabled={busy !== null}
                      onClick={() => inputs.current[key]?.click()}>
                      {busy === key ? "Envoi…" : url ? "Remplacer" : "Ajouter"}
                    </button>
                    <input ref={el => { inputs.current[key] = el }} type="file" accept="image/*" hidden
                      aria-label={`Photo du ${label.toLowerCase()}`}
                      onChange={e => upload(key, e.target.files?.[0])}/>
                  </>
                )}
              </figcaption>
            </figure>
          )
        })}
      </div>
      {error && <div role="alert" style={{ color: "var(--neg)", fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  )
}
