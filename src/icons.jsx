const Icon = ({ d, size = 16, fill = "none", stroke = "currentColor", strokeWidth = 1.6, children, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={stroke}
       strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {children || (d ? <path d={d} /> : null)}
  </svg>
)

export const I = {
  Grid:     (p) => <Icon {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></Icon>,
  Users:    (p) => <Icon {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 3-5 5.5-5s4.9 2 5.5 5"/><circle cx="16.5" cy="9" r="2.5"/><path d="M15 14.5c2.4 0 4.4 1.6 5 4"/></Icon>,
  Receipt:  (p) => <Icon {...p}><path d="M5 3.5h14v17l-2.5-1.5L14 20.5l-2.5-1.5L9 20.5l-2.5-1.5L4 20.5V3.5h1z"/><path d="M8 8h8M8 12h8M8 16h5"/></Icon>,
  Chart:    (p) => <Icon {...p}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></Icon>,
  Export:   (p) => <Icon {...p}><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/><path d="M12 4v12M7 9l5-5 5 5"/></Icon>,
  Shield:   (p) => <Icon {...p}><path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3z"/></Icon>,
  Star:     (p) => <Icon {...p}><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 17l-5.3 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z"/></Icon>,
  Plus:     (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  Search:   (p) => <Icon {...p}><circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.5-3.5"/></Icon>,
  Arrow:    (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>,
  ArrowDown:(p) => <Icon {...p}><path d="M12 5v14M6 13l6 6 6-6"/></Icon>,
  ArrowUp:  (p) => <Icon {...p}><path d="M12 19V5M6 11l6-6 6 6"/></Icon>,
  ArrowDR:  (p) => <Icon {...p}><path d="M7 7l10 10M9 17h8V9"/></Icon>,
  ArrowUR:  (p) => <Icon {...p}><path d="M7 17 17 7M9 7h8v8"/></Icon>,
  Bell:     (p) => <Icon {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/></Icon>,
  More:     (p) => <Icon {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/></Icon>,
  Filter:   (p) => <Icon {...p}><path d="M4 5h16l-6 8v6l-4-2v-4L4 5z"/></Icon>,
  Calendar: (p) => <Icon {...p}><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></Icon>,
  Phone:    (p) => <Icon {...p}><path d="M21 17v3a1 1 0 0 1-1.1 1A18 18 0 0 1 3 4.1 1 1 0 0 1 4 3h3a1 1 0 0 1 1 .8c.1.9.4 1.7.7 2.5a1 1 0 0 1-.2 1L7.2 8.7a14 14 0 0 0 8.1 8.1l1.4-1.4a1 1 0 0 1 1-.2c.8.3 1.6.6 2.5.7a1 1 0 0 1 .8 1z"/></Icon>,
  Pin:      (p) => <Icon {...p}><path d="M12 21v-7M5 9h14l-2 7H7L5 9zM7 9V5h10v4"/></Icon>,
  Wallet:   (p) => <Icon {...p}><path d="M3.5 7.5h13a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-13v-12z"/><path d="M3.5 7.5V6a2 2 0 0 1 2-2H15"/><circle cx="16" cy="13.5" r="1.2" fill="currentColor"/></Icon>,
  Coin:     (p) => <Icon {...p}><circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5c0-1.1 1.1-1.8 2.5-1.8s2.5.8 2.5 1.9c0 1-.7 1.5-2.5 1.9-1.8.4-2.5.9-2.5 1.9s1.1 1.9 2.5 1.9 2.5-.7 2.5-1.8"/></Icon>,
  Check:    (p) => <Icon {...p}><path d="m5 12 5 5 9-11"/></Icon>,
  Sun:      (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></Icon>,
  Settings: (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></Icon>,
  Wifi:     (p) => <Icon {...p}><path d="M5 12.5a10 10 0 0 1 14 0M8 16a5 5 0 0 1 8 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></Icon>,
  Cloud:    (p) => <Icon {...p}><path d="M7 18h11a4 4 0 0 0 .5-7.95A6 6 0 0 0 7 9.5 4.5 4.5 0 0 0 7 18z"/></Icon>,
  Folder:   (p) => <Icon {...p}><path d="M3.5 7a2 2 0 0 1 2-2h3.5l2 2h7.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7z"/></Icon>,
  Sparkle:  (p) => <Icon {...p}><path d="M12 4v6M12 14v6M4 12h6M14 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/></Icon>,
  Logout:   (p) => <Icon {...p}><path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4M6 12h10"/></Icon>,
}
