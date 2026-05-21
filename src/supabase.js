import { createClient } from '@supabase/supabase-js'

// Replace these with your actual values from supabase.com → Project Settings → API
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

const isConfigured = SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null
