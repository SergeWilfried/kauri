// Spreadsheet helpers for the Import page: read a .xlsx or .csv file into
// rows, guess which column holds which field, and turn French-formatted
// cells (amounts, dates, operation types) into the values the server takes.
// Kept free of React so it can be tested on its own.

/** Read the first sheet of an .xlsx, or a .csv/.txt file, as an array of rows. */
export async function readRows(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv(await file.text())
  const { readSheet } = await import("read-excel-file/browser")
  return readSheet(file)
}

/**
 * Parse CSV text. The separator is whichever of `;` (French Excel), `,` or
 * tab appears most in the first line; quoted fields may hold separators,
 * doubled quotes and line breaks. Empty lines are dropped.
 */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, "")
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ""
  const count = (ch) => firstLine.split(ch).length - 1
  const sep = [";", ",", "\t"].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ";")

  const rows = []
  let row = [], cell = "", quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell.trim()); cell = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(cell.trim()); rows.push(row); row = []; cell = ""
    } else cell += ch
  }
  row.push(cell.trim()); rows.push(row)
  return rows.filter((r) => r.some((c) => c !== ""))
}

/** Lowercase, drop accents and anything but letters and digits: "N° Téléphone" → "ntelephone". */
export function normalizeHeader(h) {
  return String(h ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "")
}

const ACCOUNT_ALIASES = ["compte", "numerocompte", "numerodecompte", "ncompte", "account", "codeclient", "code", "matricule"]

/** Import fields per kind, with the headers that are recognised for each. */
export const FIELDS = {
  customers: [
    { key: "legacyId", label: "ID (ancienne application)", aliases: ["id", "idclient", "identifiant", "ancienid"] },
    { key: "fullName", label: "Nom complet", required: true, aliases: ["nom", "nomcomplet", "nomprenom", "nomprenoms", "nometprenom", "nometprenoms", "client", "nomclient", "name", "fullname"] },
    { key: "phoneNumber", label: "Téléphone", required: true, aliases: ["telephone", "tel", "phone", "numero", "numerotelephone", "ntelephone", "contact", "mobile", "portable"] },
    { key: "idNumber", label: "N° de pièce", aliases: ["cni", "cnib", "piece", "numeropiece", "npiece", "nci", "idnumber", "piecedidentite"] },
    { key: "address", label: "Adresse", aliases: ["adresse", "quartier", "village", "address", "localite"] },
    { key: "groupName", label: "Groupe", aliases: ["groupe", "group", "tontine", "groupement"] },
    { key: "accountNumber", label: "N° de compte", aliases: ACCOUNT_ALIASES },
    { key: "email", label: "Email", aliases: ["email", "mail", "courriel"] },
    { key: "commitmentAmount", label: "Mise", aliases: ["mise", "engagement", "montantengagement", "cotisation", "cotisationjournaliere", "commitment", "engagementdepargne", "engagementepargne"] },
  ],
  transactions: [
    { key: "legacyClientId", label: "ID client (ancienne application)", aliases: ["idclient", "clientid", "identifiantclient"] },
    { key: "phoneNumber", label: "Téléphone du client", aliases: ["telephone", "tel", "phone", "numero", "numerotelephone", "ntelephone", "contact", "mobile"] },
    { key: "accountNumber", label: "N° de compte", aliases: ACCOUNT_ALIASES },
    { key: "reference", label: "Référence de l'opération", aliases: ["id", "reference", "ref", "idtransaction", "idoperation"] },
    { key: "clientName", label: "Nom du client (affichage)", aliases: ["nom", "client", "nomclient", "nomcomplet", "name"] },
    { key: "type", label: "Type (dépôt / retrait)", aliases: ["type", "operation", "nature", "sens", "mouvement"] },
    { key: "amount", label: "Montant", required: true, aliases: ["montant", "amount", "somme", "valeur", "montantfcfa"] },
    { key: "date", label: "Date", required: true, aliases: ["date", "jour", "dateoperation", "datetransaction"] },
    { key: "time", label: "Heure", aliases: ["heure", "time", "horaire"] },
    { key: "agentName", label: "Agent", aliases: ["agent", "collecteur", "agentname", "nomagent"] },
  ],
}

/**
 * Clients file of the old app's backup ("clients-AAAA-MM-JJ.csv"): the
 * customer fields plus its client ID and balance, both required.
 */
FIELDS.backupClients = [
  ...FIELDS.customers.map((f) => (f.key === "legacyId" ? { ...f, required: true } : f)),
  { key: "balance", label: "Solde", required: true, aliases: ["solde", "balance", "soldeactuel"] },
]

/** Column index for each field, from the header row; -1 where none matches. */
export function guessMapping(kind, headers) {
  const norm = headers.map(normalizeHeader)
  const used = new Set()
  const mapping = {}
  for (const f of FIELDS[kind]) {
    const i = norm.findIndex((h, j) => !used.has(j) && f.aliases.includes(h))
    mapping[f.key] = i
    if (i >= 0) used.add(i)
  }
  return mapping
}

const text = (v) => (v === null || v === undefined ? "" : v instanceof Date ? "" : String(v).trim())

/**
 * A whole FCFA amount, or null. Accepts numbers and strings such as
 * "10 000", "10.000", "10,000 F" or "-2500"; decimals are refused.
 */
export function parseAmount(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null
  let s = text(v).replace(/[\s  ]/g, "").replace(/(fcfa|cfa|xof|f)$/i, "")
  if (!s) return null
  const neg = s.startsWith("-")
  if (neg || s.startsWith("+")) s = s.slice(1)
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "")
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return neg ? -n : n
}

/**
 * A date as a UTC-midnight timestamp, or null. Accepts Date cells, Excel
 * serial numbers, "jj/mm/aaaa" (also with - or .; two-digit years are 20xx)
 * and "aaaa-mm-jj", optionally followed by a time, which is ignored.
 */
export function parseDate(v) {
  const ok = (y, m, d) => {
    const t = Date.UTC(y, m - 1, d)
    const back = new Date(t)
    return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? t : null
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : ok(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  if (typeof v === "number") {
    // Excel serial day number (1900 system); 25569 is 1970-01-01
    if (v < 20000 || v > 80000) return null
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000))
    return ok(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const s = text(v).split(/[ T]/)[0]
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) return ok(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]))
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return ok(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

/**
 * Time of day in ms, or null if unreadable; 0 for an empty cell. Accepts
 * "13:46", "9:54 AM", "12:36 PM", "08h30", Date cells and Excel day fractions.
 */
export function parseTime(v) {
  if (v === null || v === undefined || v === "") return 0
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : (v.getUTCHours() * 60 + v.getUTCMinutes()) * 60000
  if (typeof v === "number") return v >= 0 && v < 1 ? Math.round(v * 1440) * 60000 : null
  const m = text(v).toLowerCase().match(/^(\d{1,2})\s*[:h]\s*(\d{2})(?:\s*:\s*\d{2})?\s*(am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3] === "pm" ? 12 : 0)
  }
  if (h > 23 || min > 59) return null
  return (h * 60 + min) * 60000
}

/** Time of day (ms) carried by a date cell such as "15/01/2024 13:46"; 0 if none. */
function timeOfDateCell(v) {
  if (v instanceof Date) return parseTime(v) ?? 0
  if (typeof v === "number") return parseTime(v - Math.floor(v)) ?? 0
  const rest = text(v).split(/[ T]/).slice(1).join(" ").trim()
  return rest ? parseTime(rest) ?? 0 : 0
}

const DEPOSIT_WORDS = ["depot", "deposit", "d", "versement", "cotisation", "credit", "entree", "collecte", "+"]
const WITHDRAWAL_WORDS = ["retrait", "withdrawal", "r", "debit", "sortie", "paiement", "decaissement", "-"]

/** "deposit", "withdrawal" or null for an operation-type cell. */
export function parseType(v) {
  const raw = text(v)
  if (raw === "+" || raw === "-") return raw === "+" ? "deposit" : "withdrawal"
  const n = normalizeHeader(raw)
  if (DEPOSIT_WORDS.includes(n)) return "deposit"
  if (WITHDRAWAL_WORDS.includes(n)) return "withdrawal"
  return null
}

const cell = (row, i) => (i >= 0 ? row[i] : undefined)

/**
 * Turn data rows into import payloads. Each item has `row` (the spreadsheet
 * line number, the header being line 1) and either `payload` for the server
 * or `error` (a code shown in the report). Transactions also get
 * `occurrence`: how many identical earlier rows the file has, so a re-import
 * of the same file is recognised.
 */
export function buildItems(kind, dataRows, mapping) {
  const items = dataRows.map((r, idx) => {
    const row = idx + 2
    if (kind === "customers" || kind === "backupClients") {
      const fullName = text(cell(r, mapping.fullName))
      const phoneNumber = text(cell(r, mapping.phoneNumber))
      if (!fullName) return { row, error: "NAME_REQUIRED", label: phoneNumber }
      if (!phoneNumber) return { row, error: "INVALID_PHONE", label: fullName }
      const payload = { row, fullName, phoneNumber }
      for (const k of ["legacyId", "idNumber", "address", "groupName", "accountNumber", "email"]) {
        const val = text(cell(r, mapping[k]))
        if (val) payload[k] = val
      }
      const mise = cell(r, mapping.commitmentAmount)
      if (text(mise) !== "" || typeof mise === "number") {
        const n = parseAmount(mise)
        if (n === null || n < 0) return { row, error: "INVALID_AMOUNT", label: fullName }
        payload.commitmentAmount = n
      }
      if (kind === "backupClients") {
        if (!payload.legacyId) return { row, error: "LEGACY_ID_REQUIRED", label: fullName }
        const balance = parseAmount(cell(r, mapping.balance))
        if (balance === null) return { row, error: "INVALID_BALANCE", label: fullName }
        return { row, payload, label: fullName, balance }
      }
      return { row, payload, label: fullName }
    }

    const legacyClientId = text(cell(r, mapping.legacyClientId))
    const phoneNumber = text(cell(r, mapping.phoneNumber))
    const accountNumber = text(cell(r, mapping.accountNumber))
    const label = text(cell(r, mapping.clientName)) || phoneNumber || accountNumber || legacyClientId
    if (!legacyClientId && !phoneNumber && !accountNumber) return { row, error: "CUSTOMER_REQUIRED", label }
    const signed = parseAmount(cell(r, mapping.amount))
    if (signed === null || signed === 0) return { row, error: "INVALID_AMOUNT", label }
    let type = signed < 0 ? "withdrawal" : "deposit"
    if (mapping.type >= 0) {
      const t = parseType(cell(r, mapping.type))
      if (!t) return { row, error: "INVALID_TYPE", label }
      type = t
    }
    const dateCell = cell(r, mapping.date)
    const day = parseDate(dateCell)
    // Without a time column, keep the time of a combined date-time cell
    const time = mapping.time >= 0 ? parseTime(cell(r, mapping.time)) : timeOfDateCell(dateCell)
    if (day === null || time === null) return { row, error: "INVALID_DATE", label }
    const payload = { row, type, amount: Math.abs(signed), date: day + time }
    if (legacyClientId) payload.legacyClientId = legacyClientId
    const reference = text(cell(r, mapping.reference))
    if (reference) payload.reference = reference
    if (phoneNumber) payload.phoneNumber = phoneNumber
    if (accountNumber) payload.accountNumber = accountNumber
    const agentName = text(cell(r, mapping.agentName))
    if (agentName) payload.agentName = agentName
    return { row, payload, label }
  })

  if (kind === "transactions") {
    const seen = new Map()
    for (const it of items) {
      if (!it.payload) continue
      const p = it.payload
      const key = [p.legacyClientId ?? "", p.phoneNumber ?? "", (p.accountNumber ?? "").toUpperCase(), p.type, p.amount, p.date].join("|")
      const n = seen.get(key) ?? 0
      p.occurrence = n
      seen.set(key, n + 1)
    }
  }
  return items
}

/** Reasons shown in import reports, by code from buildItems or convex/imports.ts. */
export const IMPORT_REASONS = {
  NAME_REQUIRED:      "Nom manquant",
  INVALID_PHONE:      "Téléphone manquant ou invalide",
  INVALID_ID_NUMBER:  "N° de pièce trop long",
  PHONE_TAKEN:        "Client déjà enregistré (même téléphone, sans n° de compte)",
  ACCOUNT_TAKEN:      "N° de compte déjà utilisé dans l'agence",
  LEGACY_ID_REQUIRED: "ID client manquant",
  INVALID_BALANCE:    "Solde illisible",
  CUSTOMER_REQUIRED:  "ID client, téléphone ou n° de compte manquant",
  CUSTOMER_NOT_FOUND: "Client introuvable dans votre agence",
  AMBIGUOUS_PHONE:    "Téléphone partagé par plusieurs comptes : précisez le n° de compte",
  INVALID_AMOUNT:     "Montant invalide",
  INVALID_TYPE:       "Type inconnu (attendu : Dépôt, Collecte ou Retrait)",
  INVALID_DATE:       "Date ou heure invalide, ou dans le futur",
  ALREADY_IMPORTED:   "Déjà importé",
  BALANCE_OK:         "Solde déjà correct",
}

/** CSV text (";"-separated, with a BOM so Excel reads the accents) for download. */
export function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? "")
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n")
}

/** Offer `content` as a file download. */
export function downloadText(filename, content, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement("a"), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Example files offered on the Import page. */
export const TEMPLATES = {
  customers: [
    ["Nom", "Téléphone", "N° pièce", "Adresse", "Groupe", "N° compte", "Email", "Mise"],
    ["Awa Traoré", "70 11 22 33", "B1234567", "Secteur 15, Ouagadougou", "Groupe Espoir", "C-0001", "", "500"],
  ],
  transactions: [
    ["Téléphone", "N° compte", "Type", "Montant", "Date", "Agent"],
    ["70 11 22 33", "", "Dépôt", "10 000", "01/03/2025", "Ali Kaboré"],
    ["", "C-0001", "Retrait", "4 000", "15/03/2025", "Ali Kaboré"],
  ],
}
