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
    title: 'Payments App',
    description: 'Live feed of QuickBooks payments',
    to: '/payments',
    icon: '$',
  },
  {
    key: 'billing',
    title: 'Billing App',
    description: 'Client billing and invoicing.',
    to: 'https://bright-companion-hub-dusky.vercel.app',
    icon: '▤',
  },
  {
    key: 'household',
    title: 'Brill Household Financials',
    description: 'Household budget and finances.',
    to: '/apps/household',
    icon: '⌂',
  },
  {
    key: 'networth',
    title: 'Net Worth Tracker',
    description: 'Assets, liabilities, and net worth over time.',
    to: '/apps/networth',
    icon: '↗',
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
