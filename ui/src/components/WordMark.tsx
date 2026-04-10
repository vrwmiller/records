export function WordMark() {
  return (
    <svg
      viewBox="0 0 138 36"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      style={{ height: '2.25rem', width: 'auto' }}
    >
      {/* Vinyl record body */}
      <circle cx="18" cy="18" r="17" fill="#1c1c1e" />
      {/* Groove rings */}
      <circle cx="18" cy="18" r="14" fill="none" stroke="#2e2e2e" strokeWidth="0.6" />
      <circle cx="18" cy="18" r="11" fill="none" stroke="#2e2e2e" strokeWidth="0.6" />
      <circle cx="18" cy="18" r="8"  fill="none" stroke="#2e2e2e" strokeWidth="0.6" />
      {/* Center label — warm amber */}
      <circle cx="18" cy="18" r="5.5" fill="#b8732a" />
      {/* Center spindle hole */}
      <circle cx="18" cy="18" r="1.5" fill="#1c1c1e" />
      {/* "RECORD" — small, spaced, muted */}
      <text
        x="42"
        y="14"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="9"
        letterSpacing="0.22em"
        fill="currentColor"
        opacity="0.5"
      >RECORD</text>
      {/* "RANCH" — prominent */}
      <text
        x="42"
        y="30"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="16"
        letterSpacing="0.08em"
        fill="currentColor"
        fontWeight="700"
      >RANCH</text>
    </svg>
  )
}
