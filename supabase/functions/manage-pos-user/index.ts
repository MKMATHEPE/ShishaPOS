import { createClient } from 'npm:@supabase/supabase-js@2.106.1'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user }, error: userError } = await caller.auth.getUser()
    if (userError || !user) throw new Error('Authentication required.')
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: profile } = await admin.from('pos_profiles').select('role, paused').eq('id', user.id).single()
    if (!profile || profile.role !== 'Admin' || profile.paused) throw new Error('Admin access required.')

    const body = await req.json()
    if (body.action === 'create') {
      if (!body.username || !body.password || !body.name) throw new Error('Name, username and password are required.')
      if (String(body.password).length < 10) throw new Error('Password must be at least 10 characters.')
      const username = String(body.username).trim().toLowerCase()
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Username must be 3–32 letters, numbers, dots, dashes or underscores.')
      const email = `${username}@users.chillpipe.co.za`
      const { data: existing } = await admin.from('pos_profiles').select('id').ilike('username', username).maybeSingle()
      if (existing) throw new Error('That username is already in use.')
      const { data, error } = await admin.auth.admin.createUser({
        email, password: body.password, email_confirm: true,
      })
      if (error) throw error
      const permissions = body.role === 'Admin'
        ? { delivered: true, stock: true, management: true, settings: true }
        : body.role === 'Manager'
          ? { delivered: true, stock: true, management: true, settings: false }
          : { delivered: true, stock: false, management: false, settings: false }
      const { error: profileError } = await admin.from('pos_profiles').insert({
        id: data.user.id, email: data.user.email, username, name: body.name, role: body.role ?? 'Staff', permissions,
      })
      if (profileError) { await admin.auth.admin.deleteUser(data.user.id); throw profileError }
    } else if (body.action === 'password') {
      if (!body.userId || String(body.password).length < 10) throw new Error('A password of at least 10 characters is required.')
      const { error } = await admin.auth.admin.updateUserById(body.userId, { password: body.password })
      if (error) throw error
    } else if (body.action === 'delete') {
      if (!body.userId || body.userId === user.id) throw new Error('You cannot delete your own account.')
      const { error } = await admin.auth.admin.deleteUser(body.userId)
      if (error) throw error
    } else throw new Error('Unsupported action.')
    return new Response(JSON.stringify({ ok: true }), { headers })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed.' }), { status: 400, headers })
  }
})
