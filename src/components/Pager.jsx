import { useEffect, useState } from 'react'

/**
 * Client-side pagination over an in-memory list. Goes back to the first page
 * when the list length changes (new file, new mapping, import finished).
 */
export function usePaged(rows, size = 20) {
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [rows.length])
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(page, pages - 1)
  return {
    page: current,
    pages,
    size,
    total: rows.length,
    rows: rows.slice(current * size, (current + 1) * size),
    setPage: (p) => setPage(Math.max(0, Math.min(p, pages - 1))),
  }
}

/** Page numbers to show: first, last, and two around the current page, with gaps as null. */
function pageList(page, pages) {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages))
  const list = []
  let prev = -1
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev > 1) list.push(null)
    list.push(p)
    prev = p
  }
  return list
}

/** Footer under a table: "Lignes 51–100 sur 1 240" and previous / page numbers / next. */
export function Pager({ paged, unit = "lignes" }) {
  const { page, pages, size, total, setPage } = paged
  if (total === 0) return null
  const from = page * size + 1
  const to = Math.min(total, from + size - 1)
  return (
    <div className="table-foot">
      <span>{unit[0].toUpperCase() + unit.slice(1)} {from}–{to} sur {total.toLocaleString("fr-FR")}</span>
      {pages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Précédent</button>
          {pageList(page, pages).map((p, i) => p === null
            ? <span key={"gap" + i} className="cell-sub" style={{ padding: "0 4px" }}>…</span>
            : <button key={p} type="button" className={"page-num" + (p === page ? " on" : "")}
                      style={{ border: "none", font: "inherit", fontSize: 12.5, background: p === page ? undefined : "transparent" }}
                      aria-current={p === page ? "page" : undefined}
                      onClick={() => setPage(p)}>{p + 1}</button>)}
          <button className="btn ghost sm" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>Suivant ›</button>
        </div>
      )}
    </div>
  )
}
