import PriceSettings from './PriceSettings.jsx';
import ProfitPartnerSettings from './ProfitPartnerSettings.jsx';
import { partnerProfitSplit } from './partnerProfitSplit.js';
import { outstandingExpenses } from './expenseOutstanding.js';
import Pagination from './Pagination.jsx';
import { orderPage } from './orderPagination.js';
import ReceiptPicker from './ReceiptPicker.jsx';
import { uploadReceipt } from './expenseReceipts.js';
import { formHasChanges } from './formDirty.js';
import { blocksSignOut } from './offlineQueueStatus.js';
import { readSellingCache, cacheSellingData } from './sellingCache.js';
import { estimatedStock } from './offlineStock.js';
import { presetRange, presetIsActive } from "./managementPresets.js";
import { useState, useCallback, useRef, useEffect } from "react";
import { stockLines } from "./stockTakingModel";
import StockItemPhoto from "./StockItemPhoto.jsx";
import PullToRefresh from "./PullToRefresh.jsx";
import { saveEquipmentChange } from "./equipmentSave.js";
import { useUnsavedChanges, confirmDiscard } from "./unsavedChanges";
import { recordDiagnostic, setDiagnosticScreen, downloadDiagnostics } from "./monitoring";
import ManagementOverview from "./ManagementOverview.jsx";
import ExpensesList from "./ExpensesList.jsx";
import StockTaking from "./StockTaking.jsx";
import { planWeekend } from "./purchasePlanner";
import { supabase } from "./supabase";
import { changeOwnPassword, getCurrentProfile, manageStaff, onAuthChange, signIn, signOut, signOutEverywhere } from "./auth";
import {
  fetchUsers, updateStaffAccess, fetchPrices, savePrices,
  fetchStock, updateStockItem,
  fetchOrders, fetchUnfinishedOrders, fetchUnreturnedPipes, insertOrder, markOrderDelivered, returnOrderPipe, deleteOrder, cancelOrder,
  fetchExpenses, saveExpenseRecord, deleteExpenseRecord, transitionExpense,
  fetchFinanceJournal, saveFinancePartners, addFinanceTransaction, addManualSale, setFinanceLock,
  fetchOrdersByDateRange, fetchSessionDates,
} from "./db";
import { persistSale, syncPendingSales, syncRetryDelay } from "./salePersistence.js";
import { getOfflineOrders, queueOfflineOrder, removeOfflineOrder } from "./offlineOrders";

const FLAVOURS = [
  { id: "lk", name: "Lady Killer", short: "LK", icon: "🌹", bg: "#fff1f2", color: "#be123c", border: "#fecdd3" },
  { id: "mc", name: "Mint Cream", short: "MC", icon: "🍃", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  { id: "bn", name: "Berlin Nights", short: "BN", icon: "🌙", bg: "#f6f4ef", color: "#4a4843", border: "#d8d4cb" },
  { id: "gm", name: "Gum & Mint", short: "GM", icon: "🫧", bg: "#f0fdfa", color: "#0f766e", border: "#99f6e4" },
  { id: "jk", name: "Joker", short: "JK", icon: "🃏", bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  { id: "hh", name: "Honey Hunter", short: "HH", icon: "🍯", bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
];

const FLAVOUR_PHOTOS = {
  lk: "/brand/lady-killer.webp", mc: "/brand/cream-mint.webp",
  bn: "/brand/berlin-nights.jpg", gm: "/brand/gum-mint.webp",
  jk: "/brand/joker.jpg", hh: "/brand/honey-hunter.jpg",
};

function FlavourThumbnail({ flavour, compact = false }) {
  const name = typeof flavour === "string" ? flavour : flavour?.name;
  const match = FLAVOURS.find(item => item.id === flavour?.id || item.name === name);
  if (!match) return <span aria-hidden="true">{flavour?.icon ?? "🌿"}</span>;
  return <img className={`flavour-thumbnail${compact ? " flavour-thumbnail--compact" : ""}`} src={FLAVOUR_PHOTOS[match.id]} alt="" loading="eager" decoding="async" />;
}

function normalizeFlavour(f) {
  if (f && typeof f === 'object') return f;
  return FLAVOURS.find(fl => fl.name === f) ?? { id: 'unknown', name: f ?? 'Unknown', short: '?', icon: '🌿', bg: '#f6f4ef', color: '#6c6a65', border: '#d8d4cb' };
}

const DEFAULT_PRICES = { full: 170, refill: 120 };

// Stock auto-deduction per sale
const COAL_PER_SALE = 2;         // pieces
const MOUTHPIECES_PER_SALE = 2;  // pieces
// Boxes of flavour used per sale (1 carton = 10 boxes)
const FLAVOUR_PER_SALE = {
  lk: 1 / 3.5,  // Lady Killer   — 1/3.5 box
  bn: 1 / 3.5,  // Berlin Nights — 1/3.5 box
  jk: 1 / 3.5,  // Joker         — 1/3.5 box
  hh: 1 / 3.5,  // Honey Hunter  — 1/3.5 box
  mc: 1 / 4,    // Mint Cream    — 1/4 box
  gm: 1 / 4,    // Gum & Mint    — 1/4 box
};

// How many pieces are in each restock unit
const RESTOCK_PACK = {
  "Coal":         { size: 72, unit: "box",  plural: "boxes" },
  "Mouth Pieces": { size: 50, unit: "pack", plural: "packs" },
};

const LOGO_SRC = "/chill-pipe-logo.webp";
// Cancellation is enforced by the database, including delivery and retry checks.
const CANCELLATION_ENABLED = true;

function formatTime(date) {
  return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function localToday() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
}

function createOrderId() {
  const randomPart = crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
  return Date.now() * 1000 + randomPart;
}

function formatSessionDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" });
}

function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
}

function formatCurrency(n) {
  return `R${n.toLocaleString()}`;
}

function SettingsIcon({name}) {
  const paths={team:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3zM16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/></>,pricing:<><path d="M3 12 12 3h8v8l-9 10z"/><circle cx="16" cy="7" r="1"/></>,security:<path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z"/>,business:<><path d="M3 9h18l-2-6H5zM4 9v12h16V9M9 21v-7h6v7"/><path d="M3 9c0 4 4 4 4 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 4 4 4 0"/></>};
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function TabIcon({ name, active }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: active ? "#0a0a0a" : "#8c8982",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (name === "pos") return <svg {...common}><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /><path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H7" /></svg>;
  if (name === "orders") return <svg {...common}><path d="M9 5h6" /><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z" /><path d="M6 5h12a2 2 0 0 1 2 2v13H4V7a2 2 0 0 1 2-2Z" /><path d="M8 11h8M8 15h5" /></svg>;
  if (name === "stock") return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.4 7.7 7.6 4.4 7.6-4.4M12 12.1V21" /></svg>;
  return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 21v-2.2a6.5 6.5 0 0 1 13 0V21M4 21h16" /></svg>;
}

function FinancePanel({ users, stock, expenses, allExpenses, onExpenseStatus, revenue, journal, periodLabel, dateFrom, dateTo, isAdmin, currentUserId, canViewReceipts, onExpense, onExpenseUpdate, onExpenseDelete, onManualSale, onTransaction }) {
  const [entry, setEntry] = useState({ kind: "reimbursement", profileId: "", amount: "", description: "", date: localToday() });
  const [spend, setSpend] = useState({ category: "Transport", description: "", paidBy: "", amount: "", date: localToday(), stockKey: "", stockQuantity: "" });
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [receipt,setReceipt] = useState(null);
  const [sale, setSale] = useState({ payment: "cash", description: "", reason: "", amount: "", date: localToday() });
  const [activeAction, updateActiveAction] = useState(null);
  const [formBaselines,setFormBaselines] = useState({expense:spend,manual_sale:sale,partner_payout:entry});
  const setActiveAction = action => {
    if (action && action !== activeAction) setFormBaselines({expense:spend,manual_sale:sale,partner_payout:entry});
    updateActiveAction(action);
  };
  const activeDraft = activeAction === 'expense' ? spend : activeAction === 'manual_sale' ? sale : entry;
  useUnsavedChanges(!!formBaselines[activeAction] && (formHasChanges(activeDraft,formBaselines[activeAction]) || (activeAction === 'expense' && !!receipt)));
  const [message, setMessage] = useState("");
  const partners = journal.partners ?? [];
  const transactions = (journal.transactions ?? []).filter(item => item.date >= dateFrom && item.date <= dateTo);
  const manualSales = (journal.manualSales ?? []).filter(item => item.date >= dateFrom && item.date <= dateTo);
  const manualRevenue = manualSales.reduce((sum, item) => sum + item.amount, 0);
  const totalRevenue = revenue + manualRevenue;
  const expenseTotal = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const profit = totalRevenue - expenseTotal;
  const reimbursements = transactions.filter(item => item.kind === "reimbursement");
  const payouts = transactions.filter(item => item.kind === "partner_payout");
  const profitSplit = partnerProfitSplit(profit,partners,payouts);
  const personName = id => users.find(user => user.id === id)?.name ?? (allExpenses ?? expenses).find(expense=>expense.paidBy===id && expense.paidByName)?.paidByName ?? "Name unavailable";
  const rows = users.map(user => {
    const spent = expenses.filter(item => item.paidBy === user.id && !(item.status === 'paid' && !item.paidAt)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const refunded = reimbursements.filter(item => item.profileId === user.id).reduce((sum, item) => sum + item.amount, 0);
    const partner = partners.find(item => item.profileId === user.id);
    const share = partner ? profitSplit.rows.find(item=>item.profileId===user.id)?.share ?? 0 : 0;
    const paid = payouts.filter(item => item.profileId === user.id).reduce((sum, item) => sum + item.amount, 0);
    return { user, spent, refunded, reimbursementDue: Math.max(0, spent - refunded), share, paid, profitDue: Math.max(0, share - paid) };
  }).filter(row => row.spent || row.refunded || row.share || row.paid || partners.some(item => item.profileId === row.user.id));
  const paymentRow = rows.find(row => row.user.id === entry.profileId);
  const unpaidExpenses = (allExpenses ?? expenses).filter(expense => expense.paidBy === entry.profileId && expense.status !== 'paid');
  const paymentPeople = entry.kind === 'partner_payout' ? users.filter(user => partners.some(partner => partner.profileId === user.id)) : users.filter(user => (allExpenses ?? expenses).some(expense => expense.paidBy === user.id && expense.status !== 'paid'));
  const paymentMoney = value => `R${Number(value || 0).toLocaleString('en-ZA', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  const outstanding = outstandingExpenses(allExpenses ?? expenses);
  const totalDue = outstanding.amount;
  const locked = journal.lockedThrough && entry.date <= journal.lockedThrough;

  const submit = async () => {
    if (!entry.profileId || Number(entry.amount) <= 0) return setMessage("Choose a person and enter an amount.");
    if (locked) return setMessage(`This date is locked through ${journal.lockedThrough}.`);
    const ok = await onTransaction({ ...entry, amount: Number(entry.amount) });
    setMessage(ok ? "Payment recorded." : "Could not record the payment.");
    if (ok) setEntry(current => ({ ...current, amount: "", description: "" }));
  };
  const purchaseItems = stockLines(stock);
  const isStockExpense = ['Flavour','Coal','Mouth Pieces'].includes(spend.category);
  const purchasedItem = spend.category === 'Flavour' ? purchaseItems.find(item => item.key === spend.stockKey && item.flavour) : purchaseItems.find(item => item.name === spend.category && item.category === 'consumable');
  const purchasedQuantity = Number(spend.stockQuantity);
  const stockPreview = purchasedItem && Number.isFinite(purchasedQuantity) && purchasedQuantity > 0
    ? `${purchasedItem.name}: ${purchasedItem.quantity} + ${purchasedQuantity} = ${Math.round((purchasedItem.quantity + purchasedQuantity) * 1000) / 1000} ${purchasedItem.unit}` : '';

  const submitExpense = async () => {
    if (expenseSaving) return;
    if (!Number.isFinite(Number(spend.amount)) || Number(spend.amount) <= 0) return setMessage("Enter an amount greater than zero.");
    if (journal.lockedThrough && spend.date <= journal.lockedThrough) return setMessage(`This date is locked through ${journal.lockedThrough}.`);
    if (isStockExpense && !purchasedItem) return setMessage(spend.category === 'Flavour' ? 'Choose the flavour purchased.' : 'This item is missing from stock. Refresh stock before saving.');
    if (isStockExpense && (!Number.isFinite(purchasedQuantity) || purchasedQuantity <= 0)) return setMessage('Enter the quantity bought.');
    setExpenseSaving(true);
    try { await onExpense({ ...spend, amount: Number(spend.amount), stockQuantities: purchasedItem ? { [purchasedItem.key]: purchasedQuantity } : {}, receipt }); }
    catch(error) { setMessage(error.message || "Could not save expense."); return; }
    finally { setExpenseSaving(false); }
    setSpend(current => ({ ...current, category: "Transport", description: "", amount: "", stockKey: "", stockQuantity: "" }));
    setReceipt(null);
    setMessage("Expense saved.");
    setActiveAction(null);
  };
  const submitManualSale = async () => {
    if (Number(sale.amount) <= 0 || !sale.description.trim() || !sale.reason.trim()) return setMessage("Enter the amount, description and reason.");
    if (journal.lockedThrough && sale.date <= journal.lockedThrough) return setMessage(`This date is locked through ${journal.lockedThrough}.`);
    const ok = await onManualSale({ ...sale, amount: Number(sale.amount) });
    setMessage(ok ? "Missing sale added." : "Could not add the sale.");
    if (ok) { setSale(current => ({ ...current, amount: "", description: "", reason: "" })); setActiveAction(null); }
  };
  const refundsPaid = reimbursements.reduce((sum, item) => sum + item.amount, 0);
  const profitPaid = payouts.reduce((sum, item) => sum + item.amount, 0);
  const downloadReport = () => {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const money = value => `R${Number(value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const issued = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
    const refundsDue = rows.reduce((sum, row) => sum + row.reimbursementDue, 0);
    const profitDue = profitSplit.rows.reduce((sum, row) => sum + row.remaining, 0);
    const unpaid = outstandingExpenses(expenses);
    const paymentRows = transactions.map(item => `<tr><td>${esc(item.date)}</td><td>${esc(personName(item.profileId))}</td><td>${item.kind === 'reimbursement' ? 'Refund of expenses' : 'Profit payout'}</td><td class="n">${money(item.amount)}</td></tr>`).join('');
    const personRows = rows.map(row => `<tr><td>${esc(row.user.name)}${partners.some(partner => partner.profileId === row.user.id) ? ' <small>(partner)</small>' : ''}</td><td class="n">${money(row.spent)}</td><td class="n">${money(row.refunded)}</td><td class="n">${money(row.share)}</td><td class="n">${money(row.paid)}</td><td class="n">${money(row.refunded + row.paid)}</td><td class="n"><b>${money(row.reimbursementDue + row.profitDue)}</b></td></tr>`).join('');
    const splitRows = profitSplit.rows.map(row=>`<tr><td>${esc(personName(row.profileId))}</td><td class="n">${Number(row.percentage.toFixed(2))}%</td><td class="n">${money(row.share)}</td><td class="n">${money(row.paid)}</td><td class="n"><b>${money(row.remaining)}</b></td></tr>`).join('');
    const splitNotice = profitSplit.error ? `<p class="notice">${esc(profitSplit.error)}</p>` : unpaid.count ? `<p class="notice">Provisional allocation: ${unpaid.count} expenses totalling ${money(unpaid.amount)} remain unpaid in this period. These expenses have already been deducted from profit. Settle or reimburse them before paying out the profit split.</p>` : `<p class="muted">All expenses in this period are paid. ${profitSplit.equal?'Partner percentages are unset; profit is split equally.':'Profit is split using the configured partner percentages.'}</p>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>The Chill Pipe finance report</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#20201e;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}.toolbar{position:sticky;top:0;padding:12px;text-align:center;background:#0a0a0a}.toolbar button{border:0;border-radius:8px;background:#fff;color:#0a0a0a;padding:10px 18px;font-weight:800;cursor:pointer}.paper{max-width:1050px;margin:24px auto;background:#fff;padding:46px 48px;box-shadow:0 10px 35px #0001}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:4px solid #216f59;padding-bottom:20px;margin-bottom:32px}.head h1{font-size:36px;line-height:1;margin:0 0 7px}.muted{color:#6d6c67}.issued{text-align:right}.section{margin-top:32px}.section h2{font-size:16px;letter-spacing:.07em;color:#6d6c67;text-transform:uppercase;margin:0 0 18px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:7px 42px}.summary div{display:flex;justify-content:space-between;gap:16px;border-bottom:1px dotted #aaa;padding:7px 0}.summary b{white-space:nowrap}table{width:100%;border-collapse:collapse}th{background:#f1f0eb;color:#4b4a47;text-align:left;font-size:13px}th,td{padding:12px 9px;border-bottom:1px solid #ddd}.n{text-align:right;white-space:nowrap}small{color:#6d6c67}.notice{padding:12px;border:1px solid #d6b669;background:#fff8e5;border-radius:8px;color:#71520f}.total td{font-weight:900;font-size:16px}@media(max-width:700px){.paper{margin:0;padding:24px 18px}.summary{grid-template-columns:1fr}.sc{overflow-x:auto}.head h1{font-size:28px}}@media print{body{background:#fff}.toolbar{display:none}.paper{box-shadow:none;margin:0;max-width:none;padding:16px 10px}@page{size:A4 landscape;margin:12mm}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Download / Save as PDF</button></div><main class="paper"><header class="head"><div><h1>The Chill Pipe</h1><div class="muted">Combined statement of account</div><div class="muted">${esc(periodLabel)}</div></div><div class="issued muted">Issued ${esc(issued)}</div></header>
    <section class="section"><h2>Business summary</h2><div class="summary"><div><span>Income received</span><b>${money(totalRevenue)}</b></div><div><span>Less: expenses</span><b>${money(expenseTotal)}</b></div><div><span>Profit after deductions</span><b>${money(profit)}</b></div><div><span>Profit paid to partners</span><b>${money(profitPaid)}</b></div><div><span>Profit remaining to pay</span><b>${money(profitDue)}</b></div><div><span>Refunds paid</span><b>${money(refundsPaid)}</b></div><div><span>Refunds still owed</span><b>${money(refundsDue)}</b></div><div><span>Profit (received − expenses)</span><b>${money(profit)}</b></div></div></section>
    <section class="section"><h2>Partner profit split</h2>${splitNotice}${splitRows ? `<div class="sc"><table><thead><tr><th>Partner</th><th class="n">Share %</th><th class="n">Profit share</th><th class="n">Already paid</th><th class="n">Still to pay</th></tr></thead><tbody>${splitRows}<tr class="total"><td colspan="4">Remaining payout</td><td class="n">${money(profitDue)}</td></tr></tbody></table></div><p class="muted">This report calculates amounts due. Downloading it does not record a partner payment.</p>` : ''}</section>
    <section class="section"><h2>Each person</h2><div class="sc"><table><thead><tr><th>Person</th><th class="n">Spent</th><th class="n">Refunded</th><th class="n">Profit share</th><th class="n">Profit paid</th><th class="n">Total paid</th><th class="n">Still owed</th></tr></thead><tbody>${personRows || '<tr><td colspan="7" class="muted">No balances for this period.</td></tr>'}</tbody></table></div></section>
    <section class="section"><h2>Payments made</h2><div class="sc"><table><thead><tr><th>Date</th><th>Person</th><th>Type</th><th class="n">Amount</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="4" class="muted">No payments for this period.</td></tr>'}<tr class="total"><td colspan="3">Total paid out</td><td class="n">${money(refundsPaid + profitPaid)}</td></tr></tbody></table></div></section>
    </main></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `the-chill-pipe-finance-${dateFrom}-to-${dateTo}.html`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Finance report downloaded.');
  };

  const card = { background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 13, padding: 13, display: "flex", flexDirection: "column", gap: 10 };
  const label = { fontSize: 9, fontWeight: 900, color: "#6c6a65", textTransform: "uppercase", letterSpacing: "0.1em" };
  const field = { minHeight: 42, border: "1px solid #d8d4cb", borderRadius: 9, background: "#fff", padding: "0 10px", color: "#0a0a0a", fontFamily: "inherit", fontWeight: 700, minWidth: 0 };
  const selectField = { ...field, fontSize: 11, fontWeight: 700, padding: "0 8px" };
  return <div className="finance-panel expand-down">
    <div style={styles.managementSectionHeading}>
      <div><span style={styles.managementEyebrow}>Finance journal</span><strong style={styles.managementSectionTitle}>{periodLabel}</strong></div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={styles.managementPeriodBadge} title="All unpaid expenses">{formatCurrency(totalDue)} owed</span><button onClick={downloadReport} aria-label="Open downloadable finance report" title="Download report" style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: 9, border: "1px solid #d8d4cb", background: "#fff", color: "#4a4843", cursor: "pointer", fontSize: 15 }}>⇩</button></div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
      {[
        ["Received", totalRevenue, "#16a34a"], ["Expenses", expenseTotal, "#dc2626"], ["Profit", profit, profit >= 0 ? "#0a0a0a" : "#dc2626"],
      ].map(([name, value, color]) => <div className="frosted-card" key={name} style={{ ...styles.kpiCard, padding: 10, minWidth: 0 }}><span style={{ ...styles.kpiLabel, fontSize: 8 }}>{name}</span><strong style={{ fontSize: 18, color, whiteSpace: "nowrap" }}>{formatCurrency(value)}</strong></div>)}
    </div>


    {message && (!activeAction || activeAction === "expense") && <div style={{ padding: "9px 11px", borderRadius: 9, background: (message.includes("saved") || message === "Finance report downloaded.") ? "#f0fdf4" : "#fef2f2", color: (message.includes("saved") || message === "Finance report downloaded.") ? "#15803d" : "#b91c1c", fontSize: 11, fontWeight: 800 }}>{message}</div>}

    {activeAction === "expense" && <div className="expand-down finance-form-card add-expense-card" style={card}>
      <strong className="add-expense-title">Add expense</strong>
      <fieldset disabled={expenseSaving} className="add-expense-fields">
        <section className="expense-form-section" aria-label="Expense details">
          <div className="expense-form-grid">
            <label>Category<select value={spend.category} onChange={event=>{const category=event.target.value;setSpend(current=>({...current,category,description:'',stockKey:'',stockQuantity:''}));}} aria-label="Expense category">{['Transport','Wages','Coal','Flavour','Mouth Pieces'].map(category=><option key={category}>{category}</option>)}</select></label>
            <label>Amount (R)<input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={spend.amount} onChange={event=>setSpend(current=>({...current,amount:event.target.value}))} aria-label="Expense amount" /></label>
          </div>
          {spend.category === 'Flavour' ? <div className="expense-form-grid"><label>Description — flavour<select aria-label="Expense flavour" value={spend.stockKey} onChange={event=>{const item=purchaseItems.find(item=>item.key===event.target.value);setSpend(current=>({...current,description:item?.name ?? '',stockKey:event.target.value,stockQuantity:''}));}}><option value="">Choose flavour</option>{purchaseItems.filter(item=>item.flavour).map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select></label><label>Quantity bought (boxes)<input aria-label="Flavour quantity bought" type="number" min="0.001" step="0.001" inputMode="decimal" placeholder="0" value={spend.stockQuantity} onChange={event=>setSpend(current=>({...current,stockQuantity:event.target.value}))} /></label></div> : <label><span>Description <span className="expense-optional">(optional)</span></span><input placeholder="What was this expense for?" value={spend.description} onChange={event=>setSpend(current=>({...current,description:event.target.value}))} aria-label="Expense description" /></label>}
          {isStockExpense && spend.category !== 'Flavour' && <label>Quantity bought ({purchasedItem?.unit ?? 'pieces'})<input aria-label="Stock quantity bought" type="number" min="0.001" step="0.001" inputMode="decimal" placeholder="0" value={spend.stockQuantity} onChange={event=>setSpend(current=>({...current,stockQuantity:event.target.value}))} /></label>}
          {stockPreview && <p className="expense-stock-preview" role="status">{stockPreview}</p>}
        </section>
        <ReceiptPicker file={receipt} onChange={setReceipt} />
        <section className="expense-form-section" aria-labelledby="expense-payment-title">
          <h3 id="expense-payment-title">Payment</h3>
          <div className="expense-form-grid">
            <label>Paid by<select value={spend.paidBy} onChange={event=>setSpend(current=>({...current,paidBy:event.target.value}))} aria-label="Who paid for this expense"><option value="">Business</option>{users.map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <label>Expense date<input type="date" value={spend.date} max={localToday()} onChange={event=>setSpend(current=>({...current,date:event.target.value}))} aria-label="Expense date" /></label>
          </div>
        </section>
        <div className="finance-form-actions expense-save-actions"><button onClick={()=>{setReceipt(null);setActiveAction(null);}} style={{...styles.copyBtn,flex:1}}>Cancel</button><button onClick={submitExpense} style={{...styles.addUserBtn,flex:2}}>{expenseSaving ? 'Saving…' : 'Save expense'}</button></div>
      </fieldset>
    </div>}

    {isAdmin && activeAction === "manual_sale" && <div className="expand-down missing-sale-card finance-form-card" style={{ ...card, border: "1px solid rgba(37,99,235,0.18)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 14, color: "#0a0a0a" }}>Add missing sale</strong><span style={{ fontSize: 8, fontWeight: 900, color: "#0a0a0a", background: "#ece8df", borderRadius: 99, padding: "3px 7px" }}>MANAGEMENT</span></div>
      <div className="finance-field-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={label}>Sale date</span><input type="date" max={localToday()} value={sale.date} onChange={event => setSale(current => ({ ...current, date: event.target.value }))} style={{ ...field, width: "100%" }} /></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={label}>Payment</span><select value={sale.payment} onChange={event => setSale(current => ({ ...current, payment: event.target.value }))} style={selectField}><option value="cash">Cash</option><option value="card">Card</option></select></div>
      </div>
      <input type="number" min="0" inputMode="decimal" placeholder="Amount (R)" value={sale.amount} onChange={event => setSale(current => ({ ...current, amount: event.target.value }))} style={{ ...field, fontSize: 18 }} />
      <input placeholder="Sale description" value={sale.description} onChange={event => setSale(current => ({ ...current, description: event.target.value }))} style={field} />
      <input placeholder="Why was it not recorded?" value={sale.reason} onChange={event => setSale(current => ({ ...current, reason: event.target.value }))} style={field} />
      <div className="finance-form-actions"><button onClick={() => setActiveAction(null)} style={{ ...styles.copyBtn, flex: 1 }}>Cancel</button><button onClick={submitManualSale} style={{ ...styles.addUserBtn, flex: 2 }}>Add sale</button></div>
    </div>}

    {activeAction !== "reimbursement" && activeAction !== "partner_payout" && <ExpensesList onMissingSale={isAdmin ? async () => { if (await confirmDiscard()) setActiveAction(activeAction === 'manual_sale' ? null : 'manual_sale'); } : undefined} canViewReceipts={canViewReceipts} onAdd={activeAction !== "expense" ? async () => { if (await confirmDiscard()) setActiveAction("expense"); } : undefined} currentUserId={currentUserId} isAdmin={isAdmin} onStatus={onExpenseStatus} stock={stock} expenses={isAdmin ? allExpenses : expenses} users={users} lockedThrough={journal.lockedThrough} today={localToday()} onUpdate={onExpenseUpdate} onDelete={onExpenseDelete} />}

    {isAdmin && (activeAction === "reimbursement" || activeAction === "partner_payout") && <div className="expand-down finance-form-card" style={card}>
      <span style={label}>{activeAction === "reimbursement" ? "Pay someone back" : "Pay partner profit"}</span>
      <div className="finance-field-grid">
        <select aria-label={entry.kind === "partner_payout" ? "Partner" : "Person to reimburse"} value={entry.profileId} onChange={event => {setEntry(current => ({ ...current, profileId: event.target.value, amount: "" }));setMessage("");}} style={selectField}><option value="">{entry.kind === "partner_payout" ? "Choose partner" : "Choose person"}</option>{paymentPeople.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
        {activeAction === "partner_payout" && <input type="date" value={entry.date} onChange={event => setEntry(current => ({ ...current, date: event.target.value }))} style={field} />}
      </div>
      {activeAction === "partner_payout" && entry.profileId && <p style={{fontSize:12}}>Still owed: <strong>{paymentMoney(paymentRow?.profitDue)}</strong> · {periodLabel}</p>}
      {activeAction === "partner_payout" && <>
      <label style={label}>{activeAction === "partner_payout" ? "Amount to pay partner (R)" : "Amount to pay back (R)"}</label>
      <input aria-label={activeAction === "partner_payout" ? "Amount to pay partner" : "Amount to pay back"} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Amount (R)" value={entry.amount} onChange={event => setEntry(current => ({ ...current, amount: event.target.value }))} style={{ ...field, fontSize: 18 }} />
      <input placeholder="Note (optional)" value={entry.description} onChange={event => setEntry(current => ({ ...current, description: event.target.value }))} style={field} />
      <div className="finance-form-actions"><button onClick={() => setActiveAction(null)} style={{ ...styles.copyBtn, flex: 1 }}>Cancel</button><button onClick={submit} disabled={locked} style={{ ...styles.addUserBtn, flex: 2, opacity: locked ? .5 : 1 }}>{locked ? "Date is locked" : "Confirm payment"}</button></div>
      </>}
      {activeAction === "reimbursement" && entry.profileId && <ExpensesList canViewReceipts={canViewReceipts} currentUserId={currentUserId} key={entry.profileId} title={`${personName(entry.profileId)} — unpaid expenses`} isAdmin={isAdmin} onStatus={onExpenseStatus} stock={stock} expenses={unpaidExpenses} users={users} lockedThrough={journal.lockedThrough} today={localToday()} onUpdate={onExpenseUpdate} onDelete={onExpenseDelete} />}
      {message && <span style={{ fontSize: 11, color: message.includes("recorded") || message.includes("copied") ? "#16a34a" : "#dc2626" }}>{message}</span>}
    </div>}


  </div>;
}

export default function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('chill-pipe-theme') === 'dark'; }
    catch { return false; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    try { localStorage.setItem('chill-pipe-theme', darkMode ? 'dark' : 'light'); }
    catch { /* Theme still works when device storage is unavailable. */ }
  }, [darkMode]);
  const [orders, setOrders] = useState([]);
  const [managerCurrentOrders, setManagerCurrentOrders] = useState([]);
  const [unreturnedPipes, setUnreturnedPipes] = useState([]);
  const [prices, setPrices] = useState(() => readSellingCache()?.prices ?? DEFAULT_PRICES);
  useEffect(()=>{cacheSellingData({prices});},[prices]);
  const [dbReady, setDbReady] = useState(false);
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newUserRole, setNewUserRole] = useState("Staff");
  const [newUserPin, setNewUserPin] = useState("");
  const [staffMessage, setStaffMessage] = useState("");
  const [staffMessageType, setStaffMessageType] = useState("error");
  const [addingUser, setAddingUser] = useState(false);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [settingsSection, setSettingsSection] = useState("team");
  const [ordersView, setOrdersView] = useState("Preparing");
  const [stockCategory, setStockCategory] = useState("Attention");
  const [stockView, updateStockView] = useState("overview");
  const setStockView = async view => {
    if (view === stockView || !await confirmDiscard()) return;
    updateStockView(view);
  };
  const [editingEquipmentId, setEditingEquipmentId] = useState(null);
  const [equipmentSaving, setEquipmentSaving] = useState(false);
  const [equipmentSaveError, setEquipmentSaveError] = useState("");
  const equipmentSaveRunning = useRef(false);
  const [equipmentBaseline, setEquipmentBaseline] = useState({});
  const [equipmentDraft, setEquipmentDraft] = useState({ name: "", quantity: "", lowThreshold: "" });
  useUnsavedChanges(editingEquipmentId !== null && formHasChanges(equipmentDraft,equipmentBaseline));
  const [teamSearch, setTeamSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("All");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [securityMessage, setSecurityMessage] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [resetPinId, setResetPinId] = useState(null);
  const [resetPinValue, setResetPinValue] = useState("");
  const [staffSave,setStaffSave] = useState({id:null,status:'',message:''});
  const [staffMoreId,setStaffMoreId] = useState(null);
  const [passwordBusy,setPasswordBusy] = useState(false);
  const [passwordError,setPasswordError] = useState('');
  const saveStaffAccess = async (user,changes) => {
    if (staffSave.status==='saving') return;
    setStaffSave({id:user.id,status:'saving',message:'Saving…'});
    try {
      await updateStaffAccess(user.id,changes);
      setUsers(prev=>prev.map(item=>item.id===user.id ? {...item,...changes} : item));
      setStaffSave({id:user.id,status:'saved',message:'✓ Changes saved'});
    } catch(error) { setStaffSave({id:user.id,status:'error',message:error.message || 'Could not save. Try again.'}); }
  };
  const saveStaffPassword = async user => {
    if (passwordBusy) return;
    if (resetPinValue.length<10) {setPasswordError('Use at least 10 characters.');return;}
    setPasswordBusy(true);setPasswordError('');
    try {await manageStaff('password',{userId:user.id,password:resetPinValue});setResetPinId(null);setResetPinValue('');setStaffSave({id:user.id,status:'saved',message:'✓ Password updated'});}
    catch(error) {setPasswordError(error.message || 'Could not update password.');}
    finally {setPasswordBusy(false);}
  };
  const [expandedUsers, setExpandedUsers] = useState(new Set());
  const toggleUserExpanded = (id) => setExpandedUsers(prev => { return prev.has(id) ? new Set() : new Set([id]); });
  const [orderType, setOrderType] = useState("full");
  const [payMethod, setPayMethod] = useState("card");
  const [selectedFlavour, setSelectedFlavour] = useState(null);
  const [flash, setFlash] = useState(null);
  const [undoTarget, setUndoTarget] = useState(null);
  const [activeTab, updateActiveTab] = useState("pos");
  const tabStarted = useRef(null);
  const setActiveTab = useCallback(async tab => {
    if (!await confirmDiscard()) return;
    tabStarted.current = performance.now();
    updateActiveTab(tab);
  }, []);
  useEffect(() => {
    setDiagnosticScreen(activeTab);
    const frame = requestAnimationFrame(() => {
      if (tabStarted.current === null) return;
      const duration = performance.now() - tabStarted.current;
      if (duration > 200) recordDiagnostic('slow_screen', 'slow_screen', duration);
      tabStarted.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab]);
  const [deliveredPage, setDeliveredPage] = useState(0);
  const ordersListRef = useRef(null);
  const [stock, setStock] = useState(() => {
    const defaults = [
      { id: 1,  name: "Coal",         category: "consumable", quantity: 72, unit: "pieces",  lowThreshold: 10 },
      { id: 14, name: "Flavour", category: "consumable", unit: "boxes", lowThreshold: 1,
        subItems: FLAVOURS.map(f => ({ id: f.id, name: f.name, icon: f.icon, color: f.color, bg: f.bg, quantity: 10 })) },
      { id: 8,  name: "Mouth Pieces", category: "consumable", quantity: 50, unit: "pieces",  lowThreshold: 10 },
      { id: 9,  name: "Kops",         category: "equipment",  quantity: 5,  unit: "units",   lowThreshold: 1 },
      { id: 10, name: "Rotas",        category: "equipment",  quantity: 8,  unit: "units",   lowThreshold: 2 },
      { id: 11, name: "Rota Tops",    category: "equipment",  quantity: 8,  unit: "units",   lowThreshold: 2 },
      { id: 12, name: "Stove",        category: "equipment",  quantity: 2,  unit: "units",   lowThreshold: 1 },
          ];
    return readSellingCache()?.stock ?? defaults;
  });
  const [showAddStaff,setShowAddStaff] = useState(false);
  const [equipmentCollapsed, setEquipmentCollapsed] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [orderDeleteConfirmId, setOrderDeleteConfirmId] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const cancellationRunning = useRef(false);
  const [cancellationError, setCancellationError] = useState("");
  const [expandedStockIds, setExpandedStockIds] = useState(new Set());
  const [expenses, setExpenses] = useState([]);
  const [stockPlanningOrders, setStockPlanningOrders] = useState([]);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => formatTime(new Date()));
  const [currentMinute, setCurrentMinute] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setCurrentTime(formatTime(now));
      setCurrentMinute(now.getTime());
    }, 60000);
    return () => clearInterval(id);
  }, []);
  const [managementPreset, setManagementPreset] = useState("Today");
  const [managementDateFrom, setManagementDateFrom] = useState(localToday);
  const [managementDateTo, setManagementDateTo] = useState(localToday);
  const [managementTimeFrom, setManagementTimeFrom] = useState("00:00");
  const [managementTimeTo, setManagementTimeTo] = useState("23:59");
  const [managementOrders, setManagementOrders] = useState([]);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementView, updateManagementView] = useState("overview");
  const setManagementView = async view => {
    if (view === managementView || !await confirmDiscard()) return;
    updateManagementView(view);
  };
  const [financeJournal, setFinanceJournal] = useState({ partners: [], transactions: [], manualSales: [], lockedThrough: null });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [pendingOrderCount, setPendingOrderCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => readSellingCache()?.lastSyncedAt ?? null);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [sessionDates, setSessionDates] = useState([]);
  const undoTimer = useRef(null);
  const orderSyncRunning = useRef(false);
  const saleRunning = useRef(false);
  const [saleSaving, setSaleSaving] = useState(false);

  const syncOfflineOrders = useCallback(async () => {
    if (!navigator.onLine || !activeUser || orderSyncRunning.current) return;
    orderSyncRunning.current = true;
    setSyncingOrders(true);
    setSyncMessage("");
    try {
      const synced = await syncPendingSales({ownerId:activeUser.id,list:getOfflineOrders,send:insertOrder,remove:removeOfflineOrder,onSynced:order => {
        setOrders(prev => prev.map(item => item.id === order.id ? { ...item, pendingSync: false } : item));
      }});
      if (synced) { const latest = await fetchStock(); if (latest) setStock(latest); }
      const remaining = await getOfflineOrders();
      if (synced > 0) { const time = new Date().toISOString(); setLastSyncedAt(time); cacheSellingData({lastSyncedAt:time}); }
      setPendingOrderCount(remaining.length);
      if (remaining.some(order => !order.ownerId || order.ownerId !== activeUser.id)) setSyncMessage('Some queued sales belong to another user or need ownership recovery. They remain safely on this device.');
      else if (remaining.length) setSyncMessage(`${remaining.length} sale${remaining.length === 1 ? '' : 's'} still waiting. Automatic retry is enabled.`);
      else if (synced > 0) setSyncMessage(`${synced} offline order${synced === 1 ? "" : "s"} synced`);
    } catch {
      setSyncMessage("Could not finish syncing. Unsynced orders remain on this device.");
    } finally {
      orderSyncRunning.current = false;
      setSyncingOrders(false);
    }
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser || !isOnline || pendingOrderCount === 0) return;
    let stopped = false;
    let attempt = 0;
    let timer;
    const retry = async () => {
      if (stopped) return;
      await syncOfflineOrders();
      if (!stopped) timer = setTimeout(retry, syncRetryDelay(++attempt));
    };
    timer = setTimeout(retry, syncRetryDelay(attempt));
    return () => { stopped = true; clearTimeout(timer); };
  }, [activeUser, isOnline, pendingOrderCount, syncOfflineOrders]);

  useEffect(() => {
    const goOnline = () => { setIsOnline(true); syncOfflineOrders(); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncOfflineOrders]);

  useEffect(() => {
    if (!activeUser) return;
    getOfflineOrders().then(pending => {
      setPendingOrderCount(pending.length);
      setOrders(prev => {
        const known = new Set(prev.map(order => order.id));
        return [...prev, ...pending.filter(order => !known.has(order.id)).map(order => ({
          ...order,
          flavour: normalizeFlavour(order.flavour),
          time: new Date(order.time),
          pendingSync: true,
        }))];
      });
      if (navigator.onLine && pending.length) syncOfflineOrders();
    });
  }, [activeUser, syncOfflineOrders]);

  useEffect(() => {
    if (!syncMessage || pendingOrderCount > 0) return;
    const timer = setTimeout(() => setSyncMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [syncMessage, pendingOrderCount]);

  useEffect(() => {
    let alive = true;
    const refreshAuth = async () => {
      try {
        const profile = await getCurrentProfile();
        if (alive) { setActiveUser(profile); setLoginError(""); }
      } catch (error) {
        if (alive) { setActiveUser(null); setLoginError(error.message); }
      } finally {
        if (alive) setAuthLoading(false);
      }
    };
    refreshAuth();
    const subscription = onAuthChange(refreshAuth);
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  // ── Load business data only after a verified session exists ──
  useEffect(() => {
    if (!activeUser || !supabase) return;
    async function load() {
      const [remoteUsers, remoteStock, remoteOrders, remoteExpenses, remoteUnreturned, remoteFinance, pendingOrders, remotePrices] = await Promise.all([
        fetchUsers(), fetchStock(), fetchOrders(), fetchExpenses(), fetchUnreturnedPipes(), fetchFinanceJournal(), getOfflineOrders(), fetchPrices(),
      ]);
      const unfinishedOrders = ["Admin", "Manager"].includes(activeUser.role) ? await fetchUnfinishedOrders() : null;
      if (remoteUsers && remoteUsers.length > 0) {
        setUsers(remoteUsers);
      }
      if (remoteStock && remoteStock.length > 0) setStock(remoteStock);
      if (remoteOrders) {
        const remoteIds = new Set(remoteOrders.map(order => order.id));
        setOrders([
          ...remoteOrders.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })),
          ...pendingOrders.filter(order => !remoteIds.has(order.id)).map(order => ({ ...order, flavour: normalizeFlavour(order.flavour), time: new Date(order.time), pendingSync: true })),
        ]);
      }
      setPendingOrderCount(pendingOrders.length);
      if (unfinishedOrders) setManagerCurrentOrders(unfinishedOrders.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })));
      if (remoteUnreturned) setUnreturnedPipes(remoteUnreturned.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })));
      if (remoteExpenses && remoteExpenses.length > 0) setExpenses(remoteExpenses);
      if (remoteFinance) setFinanceJournal(remoteFinance);
      if (remotePrices) setPrices(remotePrices);
      setDbReady(true);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser?.id]);

  // Re-fetch from Supabase whenever the user switches tabs
  useEffect(() => {
    if (!dbReady || !supabase) return;
    async function refresh() {
      const [remoteOrders, remoteStock, remoteExpenses, remoteUnreturned, pendingOrders, remotePrices] = await Promise.all([
        fetchOrders(), fetchStock(), fetchExpenses(), fetchUnreturnedPipes(), getOfflineOrders(), fetchPrices(),
      ]);
      const unfinishedOrders = ["Admin", "Manager"].includes(activeUser?.role) ? await fetchUnfinishedOrders() : null;
      if (remoteOrders) {
        const remoteIds = new Set(remoteOrders.map(order => order.id));
        setOrders([
          ...remoteOrders.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })),
          ...pendingOrders.filter(order => !remoteIds.has(order.id)).map(order => ({ ...order, flavour: normalizeFlavour(order.flavour), time: new Date(order.time), pendingSync: true })),
        ]);
      }
      if (unfinishedOrders) setManagerCurrentOrders(unfinishedOrders.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })));
      if (remoteUnreturned) setUnreturnedPipes(remoteUnreturned.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })));
      if (remoteStock && remoteStock.length > 0) {
        setStock(remoteStock);
      }
      if (remotePrices) setPrices(remotePrices);
      if (remoteExpenses) {
        setExpenses(remoteExpenses);
      }
    }
    refresh();
  }, [activeTab]); // eslint-disable-line

  // Keep manager-facing sales views current while staff are taking orders.
  useEffect(() => {
    if (!dbReady || !supabase || !["Admin", "Manager"].includes(activeUser?.role)) return;
    if (!["management", "delivered"].includes(activeTab)) return;

    let alive = true;
    let refreshing = false;
    const refreshManagerSales = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [dailyOrders, unfinishedOrders, pendingOrders] = await Promise.all([
          fetchOrders(),
          fetchUnfinishedOrders(),
          getOfflineOrders(),
        ]);
        if (!alive) return;
        if (dailyOrders) {
          const remoteIds = new Set(dailyOrders.map(order => order.id));
          setOrders([
            ...dailyOrders.map(order => ({ ...order, flavour: normalizeFlavour(order.flavour) })),
            ...pendingOrders.filter(order => !remoteIds.has(order.id)).map(order => ({ ...order, flavour: normalizeFlavour(order.flavour), time: new Date(order.time), pendingSync: true })),
          ]);
        }
        if (unfinishedOrders) setManagerCurrentOrders(unfinishedOrders.map(order => ({ ...order, flavour: normalizeFlavour(order.flavour) })));
      } finally {
        refreshing = false;
      }
    };

    refreshManagerSales();
    const interval = setInterval(refreshManagerSales, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [activeTab, activeUser?.role, dbReady]);

  // Fetch session dates list once management tab is opened
  useEffect(() => {
    if (activeTab !== "management" || !supabase || sessionDates.length > 0) return;
    fetchSessionDates().then(dates => { if (dates) setSessionDates(dates); });
  }, [activeTab]); // eslint-disable-line

  useEffect(() => {
    if (!["stock", "management"].includes(activeTab) || !supabase) return;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 56);
    fromDate.setHours(0, 0, 0, 0);
    fetchOrdersByDateRange(fromDate.toISOString(), new Date().toISOString()).then(recentOrders => {
      if (recentOrders) setStockPlanningOrders(recentOrders.map(order => ({ ...order, flavour: normalizeFlavour(order.flavour) })));
    });
  }, [activeTab]);

  // Fetch orders when the management date/time range changes
  useEffect(() => {
    const todayStr = localToday();
    if (managementDateFrom === todayStr && managementDateTo === todayStr) {
      return; // today is filtered client-side from live orders
    }
    if (!supabase) return;
    const loadingTimer = setTimeout(() => setManagementLoading(true), 0);
    const from = new Date(`${managementDateFrom}T${managementTimeFrom}:00`).toISOString();
    const to   = new Date(`${managementDateTo}T${managementTimeTo}:59`).toISOString();
    fetchOrdersByDateRange(from, to).then(o => {
      setManagementOrders((o ?? []).map(ord => ({ ...ord, flavour: normalizeFlavour(ord.flavour) })));
      setManagementLoading(false);
    });
    return () => clearTimeout(loadingTimer);
  }, [managementDateFrom, managementDateTo, managementTimeFrom, managementTimeTo]);

  const pendingSales = orders.filter(order => order.pendingSync);
  const offlineEstimate = estimatedStock(stock, pendingSales);
  const hookahPipeQty = stock.find(i => i.category === "equipment" && i.name.toLowerCase().includes("hookah"))?.quantity ?? 0;
  const rotasQty      = stock.find(i => i.category === "equipment" && i.name.toLowerCase() === "rotas")?.quantity ?? 0;
  const rotaTopsQty   = stock.find(i => i.category === "equipment" && i.name.toLowerCase().includes("rota top"))?.quantity ?? 0;
  const kopsQty       = stock.find(i => i.category === "equipment" && i.name.toLowerCase().includes("kop"))?.quantity ?? 0;

  const confirmOrder = useCallback(async () => {
    if (!selectedFlavour) return;
    if (!navigator.onLine && !readSellingCache()?.stockAt) {setSyncMessage('Connect once to load confirmed stock before taking offline sales.');return;}
    if (orderType === "full" && (hookahPipeQty <= 1 || rotasQty <= 1 || rotaTopsQty <= 1 || kopsQty <= 1)) return;

    const order = {
      id: createOrderId(),
      flavour: selectedFlavour,
      type: orderType,
      payment: payMethod,
      price: prices[orderType],
      time: new Date(),
      status: "active",
      soldBy: activeUser?.name ?? "Unknown",
      ownerId: activeUser?.id,
      pipeReturned: false,
    };

    if (saleRunning.current) return;
    saleRunning.current = true; setSaleSaving(true);
    try {
      const result = await persistSale(order,{queue:queueOfflineOrder,send:insertOrder,remove:removeOfflineOrder,online:navigator.onLine});
      const orderForDisplay = { ...order, pendingSync: result.pendingSync };
      setOrders((prev) => [...prev, orderForDisplay]);
      if (["Admin", "Manager"].includes(activeUser?.role)) setManagerCurrentOrders((prev) => [...prev, orderForDisplay]);
      setSelectedFlavour(null);

      if (result.pendingSync) {
        const pending = await getOfflineOrders();
        setPendingOrderCount(pending.length);
        setIsOnline(navigator.onLine);
        setSyncMessage("Order saved on this device");
      }

      if (result.saved) {
        const time = new Date().toISOString(); setLastSyncedAt(time); cacheSellingData({lastSyncedAt:time});
        const latest = await fetchStock();
        if (latest) setStock(latest);
      }

      setFlash(selectedFlavour.id);
      setUndoTarget(order.id);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoTarget(null), 4000);
      setTimeout(() => setFlash(null), 300);
      setActiveTab("pos");
    } catch {
      setSyncMessage("Could not save this sale on the device. Please try again.");
    } finally { saleRunning.current = false; setSaleSaving(false); }
  }, [selectedFlavour, orderType, payMethod, prices, hookahPipeQty, rotasQty, rotaTopsQty, kopsQty, activeUser, setActiveTab]);

  const handleLogin = useCallback(async () => {
    try {
      setLoginError("");
      await signIn(loginUsername, loginPassword);
      setLoginUsername("");
      setLoginPassword("");
    } catch {
      setLoginError("Invalid username or password.");
      setLoginPassword("");
    }
  }, [loginUsername, loginPassword]);

  const cancelUndelivered = useCallback(async (order) => {
    if (!order || order.status === "delivered" || cancellationRunning.current) return;
    // Queued orders must finish syncing before server-side cancellation.
    if (order.pendingSync) return;
    cancellationRunning.current = true;
    setCancellingOrderId(order.id);
    setCancellationError("");
    try {
      if (!await cancelOrder(order.id)) {
        setCancellationError("Could not cancel this order. It may already be delivered. Refresh and try again.");
        return;
      }
      setOrders(prev => prev.filter(o => o.id !== order.id));
      setManagerCurrentOrders(prev => prev.filter(o => o.id !== order.id));
      setManagementOrders(prev => prev.filter(o => o.id !== order.id));
      setStockPlanningOrders(prev => prev.filter(o => o.id !== order.id));
      setOrderDeleteConfirmId(null);
      if (undoTarget === order.id) { setUndoTarget(null); clearTimeout(undoTimer.current); }
      const remoteStock = await fetchStock();
      if (remoteStock) setStock(remoteStock);
    } catch {
      setCancellationError("Cancellation failed. Please try again when connected.");
    } finally {
      cancellationRunning.current = false;
      setCancellingOrderId(null);
    }
  }, [undoTarget]);

  const undoLast = useCallback(async () => {
    if (!undoTarget) return;
    const pending = orders.find(order => order.id === undoTarget)?.pendingSync;
    setOrders(prev => prev.filter(o => o.id !== undoTarget));
    setManagerCurrentOrders(prev => prev.filter(o => o.id !== undoTarget));
    if (pending) {
      await removeOfflineOrder(undoTarget);
      const remaining = await getOfflineOrders();
      setPendingOrderCount(remaining.length);
    } else {
      deleteOrder(undoTarget);
    }
    setUndoTarget(null);
    clearTimeout(undoTimer.current);
  }, [undoTarget, orders]);

  // Accepts the full order object so there is no stale-closure risk when reading
  // order.status / order.pipeReturned — we inspect before any state mutation.
  const removeOrder = useCallback(async (order) => {
    const removed = await deleteOrder(order.id);
    if (!removed) return;
    setOrders(prev => prev.filter(o => o.id !== order.id));
    setManagerCurrentOrders(prev => prev.filter(o => o.id !== order.id));
    const remoteStock = await fetchStock();
    if (remoteStock) setStock(remoteStock);
  }, []);

  const returnPipe = useCallback(async (id) => {
    const returned = await returnOrderPipe(id);
    if (!returned) return;
    setOrders((prev) => prev.map((o) => o.id === id ? { ...o, pipeReturned: true } : o));
    setUnreturnedPipes((prev) => prev.filter(o => o.id !== id));
    const remoteStock = await fetchStock();
    if (remoteStock) setStock(remoteStock);
  }, []);

  // Accepts the full order object to avoid reading order.type inside a state updater
  // (calling setState inside setState updater is an anti-pattern — updaters must be pure).
  const markDelivered = useCallback(async (order) => {
    const deliveredAt = new Date();
    const delivered = await markOrderDelivered(order.id);
    if (!delivered) return;
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "delivered", deliveredAt } : o));
    setManagerCurrentOrders(prev => prev.filter(o => o.id !== order.id));
    const remoteStock = await fetchStock();
    if (remoteStock) setStock(remoteStock);
  }, []);

  const currentOrders = orders.filter((o) => o.status !== "delivered");
  const deliveredOrders = orders.filter((o) => o.status === "delivered");
  const pipesOut = deliveredOrders.filter((o) => o.type === "full" && !o.pipeReturned).length
    + unreturnedPipes.filter((oldOrder) => !orders.some((order) => order.id === oldOrder.id)).length;

  const deliveredPaymentCounts = deliveredOrders.reduce(
    (acc, o) => {
      acc[o.payment] += 1;
      return acc;
    },
    { card: 0, cash: 0 }
  );

  const flavourCounts = orders.reduce((acc, o) => {
    acc[o.flavour.id] = (acc[o.flavour.id] || 0) + 1;
    return acc;
  }, {});

  const todayLabel = new Date().toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const isAdmin = activeUser?.role === "Admin";
  const canViewAllOrders = activeUser?.role === "Admin" || activeUser?.role === "Manager";
  const matchingOrders = ordersView === "Preparing"
    ? (canViewAllOrders ? managerCurrentOrders : currentOrders)
    : ordersView === "Return Pipes"
      ? [...unreturnedPipes, ...deliveredOrders.filter((o) => o.type === "full" && !o.pipeReturned)]
      : deliveredOrders;
  const { items: queueOrders, page: safePage, totalPages: totalDeliveredPages } = orderPage(matchingOrders, deliveredPage);

  const usernameIsValid = /^[a-z0-9._-]{3,32}$/.test(newUsername);
  const passwordIsValid = newUserPin.length >= 10;
  const addUserFormIsValid = newUserName.trim().length >= 2 && usernameIsValid && passwordIsValid;
  const visibleUsers = users.filter((user) => {
    const matchesSearch = !teamSearch.trim() || `${user.name} ${user.username ?? ""}`.toLowerCase().includes(teamSearch.trim().toLowerCase());
    const matchesFilter = teamFilter === "All" || (teamFilter === "Suspended" ? user.paused : user.role === teamFilter && !user.paused);
    return matchesSearch && matchesFilter;
  });
  const currentUserPerms = users.find((u) => u.id === activeUser?.id)?.permissions ?? {};
  const canAccess = (tab) => {
    if (!activeUser) return false;
    if (tab === "pos") return true;
    if (!isOnline) return false;
    if (isAdmin) return true;
    return currentUserPerms[tab] ?? false;
  };
  const visibleTab = canAccess(activeTab) ? activeTab : "pos";
  const screenTitle = visibleTab === "pos" ? "The Chill Pipe POS"
    : visibleTab === "delivered" ? "Orders"
      : visibleTab === "management" ? "Management"
        : visibleTab.charAt(0).toUpperCase() + visibleTab.slice(1);

  return (
    <div style={styles.container}>
      <div className="app-shell" style={styles.appChrome}>
        {authLoading ? (
          <div className="login-screen" style={styles.loginScreen}><div style={styles.loginCard}>Checking secure session…</div></div>
        ) : !activeUser ? (
          <div className="login-screen" style={styles.loginScreen}>
            <div className="float-1" style={styles.loginOrb1} />
            <div className="float-2" style={styles.loginOrb2} />
            <div className="float-3" style={styles.loginOrb3} />

            <div className="pop-enter login-welcome-card" style={styles.loginCard}>
              <div style={styles.loginLogoWrap}>
                <img src={LOGO_SRC} alt="The Chill Pipe logo" style={styles.loginLogo} />
              </div>

              <div style={styles.loginBrandTag}>The Chill Pipe · POS</div>
              <h1 style={styles.loginAppName}>Welcome back</h1>
              <p style={styles.loginMeta}>Sign in to start taking orders.</p>

              <div style={styles.loginField}>
                <label htmlFor="login-username" style={styles.loginLabel}>Username or email</label>
                <input
                  id="login-username"
                  className="login-input"
                  value={loginUsername}
                  onChange={(e) => { setLoginUsername(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  autoComplete="username"
                  placeholder="Enter your username"
                  style={styles.loginInput}
                />
              </div>

              <div style={styles.loginField}>
                <label htmlFor="login-password" style={styles.loginLabel}>Password</label>
                <input
                  id="login-password"
                  className="login-input"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => { setLoginPassword(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="Enter your password"
                  style={styles.loginInput}
                />
              </div>

              {loginError && <div style={styles.loginErrorMsg}>{loginError}</div>}

              <button onClick={handleLogin} style={styles.loginSignInBtn}>Sign In</button>

              <div style={styles.loginFooterNote}>{todayLabel} · {currentTime}</div>
            </div>
          </div>
        ) : (
        <>
        <div style={styles.topBar}>
          <div style={styles.headerLogoWrap}>
            <img src={LOGO_SRC} alt="The Chill Pipe logo" style={styles.headerLogo} />
          </div>
          <h1 className="screen-title" style={styles.screenTitle}>{screenTitle}</h1>
          <div className="header-actions">
          {!confirmLogout && <button className="theme-toggle" onClick={() => setDarkMode(value => !value)} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} title={darkMode ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={darkMode}>
            {darkMode ? "☀" : "☾"}
          </button>}
          {confirmLogout ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.85)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0a0a0a" }}>Switch user?</span>
              <button
                onClick={async () => { if (blocksSignOut(await getOfflineOrders(), activeUser?.id, saleRunning.current, orderSyncRunning.current)) {setSyncMessage('Sync your queued sales before switching users.');setConfirmLogout(false);return;} await signOut(); setActiveUser(null); setUsers([]); setDbReady(false); setConfirmLogout(false); }}
                style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#0a0a0a", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >Yes</button>
              <button
                onClick={() => setConfirmLogout(false)}
                style={{ fontSize: 12, fontWeight: 800, color: "#6c6a65", background: "rgba(0,0,0,0.06)", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >No</button>
            </div>
          ) : (visibleTab !== "management" || isAdmin) && (
            <button
              aria-label={visibleTab === "management" ? "Open settings" : "Switch user"}
              onClick={() => visibleTab === "management" ? setActiveTab("settings") : visibleTab === "settings" ? setActiveTab("management") : setConfirmLogout(true)}
              className="header-account-button" style={styles.headerIconBtn}
            >
              {visibleTab === "management" ? "⚙" : visibleTab === "settings" ? "←" : activeUser.name.charAt(0).toUpperCase()}
            </button>
          )}
          </div>
        </div>

        <PullToRefresh style={styles.mainContent}>
          {cancellationError && <div role="alert" style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 12 }}>{cancellationError}</div>}
          {(!isOnline || pendingOrderCount > 0 || syncMessage || lastSyncedAt) && (
            <div style={{ ...styles.syncBanner, background: !isOnline ? "#fff7ed" : pendingOrderCount > 0 ? "#f6f4ef" : "#ecfdf5", borderColor: !isOnline ? "#fed7aa" : pendingOrderCount > 0 ? "#d8d4cb" : "#a7f3d0" }}>
              <div>
                <strong>{!isOnline ? "Offline mode" : pendingOrderCount > 0 ? `${pendingOrderCount} waiting to sync` : syncMessage || "All sales synced"}</strong>
                <span>{!isOnline ? " Orders stay on this device. Stock estimates await server confirmation." : pendingOrderCount > 0 ? " Stock estimates await server confirmation." : ""}</span>
                {pendingOrderCount > 0 && syncMessage && <span role="status">{syncMessage}</span>}
                {lastSyncedAt && <span>Last synced: {new Date(lastSyncedAt).toLocaleString('en-ZA', {timeZone:'Africa/Johannesburg',dateStyle:'short',timeStyle:'short'})}</span>}
              </div>
              {isOnline && pendingOrderCount > 0 && <button onClick={syncOfflineOrders} disabled={syncingOrders} style={styles.syncButton}>{syncingOrders ? "Syncing…" : "Sync now"}</button>}
            </div>
          )}
          {visibleTab === "pos" && (
            <div key="pos" className="tab-enter">
        <div className="available-pipes-card" style={styles.availabilityCard}>
          <div className="pipe-availability-heading"><span>Available pipes</span><span className="pipe-availability-value"><i className={hookahPipeQty <= 2 ? 'is-low' : ''} aria-hidden="true" /><strong>{hookahPipeQty} / {hookahPipeQty + pipesOut}</strong> available</span></div>
          <div className="pipe-availability-track"><div style={{width: `${hookahPipeQty + pipesOut ? hookahPipeQty / (hookahPipeQty + pipesOut) * 100 : 0}%`, background: hookahPipeQty <= 2 ? '#dc2626' : '#16c35a'}} /></div>
        </div>
        <div className="theme-page-surface order-type-card" style={styles.salePanel}>
          {pendingSales.length > 0 && <p className="offline-stock-estimate" role="status">Estimated remaining coal: {offlineEstimate.find(item=>item.name==='Coal')?.quantity ?? '—'} pieces. 2 pieces per pending order · awaiting sync; other devices may change stock.</p>}
          <div className="pos-order-controls">
            <div className="pos-control-column"><div style={styles.sectionHeaderLabel}>Order type</div>
              <div className="pos-segments" role="group" aria-label="Order type" style={styles.toggleGroup}>
                {["full", "refill"].map(t => <button key={t} aria-pressed={orderType === t} onClick={()=>setOrderType(t)} style={{...styles.toggleBtn,...(orderType === t ? styles.toggleActive : {})}}><span>{t === "full" ? "New Pipe" : "Refill"}</span><strong>{formatCurrency(prices[t])}</strong></button>)}
              </div>
            </div>
            <div className="pos-control-column"><div style={styles.sectionHeaderLabel}>Payment</div>
              <div className="pos-segments" role="group" aria-label="Payment method" style={styles.toggleGroup}>
                {["card", "cash"].map(method => <button key={method} aria-pressed={payMethod === method} onClick={()=>setPayMethod(method)} style={{...styles.toggleBtn,...(payMethod === method ? styles.toggleActive : {})}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{method === "card" ? <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></> : <><rect x="2" y="6" width="20" height="12" rx="1.5"/><circle cx="12" cy="12" r="3"/><path d="M5 9h1M18 15h1"/></>}</svg>
                  <span>{method === "card" ? "Card" : "Cash"}</span>
                </button>)}
              </div>
            </div>
          </div>

          <div style={styles.panelHeader}>
            <div style={styles.sectionHeaderLabel}>Flavour</div>
            <div style={styles.panelHint}>Choose one</div>
          </div>
          <div style={styles.flavourGrid}>
            {FLAVOURS.map((f, fi) => (
              <button
                key={f.id}
                onClick={() => setSelectedFlavour(f)}
                className={`flavour-pop d-${fi}`}
                aria-pressed={selectedFlavour?.id === f.id}
                style={{
                  ...styles.flavourBtn,
                  background: flash === f.id ? f.color : selectedFlavour?.id === f.id ? f.color : f.bg,
                  color: flash === f.id ? "#fff" : selectedFlavour?.id === f.id ? "#fff" : "#0a0a0a",
                  border: `1px solid ${selectedFlavour?.id === f.id ? "#f6f4ef" : "#292929"}`,
                  transform: "none",
                  boxShadow: "none",
                  transition: "box-shadow 140ms ease, border-color 140ms ease",
                }}
              >
                <span style={styles.flavourIcon}>{f.icon}</span>
                <span style={styles.flavourName}>{f.name}</span>
                {flavourCounts[f.id] ? (
                  <span style={{ ...styles.flavourCount, background: selectedFlavour?.id === f.id ? "#fff" : f.color, color: selectedFlavour?.id === f.id ? f.color : "#fff" }}>
                    {flavourCounts[f.id]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {selectedFlavour && (() => {
            const blockedItem = orderType === "full"
              ? (hookahPipeQty <= 1 ? "Hookah Pipe" : rotasQty <= 1 ? "Rotas" : rotaTopsQty <= 1 ? "Rota Tops" : kopsQty <= 1 ? "Kops" : null)
              : null;
            const blocked = !!blockedItem;
            return (
              <button
                onClick={confirmOrder}
                disabled={blocked || saleSaving}
                className={!blocked ? "glow-active" : ""}
                style={{ ...styles.confirmBtn, ...(blocked ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}
              >
                <span>{saleSaving ? "Saving…" : blocked
                  ? `No ${blockedItem} available · ${selectedFlavour.name}`
                  : `Confirm · ${selectedFlavour.name}`
                }</span>
                {!blocked && <strong>{formatCurrency(prices[orderType])} →</strong>}
              </button>
            );
          })()}

          {undoTarget && (
            <div className="slide-up" style={styles.undoBar}>
              <span>Order added to receipt</span>
              <button onClick={undoLast} style={styles.undoBtn}>Undo</button>
            </div>
          )}
        </div>

            </div>
          )}

          {visibleTab === "delivered" && (
            <div key="delivered" className="tab-enter theme-page-surface" style={styles.deliveredPanel}>
              <div style={{ ...styles.deliveredBar, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={styles.totalLeft}>
                  <span style={styles.totalLabel}>Orders Delivered</span>
                  <span style={styles.totalSub}>{deliveredOrders.length} orders · Card {deliveredPaymentCounts.card} · Cash {deliveredPaymentCounts.cash}</span>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span style={styles.totalSub}>{pipesOut} out · {hookahPipeQty} available</span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: 6, borderRadius: 13, background: "rgba(255,255,255,0.62)" }}>
                {[{ label: "Preparing", count: canViewAllOrders ? managerCurrentOrders.length : currentOrders.length }, { label: "Delivered", count: deliveredOrders.length }, { label: "Return Pipes", count: pipesOut }].map((tab) => (
                  <button role="tab" aria-selected={ordersView === tab.label} key={tab.label} onClick={() => { setOrdersView(tab.label); setDeliveredPage(0); }} style={{ border: 0, borderRadius: 10, padding: "9px 5px", background: ordersView === tab.label ? "#0a0a0a" : "transparent", color: ordersView === tab.label ? "#fff" : "#6c6a65", fontWeight: 800, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                    {tab.label} <span style={{ opacity: 0.7 }}>{tab.count}</span>
                  </button>
                ))}
              </div>

              <div ref={ordersListRef} className="pagination-list-target" style={styles.deliveredList}>
                {queueOrders.length === 0 && <div style={styles.emptyState}>Nothing in {ordersView.toLowerCase()}</div>}
                {queueOrders.map((o, i) => {
                  const orderedAt = o.time instanceof Date ? o.time : new Date(o.time);
                  const elapsed = Math.max(0, Math.floor((currentMinute - orderedAt.getTime()) / 60000));
                  const overdue = ordersView === "Preparing" && elapsed >= 12;
                  return (
                    <div key={`${o.id}-${ordersView}`} className="card-enter order-card" style={{ ...styles.deliveredRow, animationDelay: `${i * 0.04}s`, border: overdue ? "1px solid #f59e0b" : undefined, background: overdue ? "#fffbeb" : undefined }}>
                      <div style={styles.orderCardHeader}>
                        <span style={styles.orderCardNumber}>Order #{String(o.id).slice(-4)}</span>
                        <span style={{ ...styles.orderStatusPill, color: overdue || ordersView === "Return Pipes" ? "#b45309" : ordersView === "Preparing" ? "#0a0a0a" : "#15803d", background: overdue || ordersView === "Return Pipes" ? "#fef3c7" : ordersView === "Preparing" ? "#ece8df" : "#dcfce7" }}>
                          {overdue ? "Overdue" : ordersView === "Preparing" ? "Preparing" : ordersView === "Return Pipes" ? "Pipe out" : "Delivered"}
                        </span>
                        <span style={styles.orderCardTime}>{ordersView === "Preparing" ? `${elapsed} min` : formatTime(o.deliveredAt ?? orderedAt)}</span>
                      </div>
                      <div style={styles.orderCardBody}>
                        <FlavourThumbnail flavour={o.flavour} />
                        <span style={styles.orderMeta}>
                          <strong style={{ fontSize: 12 }}>{o.flavour.name}</strong>
                          <small style={styles.orderCardStaff}>{o.type === "refill" ? "Refill" : "New Pipe"} · Served by {o.soldBy ?? "Unknown"}</small>
                        </span>
                        <span style={styles.orderCardAmount}>
                          <strong>{formatCurrency(o.price)}</strong>
                          <small>{o.payment === "card" ? "▣ Card" : "▤ Cash"}</small>
                        </span>
                      </div>
                      {ordersView === "Preparing" ? <button onClick={() => markDelivered(o)} style={{ ...styles.deliverBtn, minHeight: 36, flexBasis: "100%", fontSize: 11 }}>Delivered</button> : o.type === "full" && !o.pipeReturned ? <button onClick={() => returnPipe(o.id)} style={{ ...styles.deliverBtn, minHeight: 30, marginLeft: "auto", padding: "0 10px", background: "#ece8df", borderColor: "#d8d4cb", color: "#0a0a0a", fontSize: 9 }}>Return pipe</button> : <span style={{ marginLeft: "auto", fontSize: 9, color: "#16a34a", fontWeight: 800 }}>✓ Complete</span>}
                      {o.status !== "delivered" && (orderDeleteConfirmId === o.id ? (
                  <div style={{ ...styles.orderDeleteConfirm, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10 }}>Cancel this order?</span>
                    <button disabled={cancellingOrderId !== null} onClick={() => cancelUndelivered(o)} style={styles.orderDeleteYes}>{cancellingOrderId === o.id ? "Cancelling…" : "Yes, cancel"}</button>
                    <button disabled={cancellingOrderId !== null} onClick={() => setOrderDeleteConfirmId(null)} style={styles.orderDeleteNo}>Keep order</button>
                  </div>
                ) : <button disabled={!CANCELLATION_ENABLED || o.pendingSync || cancellingOrderId !== null} title={!CANCELLATION_ENABLED ? "Cancellation is awaiting activation" : undefined} onClick={() => setOrderDeleteConfirmId(o.id)} style={{ ...styles.orderDeleteNo, opacity: !CANCELLATION_ENABLED || o.pendingSync ? 0.5 : 1 }}>{o.pendingSync ? "Sync to cancel" : "Cancel order"}</button>)}
                      {isAdmin && o.status === "delivered" && (orderDeleteConfirmId === o.id ? (
                        <div style={{ ...styles.orderDeleteConfirm, flexBasis: "100%" }}>
                          <span style={{ marginRight: "auto", fontSize: 10, color: "#991b1b", fontWeight: 800 }}>Delete this order permanently?</span>
                          <button onClick={() => { removeOrder(o); setOrderDeleteConfirmId(null); }} style={styles.orderDeleteYes}>Delete</button>
                          <button onClick={() => setOrderDeleteConfirmId(null)} style={styles.orderDeleteNo}>Cancel</button>
                        </div>
                      ) : <button onClick={() => setOrderDeleteConfirmId(o.id)} style={{ ...styles.deleteBtn, minWidth: 0, minHeight: 30, padding: "0 10px", borderRadius: 7, fontSize: 9 }}>Delete</button>)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {visibleTab === "management" && (() => {
            const todayStr = localToday();
            const isViewingToday = managementDateFrom === todayStr && managementDateTo === todayStr;
            const [ffh, ffm] = managementTimeFrom.split(":").map(Number);
            const [fth, ftm] = managementTimeTo.split(":").map(Number);
            const fromMin = ffh * 60 + ffm;
            const toMin   = fth * 60 + ftm;
            const displayOrders = isViewingToday ? orders.filter(o => {
                  const t = o.time instanceof Date ? o.time : new Date(o.time);
                  const m = t.getHours() * 60 + t.getMinutes();
                  return m >= fromMin && m <= toMin;
                })
              : managementOrders;
            const displayTotals = displayOrders.reduce((acc, o) => {
              acc.gross += o.price;
              if (o.payment === "card") acc.card += o.price; else acc.cash += o.price;
              return acc;
            }, { gross: 0, card: 0, cash: 0 });
            const displayExpenses = expenses.filter(e => {
              const d = new Date(e.time);
              const eDate = [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
              return eDate >= managementDateFrom && eDate <= managementDateTo;
            });
            const mgmtDateLabel = isViewingToday ? todayLabel
              : managementDateFrom === managementDateTo ? formatSessionDate(managementDateFrom)
              : `${formatSessionDate(managementDateFrom)} – ${formatSessionDate(managementDateTo)}`;

            return (
            <div key="management" className="tab-enter theme-page-surface" style={styles.settingsPanel}>
              <div className="management-date-presets" role="group" aria-label="Date presets">
                {["Today", "Yesterday", "7 Days", "Month"].map(preset => {
                  const active = presetIsActive(preset, managementPreset, managementDateFrom, managementDateTo, managementTimeFrom, managementTimeTo);
                  return <button className="date-preset" aria-pressed={active} key={preset} onClick={() => {
                    const range = presetRange(preset);
                    setManagementPreset(preset);
                    setManagementDateFrom(range.from); setManagementDateTo(range.to); setManagementTimeFrom("00:00"); setManagementTimeTo("23:59");
                  }} style={{ border: "1px solid rgba(10,10,10,0.08)", background: active ? "#0a0a0a" : "rgba(255,255,255,0.7)", color: active ? "#fff" : "#6c6a65", borderRadius: 10, padding: "9px 4px", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{preset}</button>;
                })}
              </div>
              <div className="management-inline-range">
                <label className="management-range-date"><span>From</span><span className="management-date-value">{formatDateShort(managementDateFrom)}<input aria-label="From date" type="date" value={managementDateFrom} max={managementDateTo} onChange={event=>{if(event.target.value)setManagementDateFrom(event.target.value);}} /></span></label>
                <span className="management-range-arrow" aria-hidden="true">→</span>
                <label className="management-range-date"><span>To</span><span className="management-date-value">{formatDateShort(managementDateTo)}<input aria-label="To date" type="date" value={managementDateTo} min={managementDateFrom} max={todayStr} onChange={event=>{if(event.target.value)setManagementDateTo(event.target.value);}} /></span></label>
                <details className="management-time-filter"><summary aria-label="Edit time range" title="Edit time range">◷</summary><div><label>From time<input aria-label="From time" type="time" value={managementTimeFrom} onChange={event=>{if(event.target.value)setManagementTimeFrom(event.target.value);}} /></label><label>To time<input aria-label="To time" type="time" value={managementTimeTo} onChange={event=>{if(event.target.value)setManagementTimeTo(event.target.value);}} /></label></div></details>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, padding: 5, borderRadius: 13, background: "rgba(255,255,255,0.62)", border: "1px solid rgba(10,10,10,0.06)" }}>
                {[{ id: "overview", label: "Overview" }, { id: "finance", label: "Finance" }].map(view => (
                  <button role="tab" aria-selected={managementView === view.id} key={view.id} onClick={() => setManagementView(view.id)} style={{ border: 0, borderRadius: 9, minHeight: 38, background: managementView === view.id ? "#0a0a0a" : "transparent", color: managementView === view.id ? "#fff" : "#6c6a65", fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>{view.label}</button>
                ))}
              </div>


              {managementView === "finance" ? (
                <FinancePanel
                  users={users}
                  stock={stock}
                  expenses={displayExpenses}
                  allExpenses={expenses}
                  onExpenseStatus={async (expense, status) => {
                    await transitionExpense(expense, status);
                    const [latest, journal] = await Promise.all([fetchExpenses(), fetchFinanceJournal()]);
                    if (!latest || !journal) throw new Error('Saved. Refresh to load the updated records.');
                    setExpenses(latest); setFinanceJournal(journal);
                  }}
                  revenue={displayTotals.gross}
                  journal={financeJournal}
                  periodLabel={mgmtDateLabel}
                  dateFrom={managementDateFrom}
                  dateTo={managementDateTo}
                  isAdmin={isAdmin}
                  currentUserId={activeUser.id}
                  canViewReceipts={['Admin','Manager'].includes(activeUser.role)}
                  onExpense={async expense => {
                    const now = new Date();
                    const time = expense.date === localToday() ? now : new Date(`${expense.date}T12:00:00+02:00`);
                    const record = { id: createOrderId(), category: expense.category, qty: null, amount: expense.amount, time: time.toISOString(), shiftId: null, description: expense.description, paidBy: expense.paidBy || null, stockQuantities: expense.stockQuantities ?? {} };
                    if (expense.receipt) record.receiptPath = await uploadReceipt(expense.receipt, activeUser.id);
                    await saveExpenseRecord(record);
                    const latestStock = await fetchStock(); if (latestStock) setStock(latestStock);
                    const latestExpenses = await fetchExpenses(); if (latestExpenses) setExpenses(latestExpenses);
                  }}
                  onExpenseUpdate={async (original, changes) => {
                    await saveExpenseRecord({ ...original, ...changes }, original);
                    const latestStock = await fetchStock(); if (latestStock) setStock(latestStock);
                    const latestExpenses = await fetchExpenses(); if (latestExpenses) setExpenses(latestExpenses);
                  }}
                  onExpenseDelete={async expense => {
                    await deleteExpenseRecord(expense);
                    const latestStock = await fetchStock(); if (latestStock) setStock(latestStock);
                    setExpenses(current => current.filter(item => item.id !== expense.id));
                  }}
                  onManualSale={async sale => {
                    const saved = await addManualSale(sale);
                    if (saved) setFinanceJournal(current => ({ ...current, manualSales: [saved, ...(current.manualSales ?? [])] }));
                    return !!saved;
                  }}
                  onTransaction={async transaction => {
                    const saved = await addFinanceTransaction(transaction);
                    if (saved) setFinanceJournal(current => ({ ...current, transactions: [saved, ...current.transactions] }));
                    return !!saved;
                  }}
                  onLockChange={async date => {
                    if (await setFinanceLock(date)) setFinanceJournal(current => ({ ...current, lockedThrough: date || null }));
                  }}
                />
              ) : <ManagementOverview manualSales={financeJournal.manualSales ?? []} orders={displayOrders} expenses={expenses} from={managementDateFrom} to={managementDateTo} timeFrom={managementTimeFrom} timeTo={managementTimeTo} loading={managementLoading} />}

            </div>
            );

          })()}
          {visibleTab === "stock" && (() => {
            const needsAttention = (item) => item.subItems
              ? item.subItems.some(subItem => subItem.quantity <= item.lowThreshold)
              : item.quantity <= item.lowThreshold;
            const categoryMatches = (item) => stockCategory === "All"
              || (stockCategory === "Attention" ? needsAttention(item)
                : stockCategory === "Fixed Assets" ? item.category === "equipment"
                  : stockCategory === "Flavours" ? item.name === "Flavour"
                    : item.category === "consumable" && item.name !== "Flavour");
            const equipment   = isAdmin ? stock.filter(i => i.category === "equipment" && categoryMatches(i)) : [];

            // Flatten all trackable items (including flavour sub-items) for summary
            const allFlatItems = stock.flatMap(i => {
              if (i.subItems) return i.subItems.map(s => ({ ...s, lowThreshold: i.lowThreshold, unit: "boxes", parentName: i.name }));
              return [i];
            });
            const outItems = allFlatItems.filter(i => i.quantity === 0);
            const lowItems = allFlatItems.filter(i => i.quantity > 0 && i.quantity <= i.lowThreshold);
            const lowCount = outItems.length + lowItems.length;
            const weekendPlan = planWeekend(stock, stockPlanningOrders, { Coal: COAL_PER_SALE, "Mouth Pieces": MOUTHPIECES_PER_SALE, flavours: FLAVOUR_PER_SALE }, RESTOCK_PACK);
            const purchasePlan = weekendPlan.items;
            const buySoonCount = purchasePlan.filter(item => item.buy > 0).length;


            const toggleStockExpand = (id) => setExpandedStockIds(prev => {
              const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
            });


            const renderItem = (item) => {
              // Sub-items (e.g. Flavour with individual flavour quantities)
              if (item.subItems) {
                const totalQty = item.subItems.reduce((s, f) => s + f.quantity, 0);
                const anyOut   = item.subItems.some(f => f.quantity === 0);
                const anyLow   = !anyOut && item.subItems.some(f => f.quantity <= item.lowThreshold);
                const isOpen   = expandedStockIds.has(item.id);
                const rowStyle = anyOut ? styles.stockRowCritical : anyLow ? styles.stockRowLow : styles.stockRow;
                return (
                  <div key={item.id}>
                    <div className="frosted-card" style={{ ...rowStyle, cursor: "pointer" }} onClick={() => toggleStockExpand(item.id)}>
                      <div style={styles.stockInfo}>
                        <span style={styles.stockName} className="stock-item-name"><StockItemPhoto name={item.name} />{item.name}</span>
                        <div style={styles.stockMeta}>
                          <span style={styles.stockUnit}>{Number.isInteger(totalQty) ? totalQty : totalQty.toFixed(2)} {item.unit} total</span>
                          {anyOut && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Out of stock</span>}
                          {anyLow && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}>Low</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "#8c8982", fontWeight: 700, marginRight: 4 }}>{isOpen ? "▲ Hide" : "▼ Show"}</span>
                    </div>
                    {isOpen && (
                      <div style={styles.subItemList}>
                        {item.subItems.map(f => {
                          const fOut = f.quantity === 0;
                          const fLow = !fOut && f.quantity <= item.lowThreshold;
                          return (
                            <div key={f.id} style={styles.subItemRow}>
                              <span className="flavour-label"><FlavourThumbnail flavour={f} compact /><span>{f.name}</span></span>
                              {fOut && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: 9 }}>Out</span>}
                              {fLow && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", fontSize: 9 }}>Low</span>}

                              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                                    {(() => {
                                      const perSale = FLAVOUR_PER_SALE[f.id];
                                      if (!perSale) return <span style={{ fontSize: 12, color: "#8c8982" }}>{f.quantity.toFixed(2)} bx</span>;
                                      const qty = Math.round(f.quantity * 1000) / 1000;
                                      if (qty === 0) return (
                                        <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 800 }}>0 orders</span>
                                      );
                                      return <>
                                        <span style={{ fontSize: 10, fontWeight: 800, color: "#0a0a0a", whiteSpace: "nowrap" }}>
                                          {qty.toFixed(2)} boxes
                                        </span>
                                        <span style={{ fontSize: 9, fontWeight: 800, color: f.color, background: f.bg, padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                          ≈ {Math.floor(qty / perSale)} orders
                                        </span>
                                      </>;
                                    })()}
                                  </div>
                                  <div style={styles.stockControls} onClick={event => event.stopPropagation()}>
                                    <button aria-label={`Remove one box of ${f.name}`} onClick={() => setStock(prev => prev.map(stockItem => stockItem.id === item.id ? { ...stockItem, subItems: stockItem.subItems.map(subItem => subItem.id === f.id ? { ...subItem, quantity: Math.max(0, subItem.quantity - 1) } : subItem) } : stockItem))} style={styles.stockBtnMinus}>−</button>
                                    <button aria-label={`Add one box of ${f.name}`} onClick={() => setStock(prev => prev.map(stockItem => stockItem.id === item.id ? { ...stockItem, subItems: stockItem.subItems.map(subItem => subItem.id === f.id ? { ...subItem, quantity: subItem.quantity + 1 } : subItem) } : stockItem))} style={styles.stockBtnPlus}>+</button>
                                  </div>
                                </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const isOut = item.quantity === 0;
              const isLow = !isOut && item.quantity <= item.lowThreshold;
              const rowStyle = isOut ? styles.stockRowCritical : isLow ? styles.stockRowLow : styles.stockRow;
              const pack = RESTOCK_PACK[item.name];
              const perOrder = item.name === "Coal" ? COAL_PER_SALE : item.name === "Mouth Pieces" ? MOUTHPIECES_PER_SALE : null;
              const orderCapacity = perOrder ? Math.floor(item.quantity / perOrder) : null;

              if (item.category === "equipment" && editingEquipmentId === item.id) {
                const saveEquipment = async () => {
                  if (equipmentSaveRunning.current) return;
                  const name = equipmentDraft.name.trim();
                  const quantity = Math.max(0, Number(equipmentDraft.quantity));
                  const lowThreshold = Math.max(0, Number(equipmentDraft.lowThreshold));
                  if (!name || !Number.isFinite(quantity) || !Number.isFinite(lowThreshold)) return;
                  const updatedItem = { ...item, name, quantity, lowThreshold };
                  equipmentSaveRunning.current = true;
                  setEquipmentSaving(true); setEquipmentSaveError("");
                  try {
                    await saveEquipmentChange(updatedItem, updateStockItem, saved => {
                      setStock(prev => prev.map(stockItem => stockItem.id === item.id ? saved : stockItem));
                      setEditingEquipmentId(null);
                    });
                  } catch {
                    recordDiagnostic('save_failed','equipment_save_failed');
                    setEquipmentSaveError("Could not save. Your changes are still here. Check your connection and try again.");
                  } finally { equipmentSaveRunning.current = false; setEquipmentSaving(false); }
                };

                return (
                  <div className="frosted-card" key={item.id} style={{ ...rowStyle, alignItems: "stretch", flexDirection: "column" }}>
                    <label style={styles.equipmentEditField}>
                      <span>Name</span>
                      <input disabled={equipmentSaving} value={equipmentDraft.name} onChange={(event) => setEquipmentDraft(draft => ({ ...draft, name: event.target.value }))} style={styles.equipmentEditInput} />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <label style={styles.equipmentEditField}>
                        <span>Quantity</span>
                        <input disabled={equipmentSaving} type="number" min="0" value={equipmentDraft.quantity} onChange={(event) => setEquipmentDraft(draft => ({ ...draft, quantity: event.target.value }))} style={styles.equipmentEditInput} />
                      </label>
                      <label style={styles.equipmentEditField}>
                        <span>Low-stock alert</span>
                        <input disabled={equipmentSaving} type="number" min="0" value={equipmentDraft.lowThreshold} onChange={(event) => setEquipmentDraft(draft => ({ ...draft, lowThreshold: event.target.value }))} style={styles.equipmentEditInput} />
                      </label>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {equipmentSaveError && <p role="alert" style={{gridColumn:"1 / -1",color:"#b91c1c",fontSize:12}}>{equipmentSaveError}</p>}
                      <button disabled={equipmentSaving} onClick={() => { setEditingEquipmentId(null); setEquipmentSaveError(""); }} style={styles.equipmentCancelBtn}>Cancel</button>
                      <button disabled={equipmentSaving} onClick={saveEquipment} style={styles.equipmentSaveBtn}>{equipmentSaving ? "Saving…" : "Save changes"}</button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="frosted-card" key={item.id} style={rowStyle}>
                  <div style={styles.stockInfo}>
                    <span style={styles.stockName} className="stock-item-name"><StockItemPhoto name={item.name} />{item.name}</span>
                    <div style={styles.stockMeta}>
                      <span style={styles.stockUnit}>{item.unit}</span>
                      {orderCapacity !== null && <span style={{ ...styles.stockUnit, color: orderCapacity <= 5 ? "#dc2626" : "#047857", fontWeight: 800 }}>· ≈ {orderCapacity} orders</span>}
                      {pack && (
                        <span style={{ ...styles.stockUnit, color: "#8c8982" }}>
                          · {Math.floor(item.quantity / pack.size)} {pack.plural} + {item.quantity % pack.size} pcs
                        </span>
                      )}
                      {isOut && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Out of stock</span>}
                      {isLow && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}>Low</span>}
                    </div>
                  </div>

                  <span style={styles.stockQty}>{item.quantity}</span>
                  {item.category !== "equipment" && (
                    <div style={styles.stockControls}>
                      <button aria-label={`Remove one ${item.unit} of ${item.name}`} onClick={() => setStock(prev => prev.map(stockItem => stockItem.id === item.id ? { ...stockItem, quantity: Math.max(0, stockItem.quantity - 1) } : stockItem))} style={styles.stockBtnMinus}>−</button>
                      <button aria-label={`Add one ${item.unit} of ${item.name}`} onClick={() => setStock(prev => prev.map(stockItem => stockItem.id === item.id ? { ...stockItem, quantity: stockItem.quantity + 1 } : stockItem))} style={styles.stockBtnPlus}>+</button>
                    </div>
                  )}
                  {item.category === "equipment" && (
                    <button
                      onClick={() => {
                        setEditingEquipmentId(item.id);
                        setEquipmentBaseline({ name: item.name, quantity: String(item.quantity), lowThreshold: String(item.lowThreshold) });
                        setEquipmentDraft({ name: item.name, quantity: String(item.quantity), lowThreshold: String(item.lowThreshold) });
                      }}
                      style={styles.equipmentEditBtn}
                      aria-label={`Edit ${item.name}`}
                    >
                      Edit
                    </button>
                  )}

                </div>
              );
            };

            return (
              <div key="stock" className="tab-enter theme-page-surface" style={styles.stockPanel}>
                <div role="tablist" aria-label="Stock sections" style={{ display: "grid", gridTemplateColumns: isAdmin ? "1fr 1fr" : "1fr", gap: 5, padding: 5, borderRadius: 13, background: "rgba(255,255,255,0.62)", border: "1px solid rgba(10,10,10,0.06)" }}>
                  {[...(isAdmin ? [{ id: "overview", label: "Overview" }] : []), { id: "taking", label: "Stock Taking" }].map(view => (
                    <button role="tab" aria-selected={(isAdmin ? stockView : "taking") === view.id} aria-controls={`stock-${view.id}`} id={`stock-tab-${view.id}`} key={view.id} onClick={() => setStockView(view.id)} style={{ border: 0, borderRadius: 9, minHeight: 38, background: (isAdmin ? stockView : "taking") === view.id ? "#0a0a0a" : "transparent", color: (isAdmin ? stockView : "taking") === view.id ? "#fff" : "#6c6a65", fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>{view.label}</button>
                  ))}
                </div>
                <div role="tabpanel" id="stock-taking" aria-labelledby="stock-tab-taking" style={{ display: !isAdmin || stockView === "taking" ? "block" : "none" }}>
                <StockTaking isAdmin={isAdmin} stock={stock} pendingOrders={pendingOrderCount} refreshStock={async () => {
                  const latest = await fetchStock();
                  if (latest) setStock(latest);
                  return latest;
                }} />
                </div>
                {isAdmin && <div role="tabpanel" id="stock-overview" aria-labelledby="stock-tab-overview" style={{ display: stockView === "overview" ? "flex" : "none", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                  {["Attention", "All", "Flavours", "Consumables", ...(isAdmin ? ["Fixed Assets"] : [])].map((category) => <button key={category} onClick={() => setStockCategory(category)} style={{ border: "1px solid rgba(10,10,10,0.08)", background: stockCategory === category ? "#0a0a0a" : "rgba(255,255,255,0.7)", color: stockCategory === category ? "#fff" : "#6c6a65", borderRadius: 20, padding: "7px 11px", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{category}</button>)}
                </div>

                {stockCategory === "Attention" && lowCount === 0 && <div style={{ ...styles.emptyState, color: "#15803d", background: "#f0fdf4", borderColor: "#bbf7d0" }}>✓ Nothing needs attention. Stock levels are healthy.</div>}



                <div className="purchase-planner" style={styles.purchasePlanner}>
                  <div style={styles.purchasePlannerHeader}>
                    <div>
                      <span style={styles.stockCategoryHeader}>Purchase planner</span>
                      <strong style={styles.purchasePlannerTitle}>{!weekendPlan.first ? "Sales history needed" : buySoonCount ? `${buySoonCount} item${buySoonCount === 1 ? "" : "s"} to buy for Fri–Tue` : "Stock covers Fri–Tue"}</strong>
                    </div>
                    <span style={styles.purchasePlannerTarget}>Fri–Tue</span>
                  </div>
                  {!weekendPlan.first ? (
                    <div style={{ color: "#6c6a65", fontSize: 11, fontWeight: 700 }}>Recommendations will appear after a completed day of sales is available.</div>
                  ) : (
                    <div style={styles.purchasePlanList}>
                      {purchasePlan.map(item => {
                        const urgent = item.buy > 0 && item.quantity <= 0;
                        const soon = item.buy > 0;
                        const tone = urgent ? "#dc2626" : soon ? "#b45309" : "#15803d";
                        return (
                          <div key={item.id} style={styles.purchasePlanRow}>
                            <span style={styles.purchasePlanIcon}>{FLAVOURS.some(f => f.name === item.name) ? <FlavourThumbnail flavour={item} compact /> : <StockItemPhoto name={item.name} fallback={item.icon} />}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <strong style={{ display: "block", color: "#0a0a0a", fontSize: 11 }}>{item.name}</strong>
                              <small style={{ display: "block", marginTop: 2, color: "#6c6a65", fontSize: 9, fontWeight: 700 }}>
                                {`Need ${item.needed.toFixed(1)} ${item.unit} · Have ${Number(item.quantity).toFixed(1)}`}
                              </small>
                            </span>
                            <span style={{ textAlign: "right" }}>
                              <strong style={{ display: "block", color: tone, fontSize: 11 }}>{item.buy > 0 ? `Buy ${item.buy}` : "No purchase"}</strong>
                              <small style={{ color: "#8c8982", fontSize: 8, fontWeight: 800 }}>{item.buy > 0 ? `${item.buy === 1 ? ({ boxes: "box", packs: "pack", pieces: "piece" }[item.purchaseUnit] ?? item.purchaseUnit) : item.purchaseUnit}${item.packSize > 1 ? ` · ${item.purchaseQuantity} ${item.unit}` : ""}` : "Stock sufficient"}</small>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <span style={styles.purchasePlannerNote}>{formatDateShort(weekendPlan.from)}–{formatDateShort(weekendPlan.to)} · About {Math.ceil(weekendPlan.forecast)} orders. Based on {weekendPlan.totalDays} completed calendar days; same-weekday averages include days with no recorded sales. {weekendPlan.limited ? "Limited history: estimates use the overall daily average for weekdays not yet observed." : ""}</span>
                </div>

                {equipment.length > 0 && (
                  <>
                    <button onClick={() => setEquipmentCollapsed(c => !c)} style={styles.collapsibleHeader}>
                      <span>🛠️ Fixed Assets <span style={{ fontSize: 11, color: "#8c8982", fontWeight: 600 }}>({equipment.length})</span></span>
                      <span style={styles.collapseChevron}>{equipmentCollapsed ? "▶" : "▼"}</span>
                    </button>
                    {!equipmentCollapsed && <div className="expand-down" style={styles.stockList}>{equipment.map((item, i) => <div key={item.id} className={`card-enter d-${Math.min(i, 6)}`}>{renderItem(item)}</div>)}</div>}
                  </>
                )}


                </div>}
              </div>
            );
          })()}

          {visibleTab === "settings" && (
            <div key="settings" className={`tab-enter theme-page-surface ${isAdmin ? "admin-settings" : ""}`} style={styles.settingsPanel}>
              {/* ── Staff view: only their own profile ── */}
              {!isAdmin && (
                <>
                  <div style={styles.settingsSectionLabel}>My Profile</div>
                  <div className="frosted-card" style={styles.userCard}>
                    <div style={styles.userRow}>
                      <div style={styles.userAvatar}>
                        {activeUser.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={styles.userMeta}>
                        <strong style={styles.userName}>{activeUser.name}</strong>
                        <span style={styles.userRole}>{activeUser.role}</span>
                      </div>
                    </div>
                    <div style={styles.userPermissions}>
                      {[
                        { key: "pos",       label: "POS",             always: true },
                        { key: "delivered", label: "Orders Delivered", always: false },
                        { key: "stock",     label: "Stock",            always: false },
                        { key: "management",label: "Management",       always: false },
                        { key: "settings",  label: "Settings",         always: false },
                      ].map(({ key, label, always }) => {
                        const allowed = always || (currentUserPerms[key] ?? false);
                        return (
                          <span
                            key={key}
                            style={{ ...styles.permissionPill, ...(allowed ? styles.permissionPillOn : {}), cursor: "default" }}
                          >
                            {allowed ? "✓" : "✕"} {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* ── Admin view: full settings ── */}
              {isAdmin && <>

              <nav className="admin-settings-tabs admin-settings-three-tabs" aria-label="Settings sections">
                {[['team','Staff'],['security','Security'],['business','Business']].map(([key,label])=><button type="button" key={key} aria-current={settingsSection===key ? 'page' : undefined} onClick={()=>setSettingsSection(key)}><SettingsIcon name={key} /><span>{label}</span></button>)}
              </nav>

              {/* Users section — collapsible */}
              {settingsSection === "team" && <>
              <div className="admin-section-heading"><h2>Staff</h2><button type="button" aria-expanded={showAddStaff} onClick={()=>setShowAddStaff(value=>!value)}>{showAddStaff ? 'Close form' : '＋ Add staff'}</button></div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="search" value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="Search name or username" style={{ ...styles.userNameInput, flex: 1 }} />
                <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ ...styles.userRoleSelect, width: 124 }}>
                  {['All', 'Staff', 'Manager', 'Admin', 'Suspended'].map((filter) => <option key={filter}>{filter}</option>)}
                </select>
              </div>
              {(
                <div className="expand-down" style={styles.userList}>
                  {visibleUsers.map((u, ui) => {
                    const isExpanded = expandedUsers.has(u.id);
                    return (
                    <div key={u.id} className={`card-enter frosted-card admin-staff-card d-${Math.min(ui, 6)}`} style={{ ...styles.userCard, opacity: u.paused ? 0.55 : 1 }}>
                      <button type="button" className="admin-staff-row" aria-expanded={isExpanded} onClick={() => toggleUserExpanded(u.id)}>
                        <div style={{ ...styles.userAvatar, background: u.paused ? "#8c8982" : undefined }}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={styles.userMeta}>
                          <strong style={styles.userName}>{u.name}</strong>
                          <span style={styles.userRole}>{u.username ? `@${u.username} · ` : ""}{u.role}</span>
                        </div>
                        <span className={`admin-staff-status ${u.paused ? 'is-paused' : ''}`}><i />{u.paused ? 'Paused' : 'Active'}</span>
                        <span className="admin-staff-chevron" aria-hidden="true">{isExpanded ? '⌃' : '›'}</span>
                      </button>
                      {isExpanded && (
                        <div className="expand-down admin-staff-expanded">
                          <div className="admin-access-heading"><span className="admin-access-label">Access</span>{staffSave.id===u.id && <span className={`admin-save-feedback ${staffSave.status}`} role={staffSave.status==='error' ? 'alert' : 'status'}>{staffSave.message}</span>}</div>
                          <div className="admin-access-grid" style={styles.userPermissions}>
                            <span style={{ ...styles.permissionPill, ...styles.permissionPillAlwaysOn }}>
                              POS<span className="admin-permission-locked">Always on</span>
                            </span>
                            {u.role !== "Admin" && [
                              { key: "delivered", label: "Orders" },
                              { key: "stock",     label: "Stock" },
                              { key: "management",label: "Management" },
                              { key: "settings",  label: "Settings" },
                            ].map(({ key, label }) => {
                              const allowed = u.permissions?.[key] ?? false;
                              return isAdmin ? (
                                <button
                                  key={key}
                                  role="switch" aria-checked={allowed} aria-label={label}
                                  disabled={staffSave.status==='saving'}
                                  onClick={()=>saveStaffAccess(u,{permissions:{...u.permissions,[key]:!allowed}})}
                                  style={{ ...styles.permissionPill, ...(allowed ? styles.permissionPillOn : {}) }}
                                >
                                  {label}<span className={`admin-permission-switch ${allowed ? "is-on" : ""}`} aria-hidden="true" />
                                </button>
                              ) : (
                                <span
                                  key={key}
                                  style={{ ...styles.permissionPill, ...(allowed ? styles.permissionPillOn : {}), cursor: "default" }}
                                >
                                  {label}<span className={`admin-permission-switch ${allowed ? "is-on" : ""}`} aria-hidden="true" />
                                </span>
                              );
                            })}
                            {u.role === "Admin" && [
                              { key: "delivered", label: "Orders" },
                              { key: "stock",     label: "Stock" },
                              { key: "management",label: "Management" },
                              { key: "settings",  label: "Settings" },
                            ].map(({ key, label }) => (
                              <span key={key} style={{ ...styles.permissionPill, ...styles.permissionPillAlwaysOn }}>
                                {label}<span className="admin-permission-locked">Always on</span>
                              </span>
                            ))}
                          </div>
                          <div className="admin-staff-actions">
                        {isAdmin && (
                          deleteConfirmId === u.id ? (
                            <div style={styles.deleteConfirmRow}>
                              <span style={styles.deleteConfirmLabel}>Delete {u.name}’s account?</span>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try { await manageStaff("delete", { userId: u.id }); setUsers((prev) => prev.filter((x) => x.id !== u.id)); setStaffMessageType("success"); setStaffMessage("User deleted."); }
                                  catch (error) { setStaffMessageType("error"); setStaffMessage(error.message); }
                                  setDeleteConfirmId(null);
                                }}
                                style={styles.deleteConfirmYes}
                              >Yes</button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                style={styles.deleteConfirmNo}
                              >No</button>
                            </div>
                          ) : (
                            <div className="admin-account-buttons">
                              <button
                                onClick={() => { setResetPinId(resetPinId === u.id ? null : u.id); setResetPinValue(""); setPasswordError(''); }}
                                disabled={passwordBusy}
                                style={{ ...styles.userDeleteBtn, fontSize: 14, padding: "2px 9px", borderRadius: 8 }}
                                className="admin-account-password" title="Change password"
                              >Change password</button>
                              {u.id !== activeUser?.id && (
                                <button
                                  disabled={staffSave.status==='saving'} onClick={()=>saveStaffAccess(u,{paused:!u.paused})}
                                  style={{ ...styles.userDeleteBtn, background: u.paused ? "rgba(22,163,74,0.1)" : "rgba(234,179,8,0.12)", color: u.paused ? "#16a34a" : "#b45309", borderColor: u.paused ? "rgba(22,163,74,0.25)" : "rgba(234,179,8,0.3)", fontSize: 15, padding: "2px 9px", borderRadius: 8 }}
                                  className="admin-account-pause" title={u.paused ? "Unpause" : "Pause"}
                                >
                                  {u.paused ? "Resume access" : "Pause access"}
                                </button>
                              )}
                              <div className="admin-account-more"><span>Account actions</span><button type="button" aria-label={`More actions for ${u.name}`} aria-expanded={staffMoreId===u.id} onClick={()=>setStaffMoreId(staffMoreId===u.id ? null : u.id)}>•••</button></div>
                              {staffMoreId===u.id && <button
                                className="admin-account-delete" onClick={() => setDeleteConfirmId(u.id)}
                                style={styles.userDeleteBtn}
                              >
                                Delete account
                              </button>}
                            </div>
                          )
                        )}

                          </div>
                          {resetPinId === u.id && <div className="admin-password-form">
                            <label htmlFor={`staff-password-${u.id}`}>New password</label>
                            <input id={`staff-password-${u.id}`} type="password" autoComplete="new-password" autoFocus placeholder="At least 10 characters" disabled={passwordBusy} value={resetPinValue} onChange={event=>{setResetPinValue(event.target.value);setPasswordError('');}} onKeyDown={event=>{if(event.key==='Enter')saveStaffPassword(u);if(event.key==='Escape'&&!passwordBusy){setResetPinId(null);setResetPinValue('');}}} />
                            {passwordError && <p role="alert">{passwordError}</p>}
                            <div><button disabled={passwordBusy} onClick={()=>{setResetPinId(null);setResetPinValue('');}}>Cancel</button><button disabled={passwordBusy || resetPinValue.length<10} onClick={()=>saveStaffPassword(u)}>{passwordBusy ? 'Updating…' : 'Update password'}</button></div>
                          </div>}
                        </div>
                      )}
                    </div>
                  ); })}
                  {visibleUsers.length === 0 && (
                    <div style={styles.emptyState}>No users match this search</div>
                  )}
                </div>
              )}

              {isAdmin && showAddStaff && (
                <div className="card-enter" style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 10px 30px rgba(10,10,10,0.06)" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: "#0a0a0a" }}>Add staff</div>
                    <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.5, color: "#6c6a65" }}>Create secure login details and choose what this person can access.</div>
                  </div>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Full name</span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="e.g. Thabo Mokoena"
                      value={newUserName}
                      onChange={(e) => { setNewUserName(e.target.value); setStaffMessage(""); }}
                      style={{ ...styles.userNameInput, flex: "none", width: "100%" }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Username</span>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#8c8982", fontWeight: 800 }}>@</span>
                      <input
                        type="text"
                        autoComplete="off"
                        maxLength={32}
                        placeholder="thabo"
                        value={newUsername}
                        onChange={(e) => { setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "")); setStaffMessage(""); }}
                        style={{ ...styles.userNameInput, flex: "none", width: "100%", paddingLeft: 30 }}
                      />
                    </div>
                    <span style={{ fontSize: 10, color: newUsername && !usernameIsValid ? "#dc2626" : "#6c6a65" }}>
                      3–32 characters · letters, numbers, dots, dashes or underscores
                    </span>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Access level</span>
                    <select
                      value={newUserRole}
                      onChange={(e) => { setNewUserRole(e.target.value); setStaffMessage(""); }}
                      style={{ ...styles.userRoleSelect, width: "100%" }}
                    >
                      <option value="Staff">Staff · POS and orders</option>
                      <option value="Manager">Manager · Stock and management</option>
                      <option value="Admin">Admin · Full access</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Temporary password</span>
                    <div style={{ position: "relative" }}>
                      <input
                        id="new-user-pin"
                        type={showNewUserPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="At least 10 characters"
                        value={newUserPin}
                        onChange={(e) => { setNewUserPin(e.target.value); setStaffMessage(""); }}
                        style={{ ...styles.userNameInput, width: "100%", paddingRight: 64 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewUserPassword((show) => !show)}
                        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: "#6c6a65", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                      >{showNewUserPassword ? "Hide" : "Show"}</button>
                    </div>
                    <span style={{ fontSize: 10, color: newUserPin && !passwordIsValid ? "#dc2626" : "#6c6a65" }}>
                      Minimum 10 characters. Share it privately with the new user.
                    </span>
                  </label>

                  {staffMessage && (
                    <div style={{ ...styles.loginErrorMsg, background: staffMessageType === "success" ? "rgba(22,163,74,0.1)" : undefined, color: staffMessageType === "success" ? "#15803d" : undefined, borderColor: staffMessageType === "success" ? "rgba(22,163,74,0.2)" : undefined }}>
                      {staffMessage}
                    </div>
                  )}

                  <button
                    disabled={!addUserFormIsValid || addingUser}
                    onClick={async () => {
                      if (!addUserFormIsValid || addingUser) return;
                      setAddingUser(true); setStaffMessage("");
                      try {
                        await manageStaff("create", { name: newUserName.trim(), username: newUsername, password: newUserPin, role: newUserRole });
                        const refreshed = await fetchUsers();
                        if (refreshed) setUsers(refreshed);
                        setNewUserName(""); setNewUsername(""); setNewUserPin(""); setNewUserRole("Staff"); setShowNewUserPassword(false);
                        setStaffMessageType("success"); setStaffMessage("User created. They can now sign in with their username.");
                      } catch (error) {
                        setStaffMessageType("error"); setStaffMessage(error.message);
                      } finally { setAddingUser(false); }
                    }}
                    style={{ ...styles.addUserBtn, width: "100%", minHeight: 44, opacity: !addUserFormIsValid || addingUser ? 0.5 : 1, cursor: !addUserFormIsValid || addingUser ? "not-allowed" : "pointer" }}
                  >
                    {addingUser ? "Creating secure account…" : `Create ${newUserRole} account`}
                  </button>
                </div>
              )}
              </>}

              {settingsSection === "security" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={styles.settingsSectionLabel}>Security</div>
                  <div style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div><strong style={{ color: "#0a0a0a", fontSize: 14 }}>Change my password</strong><p style={{ margin: "4px 0 0", color: "#6c6a65", fontSize: 10, lineHeight: 1.5 }}>Use at least 10 characters. Your current password is required.</p></div>
                    <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setSecurityMessage(""); }} placeholder="Current password" style={{ ...styles.userNameInput, width: "100%" }} />
                    <input type="password" autoComplete="new-password" value={nextPassword} onChange={(e) => { setNextPassword(e.target.value); setSecurityMessage(""); }} placeholder="New password" style={{ ...styles.userNameInput, width: "100%" }} />
                    <button disabled={securityBusy || !currentPassword || nextPassword.length < 10} onClick={async () => {
                      setSecurityBusy(true); setSecurityMessage("");
                      try { await changeOwnPassword(currentPassword, nextPassword); setCurrentPassword(""); setNextPassword(""); setSecurityMessage("Password updated securely."); }
                      catch (error) { setSecurityMessage(error.message); }
                      finally { setSecurityBusy(false); }
                    }} style={{ ...styles.addUserBtn, minHeight: 42, opacity: securityBusy || !currentPassword || nextPassword.length < 10 ? 0.5 : 1 }}>
                      {securityBusy ? "Updating…" : "Update password"}
                    </button>
                    {securityMessage && <div style={styles.loginErrorMsg}>{securityMessage}</div>}
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 16, padding: 16 }}>
                    <strong style={{ color: "#0a0a0a", fontSize: 14 }}>Active sessions</strong>
                    <p style={{ color: "#6c6a65", fontSize: 10, lineHeight: 1.5 }}>Sign out this account on every device. You will need to sign in again.</p>
                    <button onClick={async () => { if (blocksSignOut(await getOfflineOrders(), activeUser?.id, saleRunning.current, orderSyncRunning.current)) {setSecurityMessage('Sync your queued sales before signing out.');return;} await signOutEverywhere(); setActiveUser(null); setUsers([]); setDbReady(false); }} style={{ width: "100%", minHeight: 42, border: "1px solid rgba(220,38,38,0.2)", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Sign out all devices</button>
                  </div>
                </div>
              )}

              {settingsSection === "business" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <PriceSettings prices={prices} onSave={async (next,expected)=>{await savePrices(next,expected);setPrices(next);}} />
                  <ProfitPartnerSettings users={users} partners={financeJournal.partners ?? []} onSave={async (partners,expected)=>{await saveFinancePartners(partners,expected);setFinanceJournal(current=>({...current,partners}));}} />
                  <section className="business-rules-card frosted-card"><h3>Business rules</h3>
                    {[['Payment methods','Cash and card'],['Coal usage',`${COAL_PER_SALE} pieces per order`],['Flavour & mouthpieces','Manual counts']].map(([name,value])=><div key={name}><span>{name}</span><strong>{value}</strong></div>)}
                  </section>
                  <details className="business-system"><summary>System</summary><div><span>Data sync</span><strong>{supabase?'Connected':'Not configured'}</strong></div><button className="admin-diagnostics" onClick={downloadDiagnostics} style={styles.copyBtn}>Download diagnostics</button></details>
                </div>
              )}
              </>}
            </div>
          )}
        </PullToRefresh>

        {visibleTab === "delivered" && <Pagination page={safePage+1} totalPages={totalDeliveredPages} onChange={page=>setDeliveredPage(page-1)} listRef={ordersListRef} label="Order pages" />}

        <footer className="app-footer" style={styles.footer}>
          <div style={styles.footerBar}>
          {[
            { key: "pos",        label: "POS",        icon: "pos",        badge: currentOrders.length,   access: true },
            { key: "delivered",  label: "Orders",     icon: "orders",     badge: deliveredOrders.length, access: canAccess("delivered") },
            { key: "stock",      label: "Stock",      icon: "stock",      badge: 0,                      access: canAccess("stock") },
            { key: "management", label: "Management", icon: "management", badge: 0,                      access: canAccess("management") },
          ].filter(t => t.access).map(t => {
            const active = visibleTab === t.key;
            return (
              <button className="bottom-nav-tab" aria-current={active ? "page" : undefined} key={t.key} onClick={() => setActiveTab(t.key)} style={{ ...styles.footerTab, background: "transparent", borderRadius: 14, padding: "6px 3px", flex: 1, transition: "color 140ms ease, background-color 140ms ease" }}>
                <div style={{ position: "relative", minHeight: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  <TabIcon name={t.icon} active={active} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: active ? "#0a0a0a" : "#6c6a65", whiteSpace: "nowrap" }}>{t.label}</span>
                  {t.badge > 0 && (
                    <span style={{ position: "absolute", top: -2, right: -8, minWidth: 16, height: 16, borderRadius: 999, background: active ? "#0a0a0a" : "rgba(255,255,255,0.15)", color: active ? "#fff" : "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{t.badge}</span>
                  )}
                </div>
              </button>
            );
          })}
          </div>
        </footer>
        </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "Arial, Helvetica, sans-serif",
    minHeight: "100dvh",
    padding: 0,
    background: "transparent",
    color: "#0a0a0a",
  },
  appChrome: {
    maxWidth: 430,
    height: "100dvh",
    margin: "0 auto",
    padding: "78px 10px 80px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "#f6f4ef",
    overflow: "hidden",
  },
  topBar: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    maxWidth: 430,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "11px 12px",
    minHeight: 68,
    background: "#0a0a0a",
    borderBottom: "1px solid #262626",
    borderRadius: "0 0 24px 24px",
    boxShadow: "0 1px 0 rgba(10,10,10,0.06)",
  },
  screenTitle: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    margin: 0,
    color: "#f6f4ef",
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 400,
    whiteSpace: "nowrap",
    letterSpacing: "-0.025em",
    fontFamily: "Georgia, serif",
  },
  syncBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 11px",
    border: "1px solid",
    borderRadius: 12,
    color: "#0a0a0a",
    fontSize: 10,
    lineHeight: 1.35,
  },
  syncButton: {
    flexShrink: 0,
    border: 0,
    borderRadius: 8,
    padding: "7px 10px",
    background: "#171717",
    color: "#fff",
    fontFamily: "inherit",
    fontSize: 10,
    fontWeight: 900,
    cursor: "pointer",
  },
  headerLogoWrap: {
    width: 68,
    height: 48,
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    borderRadius: 10,
    background: "transparent",
    border: "none",
  },
  headerLogo: {
    width: 64,
    height: 44,
    objectFit: "contain",
    filter: "invert(1)",
  },
  headerIconBtn: {
    marginLeft: "auto",
    width: 36,
    height: 36,
    borderRadius: 999,
    border: "1px solid #444",
    background: "#202020",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 15,
    fontFamily: "inherit",
  },
  availabilityCard: {
    marginBottom: 9,
    padding: "12px 14px",
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(10,10,10,0.08)",
    borderRadius: 16,
    boxShadow: "none",
  },
  mainContent: {
    minWidth: 0,
    overflowX: "hidden",
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 8,
  },
  brandLockup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  logoImage: {
    width: 86,
    height: 60,
    objectFit: "contain",
    borderRadius: 8,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
  },
  kicker: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "#6c6a65",
    marginBottom: 3,
  },
  logo: {
    fontSize: 26,
    fontWeight: 900,
    letterSpacing: "-0.05em",
    margin: 0,
    lineHeight: 1,
    color: "#0a0a0a",
  },
  terminalMeta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: 700,
    color: "#6c6a65",
  },
  summaryBtn: {
    background: "#0a0a0a",
    border: "1px solid #0a0a0a",
    borderRadius: 8,
    color: "#ffffff",
    padding: "10px 13px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  salePanel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    background: "#f6f4ef",
    border: "1px solid #e5e0d6",
    borderRadius: "26px 26px 18px 18px",
    boxShadow: "none",
  },
  sectionHeaderLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: "#6c6a65",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
  },
  panelHint: {
    fontSize: 10,
    fontWeight: 400,
    color: "#6c6a65",
  },
  toggleRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  toggleGroup: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 4,
    padding: 4,
    background: "#ece8df",
    border: "1px solid #e4e0d7",
    borderRadius: 999,
  },
  toggleBtn: {
    minHeight: 48,
    padding: "7px 8px",
    border: "1px solid transparent",
    borderRadius: 999,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    background: "transparent",
    color: "#6c6a65",
    fontFamily: "inherit",
  },
  toggleActive: {
    background: "#0a0a0a",
    border: "1px solid #0a0a0a",
    color: "#ffffff",
    boxShadow: "0 2px 5px rgba(0,0,0,.09)",
  },
  flavourGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
  },
  flavourBtn: {
    position: "relative",
    minHeight: 124,
    padding: "12px 5px",
    border: "1px solid #242424",
    borderRadius: 16,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 5,
    fontFamily: "inherit",
    boxShadow: "none",
    transition: "color 140ms ease, background-color 140ms ease, border-color 140ms ease",
  },
  flavourIcon: {
    fontSize: 25,
    lineHeight: 1,
  },
  flavourName: {
    fontSize: 15,
    fontWeight: 400,
    textAlign: "center",
    lineHeight: 1.2,
    fontFamily: "Georgia, serif",
    color: "#fff",
    textShadow: "0 1px 6px rgba(0,0,0,.7)",
  },
  flavourPrice: {
    fontSize: 12,
    fontWeight: 900,
  },
  flavourCount: {
    position: "absolute",
    top: -7,
    right: -7,
    minWidth: 24,
    height: 24,
    padding: "0 7px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "2px solid #fff",
  },
  confirmBtn: {
    width: "100%",
    padding: "14px 16px",
    border: "none",
    borderRadius: 999,
    background: "#0a0a0a",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 4px 12px rgba(0,0,0,.1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  undoBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#0a0a0a",
    color: "#fff",
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 800,
  },
  undoBtn: {
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.16)",
    color: "#ffffff",
    padding: "4px 12px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  receiptPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "#fff",
    border: "1px solid #e5e0d6",
    borderRadius: 22,
    boxShadow: "none",
  },
  deliveredPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "#fff",
    border: "1px solid #e8e4dc",
    borderRadius: 22,
    boxShadow: "0 4px 18px rgba(10,10,10,0.035)",
  },
  settingsPanel: {
    flexShrink: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "#fff",
    border: "1px solid #e8e4dc",
    borderRadius: 22,
    boxShadow: "0 4px 18px rgba(10,10,10,0.035)",
  },
  totalBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "#0a0a0a",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 16,
    boxShadow: "0 8px 20px rgba(10,10,10,0.16)",
  },
  deliveredBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "linear-gradient(135deg, #0a0a0a 0%, #171717 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 13,
    boxShadow: "0 8px 20px rgba(10,10,10,0.16)",
  },
  settingsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "linear-gradient(135deg, #0a0a0a 0%, #171717 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 13,
    boxShadow: "0 8px 20px rgba(10,10,10,0.16)",
  },
  totalLeft: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  totalLabel: {
    fontFamily: "Georgia, serif",
    fontSize: 13,
    fontWeight: 900,
    opacity: 0.9,
  },
  totalSub: {
    fontSize: 11,
    opacity: 0.68,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  orderList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    minHeight: 126,
    maxHeight: 300,
  },
  deliveredList: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  settingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  permissionsList: {},
  permissionRow: {},
  permissionLabel: {},
  permissionToggle: {},
  permissionToggleOn: {},
  permissionToggleKnob: {},
  permissionStatus: {},
  userCard: {
    background: "rgba(255,255,255,0.45)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(10,10,10,0.06), inset 0 1px 0 rgba(255,255,255,0.8)",
  },
  userPermissions: {
    display: "flex",
    gap: 6,
    padding: "8px 12px 12px",
    borderTop: "1px solid rgba(255,255,255,0.6)",
    flexWrap: "wrap",
    background: "rgba(255,255,255,0.25)",
  },
  permissionPill: {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(203,213,225,0.5)",
    background: "rgba(255,255,255,0.5)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "#8c8982",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "color 140ms ease, background-color 140ms ease, border-color 140ms ease",
  },
  permissionPillOn: {
    background: "rgba(10,10,10,0.85)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid rgba(10,10,10,0.7)",
    color: "#ffffff",
  },
  permissionPillAlwaysOn: {
    background: "rgba(10,10,10,0.07)",
    border: "1px solid rgba(10,10,10,0.1)",
    color: "#6c6a65",
    cursor: "default",
  },
  settingsSectionLabel: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#6c6a65",
    paddingLeft: 2,
    marginTop: 4,
  },
  userList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  userRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #1e293b 0%, #4a4843 100%)",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 2px 8px rgba(10,10,10,0.25)",
    border: "1px solid rgba(255,255,255,0.15)",
  },
  userMeta: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 13,
    fontWeight: 900,
    color: "#0a0a0a",
  },
  userRole: {
    fontSize: 11,
    fontWeight: 700,
    color: "#6c6a65",
  },
  collapsibleHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    minHeight: 44,
    background: "none",
    border: "none",
    outline: "none",
    padding: "8px 4px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#6c6a65",
  },
  collapseChevron: {
    fontSize: 10,
    color: "#8c8982",
    fontWeight: 900,
  },
  expandChevron: {
    fontSize: 10,
    color: "#8c8982",
    marginLeft: "auto",
    flexShrink: 0,
    marginRight: 6,
  },
  deleteConfirmRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  deleteConfirmLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#e11d48",
  },
  deleteConfirmYes: {
    padding: "4px 10px",
    border: "none",
    borderRadius: 7,
    background: "#e11d48",
    color: "#fff",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  deleteConfirmNo: {
    padding: "4px 10px",
    border: "1px solid #d8d4cb",
    borderRadius: 7,
    background: "rgba(255,255,255,0.7)",
    color: "#6c6a65",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  userDeleteBtn: {
    width: 28,
    height: 28,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    borderRadius: 7,
    color: "#e11d48",
    fontSize: 18,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
    fontFamily: "inherit",
    flexShrink: 0,
  },
  addUserForm: {
    display: "flex",
    gap: 6,
    alignItems: "flex-start",
  },
  userPinInput: {
    width: 64,
    minHeight: 40,
    padding: "8px 10px",
    border: "1px solid #d8d4cb",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0a0a0a",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
    textAlign: "center",
    letterSpacing: "0.2em",
    flexShrink: 0,
  },
  // Stock tab
  stockPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "#fff",
    border: "1px solid #e8e4dc",
    borderRadius: 22,
    boxShadow: "0 4px 18px rgba(10,10,10,0.035)",
  },
  stockCategoryHeader: {
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#6c6a65",
    paddingLeft: 2,
    marginTop: 4,
  },
  purchasePlanner: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    border: "1px solid #d8d4cb",
    borderRadius: 13,
    background: "linear-gradient(145deg, #ffffff 0%, #f6f4ef 100%)",
    boxShadow: "0 4px 14px rgba(49,46,129,0.07)",
  },
  purchasePlannerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  purchasePlannerTitle: {
    display: "block",
    marginTop: 3,
    color: "#0a0a0a",
    fontSize: 14,
    fontWeight: 900,
  },
  purchasePlannerTarget: {
    padding: "4px 8px",
    borderRadius: 99,
    background: "#ece8df",
    color: "#0a0a0a",
    fontSize: 8,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  purchasePlanList: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  purchasePlanRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 9px",
    border: "1px solid rgba(99,102,241,0.10)",
    borderRadius: 9,
    background: "rgba(255,255,255,0.8)",
  },
  purchasePlanIcon: {
    width: 28,
    height: 28,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    borderRadius: 8,
    background: "#f6f4ef",
    fontSize: 14,
  },
  purchasePlannerNote: {
    color: "#6c6a65",
    fontSize: 8,
    fontWeight: 700,
    lineHeight: 1.45,
  },
  stockList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  stockRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    background: "#ffffff",
    border: "1px solid #d8d4cb",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(10,10,10,0.04)",
  },
  stockRowLow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    background: "rgba(255,251,235,0.88)",
    border: "1px solid rgba(253,230,138,0.7)",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(180,83,9,0.06)",
  },
  stockRowCritical: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    background: "rgba(254,242,242,0.88)",
    border: "1px solid rgba(254,202,202,0.7)",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(220,38,38,0.06)",
  },
  stockInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
  },
  stockName: {
    fontSize: 13,
    fontWeight: 800,
    color: "#0a0a0a",
  },
  stockMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  stockUnit: {
    fontSize: 11,
    fontWeight: 600,
    color: "#6c6a65",
  },
  stockBadge: {
    fontSize: 10,
    fontWeight: 800,
    padding: "1px 7px",
    borderRadius: 999,
    border: "1px solid",
    whiteSpace: "nowrap",
  },
  stockControls: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  stockBtnMinus: {
    width: 32,
    height: 32,
    border: "1px solid #d8d4cb",
    borderRadius: 8,
    background: "#ece8df",
    color: "#0a0a0a",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  stockBtnPlus: {
    width: 32,
    height: 32,
    border: "1px solid #d8d4cb",
    borderRadius: 8,
    background: "#ece8df",
    color: "#0a0a0a",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  stockQty: {
    fontSize: 15,
    fontWeight: 900,
    color: "#0a0a0a",
    minWidth: 32,
    textAlign: "center",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  equipmentEditBtn: {
    minHeight: 34,
    padding: "0 11px",
    border: "1px solid #d8d4cb",
    borderRadius: 8,
    background: "#f6f4ef",
    color: "#0a0a0a",
    fontSize: 11,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  equipmentEditField: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: "#6c6a65",
    fontSize: 10,
    fontWeight: 800,
  },
  equipmentEditInput: {
    width: "100%",
    minHeight: 42,
    padding: "8px 10px",
    border: "1px solid #d8d4cb",
    borderRadius: 9,
    background: "#ffffff",
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: 800,
    fontFamily: "inherit",
  },
  equipmentCancelBtn: {
    minHeight: 40,
    border: "1px solid #d8d4cb",
    borderRadius: 9,
    background: "#ffffff",
    color: "#6c6a65",
    fontSize: 12,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  equipmentSaveBtn: {
    minHeight: 40,
    border: "1px solid #0a0a0a",
    borderRadius: 9,
    background: "#0a0a0a",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  restockBtn: {
    height: 32,
    padding: "0 10px",
    border: "1px solid rgba(10,10,10,0.2)",
    borderRadius: 8,
    background: "#0a0a0a",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    marginLeft: 4,
  },
  restockRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  restockInput: {
    width: 56,
    height: 32,
    border: "1.5px solid #d8d4cb",
    borderRadius: 8,
    background: "#fff",
    color: "#0a0a0a",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    textAlign: "center",
    outline: "none",
    padding: "0 6px",
  },
  restockConfirmBtn: {
    height: 32,
    padding: "0 14px",
    border: "none",
    borderRadius: 8,
    background: "linear-gradient(135deg,#22c55e,#16a34a)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 4px rgba(22,163,74,0.3)",
    letterSpacing: "0.02em",
  },
  restockCancelBtn: {
    height: 32,
    padding: "0 10px",
    border: "1.5px solid #d8d4cb",
    borderRadius: 8,
    background: "#f6f4ef",
    color: "#8c8982",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  subItemList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "6px 4px 2px 8px",
  },
  subItemRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    background: "rgba(255,255,255,0.6)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 8,
  },
  subItemTag: {
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  stockAddForm: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap",
  },
  stockSelectInput: {
    width: "100%",
    minHeight: 44,
    padding: "10px 12px",
    border: "1px solid #d8d4cb",
    borderRadius: 10,
    background: "rgba(255,255,255,0.7)",
    color: "#0a0a0a",
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
    appearance: "auto",
  },
  // Login screen
  loginScreen: {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "calc(100vh - 60px)",
    background: "#0a0a0a url(/brand/chill-pipe-monogram.png) center top / 480px 840px repeat",
    borderRadius: 10,
    margin: -14,
    padding: "28px 22px",
  },
  loginOrb1: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(100,130,180,0.25) 0%, transparent 70%)",
    top: -80,
    left: -60,
    pointerEvents: "none",
  },
  loginOrb2: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(80,110,160,0.18) 0%, transparent 70%)",
    bottom: -60,
    right: -50,
    pointerEvents: "none",
  },
  loginOrb3: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(148,163,184,0.2) 0%, transparent 70%)",
    top: "38%",
    right: 20,
    pointerEvents: "none",
  },
  loginCard: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    background: "#f6f4ef",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 28,
    padding: "32px 24px 28px",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    boxShadow: "0 8px 32px rgba(10,10,10,0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
    display: "flex",
    flexDirection: "column",
  },
  loginLogoWrap: {
    width: 136,
    height: 96,
    borderRadius: 12,
    background: "transparent",
    border: "none",
    boxShadow: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    alignSelf: "center",
  },
  loginHero: {},
  loginLogo: {
    width: 116,
    height: 78,
    objectFit: "contain",
    filter: "brightness(0) invert(1) drop-shadow(0 2px 4px rgba(0,0,0,0.45))",
  },
  loginHeroText: {},
  loginBrandTag: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: "#6c6a65",
    marginBottom: 6,
    textAlign: "center",
  },
  loginBrandName: {},
  loginAppName: {
    fontSize: 26,
    fontWeight: 900,
    letterSpacing: "-0.03em",
    color: "#0a0a0a",
    margin: "0 0 6px",
    lineHeight: 1.1,
    textAlign: "center",
  },
  loginMeta: {
    fontSize: 13,
    fontWeight: 500,
    color: "#6c6a65",
    margin: "0 0 28px",
    textAlign: "center",
  },
  loginCardLabel: {},
  loginField: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginBottom: 20,
  },
  loginLabel: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#6c6a65",
  },
  loginInput: {
    border: "1px solid rgba(10,10,10,0.15)",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 16,
    color: "#0a0a0a",
    outline: "none",
    background: "transparent",
    fontFamily: "inherit",
    width: "100%",
  },
  loginErrorMsg: {
    fontSize: 12,
    fontWeight: 700,
    color: "#e11d48",
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    borderRadius: 8,
    padding: "8px 12px",
    marginBottom: 12,
    textAlign: "center",
  },
  loginSignInBtn: {
    width: "100%",
    padding: "15px",
    background: "#0a0a0a",
    border: "none",
    borderRadius: 10,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    boxShadow: "0 4px 16px rgba(10,10,10,0.2)",
    marginTop: 8,
  },
  loginFooterNote: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: 600,
    color: "#8c8982",
    marginTop: 20,
    letterSpacing: "0.04em",
  },
  userPickerGrid: { display: "flex", flexDirection: "column", gap: 0 },
  userPickerCard: {},
  userPickerCardActive: {},
  userPickerAvatar: {},
  userPickerName: {},
  userPickerRoleBadge: {},
  pinBackBtn: {},
  pinTargetInfo: {},
  pinTargetName: {},
  pinTargetRole: {},
  pinDotsRow: {},
  pinDot: {},
  pinDotFilled: {},
  pinError: {},
  pinPad: {},
  pinKey: {},
  pinLabel: {},
  // Active user chip in top bar
  activeUserChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    background: "rgba(255,255,255,0.6)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 9,
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  activeUserAvatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#0a0a0a",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  activeUserInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    textAlign: "left",
  },
  activeUserName: {
    fontSize: 12,
    fontWeight: 900,
    color: "#0a0a0a",
    lineHeight: 1.2,
  },
  activeUserRoleLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#6c6a65",
    lineHeight: 1.2,
  },
  userNameInput: {
    flex: 1,
    minHeight: 44,
    padding: "10px 12px",
    border: "1px solid #d8d4cb",
    borderRadius: 11,
    background: "#ffffff",
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
  },
  userRoleSelect: {
    minHeight: 44,
    padding: "10px 12px",
    border: "1px solid #d8d4cb",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
  },
  addUserBtn: {
    minHeight: 44,
    padding: "0 18px",
    border: "none",
    borderRadius: 8,
    background: "#0a0a0a",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  settingCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 9,
  },
  kpiCard: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: "12px 14px",
    background: "#ffffff",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid #d8d4cb",
    borderRadius: 13,
    boxShadow: "0 4px 14px rgba(10,10,10,0.05)",
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: 800,
    color: "#6c6a65",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: 400,
    color: "#0a0a0a",
    lineHeight: 1.1,
    fontFamily: "Georgia, serif",
  },
  kpiSub: {
    fontSize: 10,
    fontWeight: 600,
    color: "#8c8982",
    marginTop: 1,
  },
  managementSectionHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "4px 2px 2px",
  },
  managementEyebrow: {
    display: "block",
    color: "#8c8982",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  managementSectionTitle: {
    display: "block",
    marginTop: 2,
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: 400,
    fontFamily: "Georgia, serif",
  },
  managementPeriodBadge: {
    padding: "5px 9px",
    borderRadius: 99,
    background: "#ece8df",
    color: "#0a0a0a",
    fontSize: 9,
    fontWeight: 900,
  },
  managementAttentionCard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    border: "1px solid #d8d4cb",
    borderRadius: 13,
    background: "#ffffff",
    boxShadow: "0 4px 14px rgba(10,10,10,0.05)",
  },
  managementAttentionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
  },
  managementAttentionItem: {
    minHeight: 62,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 1,
    padding: "8px 10px",
    border: "none",
    borderRadius: 10,
    fontSize: 9,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  settingValue: {
    fontSize: 20,
    fontWeight: 900,
    color: "#0a0a0a",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  priceInput: {
    width: "100%",
    minHeight: 42,
    padding: "8px 10px",
    border: "1px solid #d8d4cb",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0a0a0a",
    fontSize: 18,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    outline: "none",
  },
  priceInputDirty: {
    border: "1px solid #f59e0b",
    background: "#fffbeb",
  },
  priceConfirmRow: {
    display: "flex",
    gap: 6,
    marginTop: 4,
  },
  priceConfirmBtn: {
    flex: 1,
    padding: "7px 0",
    border: "none",
    borderRadius: 7,
    background: "#16a34a",
    color: "#fff",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  priceCancelBtn: {
    padding: "7px 12px",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 7,
    background: "rgba(255,255,255,0.65)",
    color: "#6c6a65",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  emptyState: {
    textAlign: "center",
    color: "#8c8982",
    fontSize: 13,
    fontWeight: 800,
    padding: "34px 0",
    background: "#f6f4ef",
    border: "1px dashed #d8d4cb",
    borderRadius: 12,
  },
  orderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 12px",
    background: "#ffffff",
    border: "1px solid #d8d4cb",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(10,10,10,0.04)",
    fontSize: 13,
  },
  deliveredRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    padding: "9px 10px",
    background: "#ffffff",
    border: "1px solid #d8d4cb",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(10,10,10,0.05)",
    fontSize: 13,
  },
  orderCardHeader: {
    flexBasis: "100%",
    display: "flex",
    alignItems: "center",
    gap: 7,
    paddingBottom: 5,
    borderBottom: "1px solid #ece8df",
  },
  orderCardNumber: {
    color: "#6c6a65",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.03em",
  },
  orderStatusPill: {
    padding: "2px 6px",
    borderRadius: 99,
    fontSize: 7,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  orderCardTime: {
    marginLeft: "auto",
    color: "#6c6a65",
    fontSize: 9,
    fontWeight: 800,
  },
  orderCardBody: {
    flexBasis: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  orderCardFlavour: {
    width: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    borderRadius: 9,
    fontSize: 17,
    fontFamily: "Georgia, serif",
    fontWeight: 400,
  },
  orderCardStaff: {
    marginTop: 2,
    color: "#6c6a65",
    fontSize: 8,
    fontWeight: 700,
  },
  orderCardAmount: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    flexShrink: 0,
    color: "#0a0a0a",
    fontSize: 11,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  orderIndex: {
    width: 24,
    fontSize: 11,
    color: "#8c8982",
    fontWeight: 900,
    textAlign: "center",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  tag: {
    padding: "4px 8px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  orderMeta: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    flexDirection: "column",
    gap: 1,
    color: "#0a0a0a",
    fontWeight: 900,
  },
  orderPrice: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    minWidth: 48,
    textAlign: "right",
    color: "#0a0a0a",
  },
  deleteBtn: {
    minWidth: 34,
    minHeight: 34,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    borderRadius: 8,
    color: "#e11d48",
    fontSize: 18,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  orderDeleteConfirm: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    padding: 5,
    border: "1px solid #fecaca",
    borderRadius: 9,
    background: "#fef2f2",
  },
  orderDeleteYes: {
    minHeight: 32,
    padding: "0 10px",
    border: "none",
    borderRadius: 7,
    background: "#dc2626",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  orderDeleteNo: {
    minHeight: 32,
    padding: "0 10px",
    border: "1px solid #d8d4cb",
    borderRadius: 7,
    background: "#ece8df",
    color: "#0a0a0a",
    fontSize: 10,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  deliverBtn: {
    minHeight: 44,
    background: "#0a0a0a",
    border: "1px solid #0a0a0a",
    borderRadius: 8,
    color: "#fff",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    padding: "0 12px",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  },
  summaryHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "2px 2px 4px",
  },
  summaryTitle: {
    fontSize: 24,
    fontWeight: 400,
    letterSpacing: "-0.05em",
    margin: 0,
    color: "#0a0a0a",
    fontFamily: "Georgia, serif",
  },
  backBtn: {
    background: "#ffffff",
    border: "1px solid #d8d4cb",
    borderRadius: 8,
    color: "#4a4843",
    padding: "9px 12px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  statRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  statCard: {
    flex: 1,
    minWidth: 92,
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 9,
    padding: "11px 12px",
  },
  statLabel: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#6c6a65",
  },
  statValue: {
    fontSize: 20,
    fontWeight: 400,
    fontFamily: "Georgia, serif",
    letterSpacing: "-0.03em",
    color: "#0a0a0a",
  },
  summarySection: {
    marginTop: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 900,
    color: "#6c6a65",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  countBadge: {
    background: "#0a0a0a",
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
    fontWeight: 900,
    color: "#fff",
  },
  summaryList: {
    background: "rgba(255,255,255,0.65)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 9,
    overflow: "hidden",
  },
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid rgba(241,245,249,0.8)",
    fontSize: 13,
  },
  summaryIndex: {
    width: 24,
    fontSize: 11,
    color: "#8c8982",
    fontWeight: 900,
    textAlign: "center",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  summaryTime: {
    flex: 1,
    textAlign: "right",
    fontSize: 11,
    color: "#8c8982",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  summaryPrice: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: "#0a0a0a",
  },
  copyBtn: {
    marginTop: 4,
    width: "100%",
    padding: "12px",
    background: "#0a0a0a",
    border: "none",
    color: "#ffffff",
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  brandPanel: {
    background: "rgba(255,255,255,0.65)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 10,
    padding: 12,
  },
  brandLogo: {
    display: "block",
    width: "100%",
    maxHeight: 140,
    objectFit: "contain",
  },
  footer: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    maxWidth: 430,
    margin: "0 auto",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    padding: 0,
    paddingBottom: "env(safe-area-inset-bottom)",
    background: "#fff",
    borderTop: "1px solid #e8e4dc",
    boxShadow: "0 -4px 24px rgba(10,10,10,0.05)",
    borderRadius: "24px 24px 0 0",
  },
  footerBar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    width: "100%",
    minHeight: 68,
    padding: "6px 8px",
    boxSizing: "border-box",
  },
  footerTab: {
    flex: 1,
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    touchAction: "manipulation",
  },
  footerTabActive: {},
  footerBadge: {},
  summaryDivider: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "4px 0",
  },
  summaryDividerLine: {
    flex: 1,
    height: 1,
    background: "#d8d4cb",
  },
  summaryDividerLabel: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "#8c8982",
    whiteSpace: "nowrap",
  },
  revenueHero: {
    background: "rgba(10,10,10,0.82)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderRadius: 10,
    padding: "14px 16px 12px",
    color: "#ffffff",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  revenueHeroTop: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  revenueHeroLabel: {
    fontSize: 9,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "#b9b6ae",
    marginBottom: 2,
  },
  revenueHeroAmount: {
    fontSize: 28,
    fontWeight: 400,
    letterSpacing: "-0.04em",
    fontFamily: "Georgia, serif",
    lineHeight: 1,
  },
  revenueHeroMeta: {
    fontSize: 11,
    fontWeight: 700,
    color: "#6c6a65",
    paddingBottom: 2,
  },
  revenueStatRow: {
    display: "flex",
    background: "rgba(255,255,255,0.05)",
    borderRadius: 7,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.07)",
  },
  revenueStat: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 1,
    padding: "8px 4px",
  },
  revenueStatDivider: {
    width: 1,
    background: "rgba(255,255,255,0.07)",
  },
  revenueStatIcon: {
    fontSize: 13,
    lineHeight: 1,
  },
  revenueStatLabel: {
    fontSize: 9,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#6c6a65",
  },
  revenueStatValue: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: "#ece8df",
    letterSpacing: "-0.02em",
  },
  flavourBreakdown: {
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  flavourBreakdownHeader: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#b9b6ae",
    marginBottom: 2,
  },
  flavourBreakdownRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  flavourBreakdownIcon: {
    fontSize: 15,
    width: 20,
    textAlign: "center",
    flexShrink: 0,
  },
  flavourBreakdownName: {
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
    width: 88,
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  flavourBarTrack: {
    flex: 1,
    height: 6,
    background: "#ece8df",
    borderRadius: 999,
    overflow: "hidden",
  },
  flavourBar: {
    height: "100%",
    borderRadius: 999,
    transition: "width 0.3s ease",
    minWidth: 2,
  },
  flavourBreakdownCount: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    width: 20,
    textAlign: "right",
    flexShrink: 0,
  },
  orderLogSection: {
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
    overflow: "hidden",
  },
  orderLogHeader: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#6c6a65",
    padding: "10px 14px 8px",
    borderBottom: "1px solid #ece8df",
  },
  orderLog: {
    maxHeight: 220,
    overflowY: "auto",
  },
  orderLogRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 14px",
    borderBottom: "1px solid #f6f4ef",
    fontSize: 12,
  },
  orderLogIndex: {
    width: 22,
    fontSize: 10,
    color: "#d8d4cb",
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    flexShrink: 0,
  },
  orderLogMeta: {
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    color: "#6c6a65",
  },
  orderLogTime: {
    fontSize: 11,
    color: "#8c8982",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    flexShrink: 0,
  },
  orderLogPrice: {
    fontSize: 12,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: "#0a0a0a",
    width: 44,
    textAlign: "right",
    flexShrink: 0,
  },
};
