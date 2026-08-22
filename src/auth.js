import { supabase } from './supabase'

export async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut()
}

export async function getCurrentProfile() {
  if (!supabase) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('pos_profiles').select('*').eq('id', user.id).single()
  if (error) throw error
  if (data.paused) {
    await supabase.auth.signOut()
    throw new Error('Account suspended. Contact your Admin.')
  }
  return { ...data, email: user.email }
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
