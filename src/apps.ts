// Tiles shown on the home page. Add an entry here to add an app to the menu.
export interface AppTile {
  key: string
  title: string
  description: string
  to: string           // internal route ("/payments") or full URL ("https://…")
  icon: string         // short glyph shown in the tile
  adminOnly?: boolean
}

export const APPS: AppTile[] = [
  {
    key: 'payments',
    title: 'Payments',
    description: 'Live feed of QuickBooks payments from tracked clients, with totals by client and month.',
    to: '/payments',
    icon: '$',
  },
  {
    key: 'admin',
    title: 'Settings',
    description: 'Connect QuickBooks, choose which clients show, and manage users and roles.',
    to: '/admin',
    icon: '⚙',
    adminOnly: true,
  },
]
