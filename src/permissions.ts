// Functions that can be granted to account types on the Roles screen.
export interface Permission {
  key: string
  title: string
  description: string
}

export const PERMISSIONS: Permission[] = [
  { key: 'manage_users', title: 'Manage users', description: 'Add people, change roles, send password links.' },
  {
    key: 'manage_app_access',
    title: 'Grant app access',
    description: 'Tick which apps each person can open, based on their own access.',
  },
  { key: 'manage_quickbooks', title: 'Connect QuickBooks', description: 'Connect, reconnect, and run syncs.' },
  { key: 'manage_clients', title: 'Choose tracked clients', description: 'Pick which clients show in the Payments App.' },
]
