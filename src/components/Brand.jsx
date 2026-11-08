// Mizo brand marks. Source files and usage rules live in brand/.

const M_PATH = "M22 78V52a14 14 0 0 1 28 0v26M50 52a14 14 0 0 1 28 0v26"

/** The "m" with the coin (la mise) above it. Uses currentColor unless `coin` is given. */
export function MizoGlyph({ size = 20, coin = "currentColor", ...rest }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" {...rest}>
      <g transform="translate(0 3)">
        <path d={M_PATH} fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="50" cy="18" r="8" fill={coin} />
      </g>
    </svg>
  )
}

/** Terracotta tile with the white glyph and gold coin, as on the app icon. */
export function MizoMark({ size = 36 }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size, borderRadius: size * 0.25 }}>
      <MizoGlyph size={size * 0.72} coin="var(--brand-coin)" />
    </div>
  )
}

/** "mizo" monoline wordmark; the dot of the i is the coin. */
export function MizoWordmark({ height = 17, coin = "var(--brand)", title = "Mizo" }) {
  return (
    <svg viewBox="0 -30 848 310" height={height} width={height * 848 / 310} role="img" aria-label={title}>
      <path d="M20 260V140a60 60 0 0 1 120 0v120M140 140a60 60 0 0 1 120 0v120M336 260V80M412 80h160L412 260h160"
            fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="718" cy="170" r="90" fill="none" stroke="currentColor" strokeWidth="40" />
      <circle cx="336" cy="6" r="28" fill={coin} />
    </svg>
  )
}
