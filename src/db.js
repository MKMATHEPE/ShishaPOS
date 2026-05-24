import { supabase } from './supabase'

const ok = () => !!supabase

// ── Users ─────────────────────────────────────────────
export async function fetchUsers() {
  if (!ok()) return null
  const { data, error } = await supabase.from('pos_users').select('*')
  if (error) { console.error('fetchUsers', error); return null }
  return data.map(r => ({
    id: r.id, name: r.name, role: r.role, pin: r.pin,
    permissions: r.permissions ?? {},
  }))
}

export async function syncUsers(users) {
  if (!ok()) return
  if (users.length) {
    const rows = users.map(u => ({
      id: u.id, name: u.name, role: u.role, pin: u.pin,
      permissions: u.permissions,
    }))
    const { error } = await supabase.from('pos_users').upsert(rows, { onConflict: 'id' })
    if (error) { console.error('syncUsers', error); return }
    const { error: delError } = await supabase.from('pos_users').delete().not('id', 'in', `(${users.map(u => u.id).join(',')})`)
    if (delError) console.error('syncUsers delete', delError)
  } else {
    await supabase.from('pos_users').delete().neq('id', 0)
  }
}

// ── Stock ─────────────────────────────────────────────
export async function fetchStock() {
  if (!ok()) return null
  const { data, error } = await supabase.from('pos_stock').select('*')
  if (error) { console.error('fetchStock', error); return null }
  return data.map(r => ({
    id: r.id, name: r.name, category: r.category,
    quantity: r.quantity, unit: r.unit, lowThreshold: r.low_threshold,
    ...(r.sub_items ? { subItems: r.sub_items } : {}),
  }))
}

export async function syncStock(stock) {
  if (!ok()) return
  if (stock.length) {
    const rows = stock.map(i => ({
      id: i.id, name: i.name, category: i.category,
      quantity: i.quantity, unit: i.unit, low_threshold: i.lowThreshold,
      sub_items: i.subItems ?? null,
    }))
    const { error } = await supabase.from('pos_stock').upsert(rows, { onConflict: 'id' })
    if (error) { console.error('syncStock', error); return }
    const { error: delError } = await supabase.from('pos_stock').delete().not('id', 'in', `(${stock.map(i => i.id).join(',')})`)
    if (delError) console.error('syncStock delete', delError)
  } else {
    await supabase.from('pos_stock').delete().neq('id', 0)
  }
}

// ── Orders ────────────────────────────────────────────
export async function fetchOrders() {
  if (!ok()) return null
  // Load today's orders only
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('pos_orders')
    .select('*')
    .eq('session_date', today)
    .order('time', { ascending: true })
  if (error) { console.error('fetchOrders', error); return null }
  return data.map(r => ({
    id: r.id, flavour: r.flavour, type: r.type,
    payment: r.payment, price: r.price, status: r.status,
    time: new Date(r.time),
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
    soldBy: r.sold_by ?? null,
    pipeReturned: r.pipe_returned ?? false,
  }))
}

export async function insertOrder(order) {
  if (!ok()) return
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await supabase.from('pos_orders').insert({
    id: order.id, flavour: order.flavour, type: order.type,
    payment: order.payment, price: order.price, status: order.status,
    time: order.time.toISOString(), session_date: today,
    sold_by: order.soldBy ?? null,
  })
  if (error) console.error('insertOrder', error)
}

export async function updateOrder(id, updates) {
  if (!ok()) return
  const row = {}
  if (updates.status) row.status = updates.status
  if (updates.deliveredAt) row.delivered_at = updates.deliveredAt.toISOString()
  if (updates.pipeReturned !== undefined) row.pipe_returned = updates.pipeReturned
  const { error } = await supabase.from('pos_orders').update(row).eq('id', id)
  if (error) console.error('updateOrder', error)
}

export async function deleteOrder(id) {
  if (!ok()) return
  const { error } = await supabase.from('pos_orders').delete().eq('id', id)
  if (error) console.error('deleteOrder', error)
}

// ── Orders by date range (for management date filter) ─
export async function fetchOrdersByDateRange(from, to) {
  if (!ok()) return null
  const { data, error } = await supabase
    .from('pos_orders')
    .select('*')
    .gte('session_date', from)
    .lte('session_date', to)
    .order('time', { ascending: true })
  if (error) { console.error('fetchOrdersByDateRange', error); return null }
  return data.map(r => ({
    id: r.id, flavour: r.flavour, type: r.type,
    payment: r.payment, price: r.price, status: r.status,
    time: new Date(r.time),
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
    soldBy: r.sold_by ?? null,
    pipeReturned: r.pipe_returned ?? false,
  }))
}

// ── Session dates list ─────────────────────────────────
export async function fetchSessionDates() {
  if (!ok()) return null
  const { data, error } = await supabase
    .from('pos_orders')
    .select('session_date')
    .order('session_date', { ascending: false })
  if (error) { console.error('fetchSessionDates', error); return null }
  return [...new Set(data.map(r => r.session_date))]
}

// ── Historical revenue (past sessions avg) ────────────
export async function fetchHistoricalRevenue() {
  if (!ok()) return null
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('pos_orders')
    .select('session_date, price')
    .neq('session_date', today)
  if (error) { console.error('fetchHistoricalRevenue', error); return null }
  if (!data.length) return null
  // Group by session_date and sum price per day
  const byDay = {}
  data.forEach(r => {
    byDay[r.session_date] = (byDay[r.session_date] ?? 0) + Number(r.price)
  })
  const dailyTotals = Object.values(byDay)
  return dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length
}

// ── Expenses ──────────────────────────────────────────
export async function fetchExpenses() {
  if (!ok()) return null
  const { data, error } = await supabase.from('pos_expenses').select('*').order('time', { ascending: true })
  if (error) { console.error('fetchExpenses', error); return null }
  return data.map(r => ({
    id: r.id, category: r.category, qty: r.qty,
    amount: r.amount, time: r.time,
  }))
}

export async function syncExpenses(expenses) {
  if (!ok()) return
  if (expenses.length) {
    const rows = expenses.map(e => ({
      id: e.id, category: e.category, qty: e.qty ?? null,
      amount: e.amount, time: e.time,
    }))
    const { error } = await supabase.from('pos_expenses').upsert(rows, { onConflict: 'id' })
    if (error) { console.error('syncExpenses', error); return }
    const { error: delError } = await supabase.from('pos_expenses').delete().not('id', 'in', `(${expenses.map(e => e.id).join(',')})`)
    if (delError) console.error('syncExpenses delete', delError)
  } else {
    await supabase.from('pos_expenses').delete().neq('id', 0)
  }
}
