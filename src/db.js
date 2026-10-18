import { cacheSellingData } from './sellingCache.js';
import { salePayload } from './salePersistence.js'
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

export async function updateStaffAccess(id, changes) {
  if (!ok()) throw new Error('Connect before updating access.');
  const {data,error} = await supabase.from('pos_profiles').update(changes).eq('id',id).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Access was not saved. Refresh and try again.');
}

// ── Stock ─────────────────────────────────────────────
export async function fetchStock() {
  if (!ok()) return null
  const { data, error } = await supabase.from('pos_stock').select('*')
  if (error) { console.error('fetchStock', error); return null }
  const stock = data.map(r => ({
    id: r.id, name: r.name, category: r.category,
    quantity: r.quantity, unit: r.unit, lowThreshold: r.low_threshold,
    ...(r.sub_items ? { subItems: r.sub_items } : {}),
  }))
  cacheSellingData({stock,stockAt:new Date().toISOString()})
  return stock
}

export async function updateStockItem(item) {
  if (!ok()) return false
  const { data, error } = await supabase.from('pos_stock').update({
    name: item.name, quantity: item.quantity, low_threshold: item.lowThreshold,
  }).eq('id', item.id).select('id').maybeSingle()
  if (error) { console.error('updateStockItem', error); return false }
  return !!data
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
  try {
    const { data, error } = await supabase.rpc('record_pos_sale', {order_payload:salePayload(order)})
    if (error) { console.error('insertOrder', error); return false }
    return data === true
  } catch { return false }
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
export async function fetchOrdersByDateRange(from, to, allPages = true) {
  if (!ok()) return null
  const data = []
  let offset = 0
  do {
    const { data: page, error } = await supabase
      .from('pos_orders').select('*').gte('time', from).lte('time', to)
      .order('time', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + 499)
    if (error) { console.error('fetchOrdersByDateRange', error); return null }
    data.push(...page)
    if (!allPages || page.length < 500) break
    offset += page.length
  } while (allPages)
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
  const data = []
  for (let offset = 0; ; offset += 500) {
    const { data: page, error } = await supabase.from('pos_expenses').select('*')
      .order('time', { ascending: true }).order('id', { ascending: true }).range(offset, offset + 499)
    if (error) { console.error('fetchExpenses', error); return null }
    data.push(...page)
    if (page.length < 500) break
  }
  const {data:people,error:peopleError} = await supabase.rpc('get_pos_expense_people');
  if (peopleError) console.error('fetchExpensePeople',peopleError);
  const names = new Map((people ?? []).map(person=>[person.id,person.name]));
  return data.map(r => ({
    paidByName:names.get(r.paid_by), submittedByName:names.get(r.submitted_by), approvedByName:names.get(r.approved_by), paymentByName:names.get(r.payment_by),
    id: r.id, category: r.category, qty: r.qty,
    amount: Number(r.amount), time: r.time, shiftId: r.shift_id ?? null,
    description: r.description ?? '', paidBy: r.paid_by ?? null,
    status: r.approval_status, submittedBy: r.submitted_by, approvedAt: r.approved_at, approvedBy: r.approved_by, paidAt: r.payment_at, paymentBy: r.payment_by,
    receiptPath: r.receipt_path ?? null, reimbursedAt: r.reimbursed_at ?? null, stockQuantities: r.stock_quantities ?? {},
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

// Expense writes target one record; never synchronise or delete the entire list.
export async function saveExpenseRecord(expense, original = null) {
  if (!ok()) throw new Error('Connect before saving an expense.')
  const row = { category: expense.category, amount: expense.amount, time: expense.time,
    description: expense.description || null, paid_by: expense.paidBy || null, stock_quantities: expense.stockQuantities ?? {}, receipt_path: expense.receiptPath ?? null }
  let query
  if (original) {
    query = supabase.from('pos_expenses').update(row).eq('id', original.id).eq('time', original.time).eq('amount', original.amount).eq('stock_quantities', JSON.stringify(original.stockQuantities ?? {}))
  } else {
    query = supabase.from('pos_expenses').insert({ ...row, id: expense.id, qty: expense.qty ?? null, shift_id: expense.shiftId ?? null })
  }
  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Expense changed or access was denied. Refresh and try again.')
}

export async function deleteExpenseRecord(expense) {
  if (!ok()) throw new Error('Connect before deleting an expense.')
  const { data, error } = await supabase.from('pos_expenses').delete()
    .eq('id', expense.id).eq('time', expense.time).eq('amount', expense.amount).eq('stock_quantities', JSON.stringify(expense.stockQuantities ?? {})).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Expense changed or access was denied. Refresh and try again.')
}

export async function transitionExpense(expense, status) {
  if (!ok()) throw new Error('Connect before updating an expense.');
  let query = supabase.from('pos_expenses').update({approval_status: status})
    .eq('id', expense.id).eq('approval_status', expense.status).eq('amount', expense.amount)
    .eq('time', expense.time).eq('category', expense.category)
    .eq('stock_quantities', JSON.stringify(expense.stockQuantities ?? {}));
  query = expense.paidBy ? query.eq('paid_by', expense.paidBy) : query.is('paid_by', null);
  query = expense.description ? query.eq('description', expense.description) : query.or('description.is.null,description.eq.');
  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Expense changed. Refresh and try again.');
}
