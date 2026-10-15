import { supabase } from './supabase'

const USERNAME_DOMAIN = 'users.chillpipe.co.za'
const CACHED_PROFILE_KEY = 'chill-pipe:last-profile'

export function normalizeUsername(value) {
  return value.trim().toLowerCase()
}

function authIdentifier(value) {
  const identifier = normalizeUsername(value)
  return identifier.includes('@') ? identifier : `${identifier}@${USERNAME_DOMAIN}`
}

export async function signIn(identifier, password) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.signInWithPassword({ email: authIdentifier(identifier), password })
  if (error) throw error
}

export async function signOut() {
  localStorage.removeItem(CACHED_PROFILE_KEY)
  if (supabase) await supabase.auth.signOut()
}

export async function signOutEverywhere() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut({ scope: 'global' })
  if (error) throw error
  localStorage.removeItem(CACHED_PROFILE_KEY)
}

export async function changeOwnPassword(currentPassword, newPassword) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.updateUser({ password: newPassword, currentPassword })
  if (error) throw error
}

export async function getCurrentProfile() {
  if (!supabase) return null
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError && authError.name !== 'AuthSessionMissingError') throw authError
    if (!user) {
      if (!navigator.onLine) {
        const cached = localStorage.getItem(CACHED_PROFILE_KEY)
        return cached ? JSON.parse(cached) : null
      }
      return null
    }
    const { data, error } = await supabase.from('pos_profiles').select('*').eq('id', user.id).single()
    if (error) throw error
    if (data.paused) {
      await supabase.auth.signOut()
      localStorage.removeItem(CACHED_PROFILE_KEY)
      throw new Error('Account suspended. Contact your Admin.')
    }
    const profile = { ...data, email: user.email }
    localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile))
    return profile
  } catch (error) {
    if (navigator.onLine) throw error
    const cached = localStorage.getItem(CACHED_PROFILE_KEY)
    return cached ? JSON.parse(cached) : null
  }
}

export function onAuthChange(callback) {
  if (!supabase) return { unsubscribe() {} }
  const { data } = supabase.auth.onAuthStateChange(() => setTimeout(callback, 0))
  return data.subscription
}

export async function manageStaff(action, payload) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke('manage-pos-user', {
    body: { action, ...payload },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}
