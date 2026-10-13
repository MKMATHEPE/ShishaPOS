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
  if (!ok()) return false
  const orderTime = order.time instanceof Date ? order.time : new Date(order.time)
  const sessionDate = order.sessionDate ?? [orderTime.getFullYear(), String(orderTime.getMonth()+1).padStart(2,"0"), String(orderTime.getDate()).padStart(2,"0")].join("-")
  const { error } = await supabase.from('pos_orders').insert({
    id: order.id, flavour: typeof order.flavour === 'object' ? order.flavour?.name : order.flavour, type: order.type,
    payment: order.payment, price: order.price, status: order.status,
    time: orderTime.toISOString(), session_date: sessionDate,
    sold_by: order.soldBy ?? null,
    shift_id: order.shiftId ?? null,
  })
  if (error && error.code !== '23505') { console.error('insertOrder', error); return false }
  return true
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
    amount: Number(r.amount), time: r.time, shiftId: r.shift_id ?? null,
    description: r.description ?? '', paidBy: r.paid_by ?? null,
    reimbursedAt: r.reimbursed_at ?? null,
  }))
}

export async function syncExpenses(expenses) {
  if (!ok()) return
  if (expenses.length) {
    const rows = expenses.map(e => ({
      id: e.id, category: e.category, qty: e.qty ?? null,
      amount: e.amount, time: e.time, shift_id: e.shiftId ?? null,
      description: e.description || null, paid_by: e.paidBy || null,
      reimbursed_at: e.reimbursedAt || null,
    }))
    let { error } = await supabase.from('pos_expenses').upsert(rows, { onConflict: 'id' })
    // Keep the existing app usable while the finance migration is being applied.
    if (error && ['PGRST204', '42703'].includes(error.code)) {
      const legacyRows = rows.map(row => ({ id: row.id, category: row.category, qty: row.qty, amount: row.amount, time: row.time, shift_id: row.shift_id }))
      ;({ error } = await supabase.from('pos_expenses').upsert(legacyRows, { onConflict: 'id' }))
    }
    if (error) { console.error('syncExpenses', error); return }
    const { error: delError } = await supabase.from('pos_expenses').delete().not('id', 'in', `(${expenses.map(e => e.id).join(',')})`)
    if (delError) console.error('syncExpenses delete', delError)
  } else {
    await supabase.from('pos_expenses').delete().neq('id', 0)
  }
}

// ── Finance journal ───────────────────────────────────
export async function fetchFinanceJournal() {
  if (!ok()) return null
  const [partners, transactions, settings, manualSales] = await Promise.all([
    supabase.from('pos_finance_partners').select('*'),
    supabase.from('pos_finance_transactions').select('*').order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('pos_finance_settings').select('*').eq('id', true).maybeSingle(),
    supabase.from('pos_manual_sales').select('*').order('sale_date', { ascending: false }).order('created_at', { ascending: false }),
  ])
  const failed = partners.error || transactions.error || settings.error || manualSales.error
  if (failed) {
    if (!['PGRST205', '42P01'].includes(failed.code)) console.error('fetchFinanceJournal', failed)
    return null
  }
  return {
    partners: partners.data.map(row => ({ profileId: row.profile_id, profitShare: Number(row.profit_share) })),
    transactions: transactions.data.map(row => ({ id: row.id, kind: row.kind, profileId: row.profile_id, amount: Number(row.amount), description: row.description ?? '', date: row.transaction_date, createdAt: row.created_at })),
    manualSales: manualSales.data.map(row => ({ id: row.id, date: row.sale_date, amount: Number(row.amount), payment: row.payment, description: row.description, reason: row.reason, createdAt: row.created_at })),
    lockedThrough: settings.data?.locked_through ?? null,
  }
}

export async function addManualSale(sale) {
  if (!ok()) return null
  const { data, error } = await supabase.from('pos_manual_sales').insert({ sale_date: sale.date, amount: sale.amount, payment: sale.payment, description: sale.description, reason: sale.reason }).select().single()
  if (error) { console.error('addManualSale', error); return null }
  return { id: data.id, date: data.sale_date, amount: Number(data.amount), payment: data.payment, description: data.description, reason: data.reason, createdAt: data.created_at }
}

export async function saveFinancePartners(partners) {
  if (!ok()) return false
  const { error: clearError } = await supabase.from('pos_finance_partners').delete().not('profile_id', 'is', null)
  if (clearError) { console.error('saveFinancePartners clear', clearError); return false }
  if (!partners.length) return true
  const { error } = await supabase.from('pos_finance_partners').insert(partners.map(p => ({ profile_id: p.profileId, profit_share: p.profitShare })))
  if (error) { console.error('saveFinancePartners', error); return false }
  return true
}

export async function addFinanceTransaction(transaction) {
  if (!ok()) return null
  const { data, error } = await supabase.from('pos_finance_transactions').insert({
    kind: transaction.kind, profile_id: transaction.profileId, amount: transaction.amount,
    description: transaction.description || null, transaction_date: transaction.date,
  }).select().single()
  if (error) { console.error('addFinanceTransaction', error); return null }
  return { id: data.id, kind: data.kind, profileId: data.profile_id, amount: Number(data.amount), description: data.description ?? '', date: data.transaction_date, createdAt: data.created_at }
}

export async function setFinanceLock(lockedThrough) {
  if (!ok()) return false
  const { error } = await supabase.from('pos_finance_settings').upsert({ id: true, locked_through: lockedThrough || null, updated_by: (await supabase.auth.getUser()).data.user?.id, updated_at: new Date().toISOString() })
  if (error) { console.error('setFinanceLock', error); return false }
  return true
}

export async function cancelOrder(id) {
  if (!ok()) return false
  const { data, error } = await supabase.rpc('cancel_pos_order', { order_id: id })
  if (error) { console.error('cancelOrder', error); return false }
  return data === true
}
