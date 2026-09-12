import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env')
}

// Capture the kind of auth link that opened this page (invite, recovery) before
// supabase-js consumes and strips it from the URL.
function readLinkType(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  return hash.get('type') ?? query.get('type')
}
export const authLinkType = readLinkType()

export const supabase = createClient(url, key)
