import { supabase } from './supabase'

const ok = () => !!supabase

function localDateStr() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
}

// ── Users ─────────────────────────────────────────────
export async function fetchUsers() {
  if (!ok()) return null
  const { data, error } = await supabase.from('pos_profiles').select('*').order('name')
  if (error) { console.error('fetchUsers', error); return null }
  return data
}

export async function syncUsers(users) {
  if (!ok()) return
  const results = await Promise.all(users.map(({ id, name, role, permissions, paused }) =>
    supabase.from('pos_profiles').update({ name, role, permissions, paused }).eq('id', id)
  ))
  const failed = results.find(({ error }) => error)
  if (failed) console.error('syncUsers', failed.error)
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
  const consumables = stock.filter(i => i.category !== 'equipment')
  if (consumables.length) {
    const rows = consumables.map(i => ({
      id: i.id, name: i.name, category: i.category,
      quantity: i.quantity, unit: i.unit, low_threshold: i.lowThreshold,
      sub_items: i.subItems ?? null,
    }))
    const { error } = await supabase.from('pos_stock').upsert(rows, { onConflict: 'id' })
    if (error) { console.error('syncStock', error); return }
  }
}

export async function updateStockItem(item) {
  if (!ok()) return false
  const { error } = await supabase.from('pos_stock').update({
    name: item.name, quantity: item.quantity, low_threshold: item.lowThreshold,
  }).eq('id', item.id)
  if (error) { console.error('updateStockItem', error); return false }
  return true
}

// ── Orders ────────────────────────────────────────────
export async function fetchOrders(shiftId = null) {
  if (!ok()) return null
  const today = localDateStr()
  let query = supabase
    .from('pos_orders')
    .select('*')
    .order('time', { ascending: true })
  query = shiftId ? query.eq('shift_id', shiftId) : query.eq('session_date', today)
  const { data, error } = await query
  if (error) { console.error('fetchOrders', error); return null }
  return data.map(r => ({
    id: r.id, flavour: r.flavour, type: r.type,
    payment: r.payment, price: r.price, status: r.status,
    time: new Date(r.time),
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
    soldBy: r.sold_by ?? null,
    shiftId: r.shift_id ?? null,
    pipeReturned: r.pipe_returned ?? false,
  }))
}

export async function fetchUnfinishedOrders() {
  if (!ok()) return null
  const { data, error } = await supabase
    .from('pos_orders')
    .select('*')
    .neq('status', 'delivered')
    .order('time', { ascending: true })
  if (error) { console.error('fetchUnfinishedOrders', error); return null }
  return data.map(r => ({
    id: r.id, flavour: r.flavour, type: r.type,
    payment: r.payment, price: r.price, status: r.status,
    time: new Date(r.time),
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
    soldBy: r.sold_by ?? null,
    shiftId: r.shift_id ?? null,
    pipeReturned: r.pipe_returned ?? false,
  }))
}

export async function fetchUnreturnedPipes() {
  if (!ok()) return null
  const today = localDateStr()
  const { data, error } = await supabase
    .from('pos_orders')
    .select('*')
    .eq('type', 'full')
    .eq('status', 'delivered')
    .eq('pipe_returned', false)
    .neq('session_date', today)
    .order('time', { ascending: true })
  if (error) { console.error('fetchUnreturnedPipes', error); return null }
  return data.map(r => ({
    id: r.id, flavour: r.flavour, type: r.type,
    payment: r.payment, price: r.price, status: r.status,
    time: new Date(r.time),
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
    soldBy: r.sold_by ?? null,
    pipeReturned: false,
    sessionDate: r.session_date,
    shiftId: r.shift_id ?? null,
  }))
}

export async function insertOrder(order) {
  if (!ok()) return
  const today = localDateStr()
  const { error } = await supabase.from('pos_orders').insert({
    id: order.id, flavour: typeof order.flavour === 'object' ? order.flavour?.name : order.flavour, type: order.type,
    payment: order.payment, price: order.price, status: order.status,
    time: order.time.toISOString(), session_date: today,
    sold_by: order.soldBy ?? null,
    shift_id: order.shiftId ?? null,
  })
  if (error) console.error('insertOrder', error)
}

export async function markOrderDelivered(id) {
  if (!ok()) return false
  const { data, error } = await supabase.rpc('mark_pos_order_delivered', { order_id: id })
  if (error) { console.error('markOrderDelivered', error); return false }
  return data === true
}

export async function returnOrderPipe(id) {
  if (!ok()) return false
  const { data, error } = await supabase.rpc('return_pos_order_pipe', { order_id: id })
  if (error) { console.error('returnOrderPipe', error); return false }
  return data === true
}

export async function deleteOrder(id) {
  if (!ok()) return false
  const { data, error } = await supabase.rpc('delete_pos_order', { order_id: id })
  if (error) { console.error('deleteOrder', error); return false }
  return data === true
}

// ── Orders by date range (for management date filter) ─
export async function fetchOrdersByDateRange(from, to) {
  if (!ok()) return null
  const { data, error } = await supabase
    .from('pos_orders')
    .select('*')
    .gte('time', from)
    .lte('time', to)
    .order('time', { ascending: true })
  if (error) { console.error('fetchOrdersByDateRange', error); return null }
  return data.map(r => ({
    id: r.id, flavour: r.flavour, type: r.type,
    payment: r.payment, price: r.price, status: r.status,
    time: new Date(r.time),
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
    soldBy: r.sold_by ?? null,
    shiftId: r.shift_id ?? null,
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
    amount: r.amount, time: r.time, shiftId: r.shift_id ?? null,
  }))
}

export async function syncExpenses(expenses) {
  if (!ok()) return
  if (expenses.length) {
    const rows = expenses.map(e => ({
      id: e.id, category: e.category, qty: e.qty ?? null,
      amount: e.amount, time: e.time, shift_id: e.shiftId ?? null,
    }))
    const { error } = await supabase.from('pos_expenses').upsert(rows, { onConflict: 'id' })
    if (error) { console.error('syncExpenses', error); return }
    const { error: delError } = await supabase.from('pos_expenses').delete().not('id', 'in', `(${expenses.map(e => e.id).join(',')})`)
    if (delError) console.error('syncExpenses delete', delError)
  } else {
    await supabase.from('pos_expenses').delete().neq('id', 0)
  }
}
