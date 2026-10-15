import { useUnsavedChanges } from "./unsavedChanges";
import { useState } from 'react';
import { stockLines } from './stockTakingModel';
import { expenseDate, expenseChanges } from './expenseEditor';

export default function ExpensesList({ stock, expenses, users, lockedThrough, today, onUpdate, onDelete, isAdmin, onStatus, title }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useUnsavedChanges(editId !== null);
  const stockItems = stockLines(stock);
  const money = amount => `R${Number(amount).toLocaleString('en-ZA', {minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const edit = expense => {
    setEditId(expense.id); setDeleteId(null); setError(''); setMessage('');
    setDraft({ category: expense.category, description: expense.description || '', amount: String(expense.amount), paidBy: expense.paidBy || '', date: expenseDate(expense.time), stockKey: Object.keys(expense.stockQuantities ?? {})[0] ?? '', stockQuantity: String(Object.values(expense.stockQuantities ?? {})[0] ?? '') });
  };
  const save = async expense => {
    if (busy) return;
    setError(''); setMessage('');
    try {
      const changes = expenseChanges(expense, draft, lockedThrough, today);
      setBusy(true); await onUpdate(expense, changes); setEditId(null); setMessage('Expense updated.');
    } catch(error) { setError(error.message || 'Could not update the expense.'); }
    finally { setBusy(false); }
  };
  const remove = async expense => {
    if (busy) return;
    setError(''); setMessage('');
    if (lockedThrough && expenseDate(expense.time) <= lockedThrough) { setError('This accounting period is locked.'); return; }
    setBusy(true);
    try { await onDelete(expense); setDeleteId(null); setMessage('Expense deleted.'); }
    catch(error) { setError(error.message || 'Could not delete the expense.'); }
    finally { setBusy(false); }
  };
  const changeStatus = async (expense, status) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await onStatus(expense, status); setMessage(status === 'paid' ? 'Expense marked paid.' : 'Expense approved.'); }
    catch (error) { setError(error.message || 'Could not update expense.'); }
    finally { setBusy(false); }
  };
  const labels = {pending:'Pending approval', approved:'Approved', paid:'Paid'};
  const visible = expenses.filter(expense => filter === 'all' || expense.status === filter);
  const totalPages = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = Math.min(page, totalPages);
  const pageExpenses = [...visible].sort((a,b)=>Number(a.status === 'paid')-Number(b.status === 'paid') || new Date(b.time)-new Date(a.time) || b.id-a.id).slice((currentPage-1)*10, currentPage*10);
  const person = id => users.find(user => user.id === id)?.name ?? 'Removed user';
  return <section className="expenses-list">
    <h3>{title ?? (isAdmin ? 'All expenses' : 'Expenses')}</h3>
    <label className="expense-status-filter">Status<select disabled={busy || editId !== null || deleteId !== null} value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    {error && <p className="expense-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!visible.length && <p>No matching expenses.</p>}
    {pageExpenses.map(expense=> {
      const locked = lockedThrough && expenseDate(expense.time) <= lockedThrough;
      if (expense.status === 'paid') return <div className="expense-item expense-item-paid" key={expense.id}>
        <div className="expense-item-heading"><strong>{expense.description || expense.category}</strong><strong>{money(expense.amount)}</strong></div>
        <div className="expense-paid-summary"><span>{expenseDate(expense.time)} · {expense.paidBy ? person(expense.paidBy) : 'Business'} · <strong className="expense-paid-status">Paid ✓</strong></span>
          <details className="expense-paid-details">
            <summary>View details</summary>
            <div>
              <p>{expense.category} · {expense.paidBy ? person(expense.paidBy) : 'Paid by business'}</p>
              {expense.submittedBy && <p>Submitted by {person(expense.submittedBy)}</p>}
              {expense.approvedAt && <p>Approved by {person(expense.approvedBy)} · {new Date(expense.approvedAt).toLocaleString('en-ZA')}</p>}
              {expense.paidAt ? <p>{expense.paidBy ? 'Reimbursed' : 'Paid'} · {new Date(expense.paidAt).toLocaleString('en-ZA')} · {person(expense.paymentBy)}</p> : <p>Previously settled</p>}
              {Object.entries(expense.stockQuantities ?? {}).map(([key,quantity])=><p key={key}>Bought {quantity} {stockItems.find(item=>item.key===key)?.unit} · {stockItems.find(item=>item.key===key)?.name ?? key}</p>)}
              {locked && <p>Locked period</p>}
            </div>
          </details>
        </div>
      </div>;
      return <div className="expense-item" key={expense.id}>
        <div className="expense-item-heading"><strong>{expense.description || expense.category}</strong><strong>{money(expense.amount)}</strong></div>
        <p>{expenseDate(expense.time)} · {expense.category} · {expense.paidBy ? users.find(user=>user.id===expense.paidBy)?.name ?? 'Removed user' : 'Paid by business'}</p>
        <p><strong>{labels[expense.status] ?? 'Pending approval'}</strong>{expense.submittedBy && ` · Submitted by ${person(expense.submittedBy)}`}</p>
        {expense.approvedAt && <p>Approved by {person(expense.approvedBy)} · {new Date(expense.approvedAt).toLocaleString('en-ZA')}</p>}
        {expense.paidAt && <p>{expense.paidBy ? 'Reimbursed' : 'Paid'} · {new Date(expense.paidAt).toLocaleString('en-ZA')} · {person(expense.paymentBy)}</p>}
        {expense.status === 'paid' && !expense.paidAt && <p>Previously settled</p>}
        {isAdmin && expense.status !== 'paid' && <div className="expense-actions"><button disabled={busy || locked || expense.status === 'paid'} onClick={()=>changeStatus(expense, expense.status === 'approved' ? 'paid' : 'approved')}>{expense.status === 'approved' ? (expense.paidBy ? 'Mark reimbursed' : 'Mark paid') : 'Approve'}</button></div>}
        {Object.entries(expense.stockQuantities ?? {}).map(([key,quantity])=><p key={key}>Bought {quantity} {stockItems.find(item=>item.key===key)?.unit} · {stockItems.find(item=>item.key===key)?.name ?? key}</p>)}
        {editId === expense.id ? <div className="expense-edit-form">
          <label>Date<input type="date" value={draft.date} max={today} onChange={event=>setDraft(prev=>({...prev,date:event.target.value}))} /></label>
          <label>Amount (R)<input type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.amount} onChange={event=>setDraft(prev=>({...prev,amount:event.target.value}))} /></label>
          <label>Category<select value={draft.category} onChange={event=>setDraft(prev=>({...prev,category:event.target.value}))}>{[...new Set([expense.category,'Transport','Wages','Supplies','Rent','Utilities','Repairs','Other'])].map(category=><option key={category}>{category}</option>)}</select></label>
          <label>Paid by<select value={draft.paidBy} onChange={event=>setDraft(prev=>({...prev,paidBy:event.target.value}))}><option value="">Business</option>{users.map(user=><option key={user.id} value={user.id}>{user.name}</option>)}{draft.paidBy && !users.some(user=>user.id===draft.paidBy) && <option value={draft.paidBy}>Removed user</option>}</select></label>
          <label>Stock purchased<select value={draft.stockKey} onChange={event=>setDraft(prev=>({...prev,stockKey:event.target.value,stockQuantity:''}))}><option value="">No stock purchase</option>{stockItems.map(item=><option key={item.key} value={item.key}>{item.name} ({item.unit})</option>)}</select></label>
          {draft.stockKey && <label>Quantity bought ({stockItems.find(item=>item.key===draft.stockKey)?.unit})<input type="number" min="0.001" step="0.001" inputMode="decimal" value={draft.stockQuantity} onChange={event=>setDraft(prev=>({...prev,stockQuantity:event.target.value}))} /></label>}
          <label className="expense-wide">Description (optional)<input value={draft.description} onChange={event=>setDraft(prev=>({...prev,description:event.target.value}))} /></label>
          <div className="expense-actions expense-wide"><button disabled={busy} onClick={()=>setEditId(null)}>Cancel</button><button disabled={busy} onClick={()=>save(expense)}>{busy ? 'Saving…' : 'Save changes'}</button></div>
        </div> : deleteId === expense.id ? <div className="expense-delete-confirm"><p>Delete this expense of {money(expense.amount)}? This cannot be undone. {Object.keys(expense.stockQuantities ?? {}).length > 0 && 'The linked stock quantity will also be reversed.'}</p><div className="expense-actions"><button disabled={busy} onClick={()=>setDeleteId(null)}>Keep expense</button><button className="expense-danger" disabled={busy} onClick={()=>remove(expense)}>{busy ? 'Deleting…' : 'Delete expense'}</button></div></div> : <div className="expense-actions"><button disabled={busy || locked || expense.status === 'paid'} onClick={()=>edit(expense)} aria-label={`Edit expense ${expense.description || expense.category}`}>Edit</button><button disabled={busy || locked || expense.status === 'paid'} onClick={()=>{setDeleteId(expense.id);setEditId(null);setError('');setMessage('');}} aria-label={`Delete expense ${expense.description || expense.category}`}>Delete</button>{locked && <span>Locked period</span>}</div>}
      </div>;
    })}
    {totalPages > 1 && <nav className="expense-pagination" aria-label="Expense pages">
      <button disabled={currentPage === 1 || busy || editId !== null || deleteId !== null} onClick={()=>setPage(currentPage-1)}>Previous</button>
      <span aria-live="polite">Page {currentPage} of {totalPages}</span>
      <button disabled={currentPage === totalPages || busy || editId !== null || deleteId !== null} onClick={()=>setPage(currentPage+1)}>Next</button>
    </nav>}
  </section>;
}
