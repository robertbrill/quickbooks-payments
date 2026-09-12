export type Role = 'admin' | 'member' | 'blocked'

export interface TeamMember {
  id: string
  email: string | null
  role: Role
  created_at: string
  invited_at: string | null
  last_seen_at: string | null
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  member: 'User',
  blocked: 'Blocked',
}

export interface Customer {
  id: string
  realm_id: string
  display_name: string
  company_name: string | null
  email: string | null
  active: boolean
  tracked: boolean
  synced_at: string
}

export interface LinkedInvoice {
  txn_type: string
  txn_id: string
  doc_number: string | null
  amount: number | null
}

export interface Payment {
  id: string
  realm_id: string
  customer_id: string | null
  customer_name: string | null
  total_amount: number
  unapplied_amount: number | null
  currency: string | null
  txn_date: string | null
  payment_method: string | null
  reference_number: string | null
  private_note: string | null
  linked_invoices: LinkedInvoice[] | null
  qbo_created_at: string | null
  qbo_updated_at: string | null
  deleted: boolean
  received_at: string
  updated_at: string
}

export interface ConnectionStatus {
  realm_id: string
  company_name: string | null
  environment: 'sandbox' | 'production'
  refresh_expires_at: string
  updated_at: string
}

export const money = (n: number, currency?: string | null) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n)

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}
