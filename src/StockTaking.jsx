import { useUnsavedChanges } from "./unsavedChanges";
import { useEffect, useRef, useState } from 'react';
import StockItemPhoto from './StockItemPhoto.jsx';
import { supabase } from './supabase';
import { stockLines, countPayload, initialCountDraft } from './stockTakingModel';

export default function StockTaking({ stock, refreshStock, pendingOrders, isAdmin }) {
  const [sessions, setSessions] = useState([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState({});
  const [baseline, setBaseline] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const saveRunning = useRef(false);
  const [historyId, setHistoryId] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  useUnsavedChanges(mode !== null);
  const lines = stockLines(stock);
  const load = async () => {
    const { data, error } = await supabase.from('pos_stocktakes').select('*').order('opened_at', { ascending: false }).limit(20);
    setReady(!error);
    setSessions(data ?? []);
    setLoading(false);
    if (error) setMessage('Stock taking is awaiting database activation. You can preview a count below.');
  };
  useEffect(() => {
    let alive = true;
    supabase.from('pos_stocktakes').select('*').order('opened_at', { ascending: false }).limit(20).then(({data,error}) => {
      if (!alive) return;
      setSessions(data ?? []); setReady(!error); setLoading(false);
      if (error) setMessage('Stock taking is awaiting database activation. You can preview a count below.');
    });
    return () => { alive = false; };
  }, []);
  const start = async action => {
    setBusy(true); setMessage('');
    try {
      const latest = await refreshStock();
      if (!latest) throw new Error('Connect to refresh stock before counting.');
      const snapshot = stockLines(latest);
      setEditingKey(null); setBaseline(snapshot); setDraft(initialCountDraft(snapshot)); setMode(action);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!ready || busy || pendingOrders || saveRunning.current) return;
    saveRunning.current = true;
    setBusy(true); setMessage('');
    try {
      const counts = countPayload(baseline, draft);
      const expected = Object.fromEntries(baseline.map(item => [item.key, item.quantity]));
      const { data, error } = await supabase.rpc('record_pos_stocktake', { action: mode, counts, expected_counts: expected, closing_note: '' });
      if (error) throw error;
      if (!data) throw new Error("Stock count was not confirmed. Please try again.");
      setMode(null); setEditingKey(null);
      await refreshStock(); await load(); setMessage('Stock record saved.');
    } catch(error) { setMessage(error.message || 'Could not save. Refresh stock and try again.'); }
    finally { saveRunning.current = false; setBusy(false); }
  };
  function renderCountRow(item) {
    const editing = editingKey === item.key;
    return <div className="stock-taking-row stock-count-row" key={item.key}>
      <label htmlFor={`count-${item.key}`}><span className="stock-item-name"><StockItemPhoto name={item.name} />{item.name}</span><small>{item.unit}</small></label>
      <span>{item.quantity.toFixed(2)}</span>
      {editing ? <input disabled={busy} autoFocus id={`count-${item.key}`} aria-label={`${item.name} counted ${item.unit}`} type="number" inputMode="decimal" min="0" step="0.001" placeholder="Count" value={draft[item.key] ?? ''} onChange={event=>setDraft(prev=>({...prev,[item.key]:event.target.value}))} /> : <strong>{draft[item.key] ?? '—'}</strong>}
      <button disabled={busy} onClick={()=>setEditingKey(editing ? null : item.key)}>{editing ? 'Done' : 'Edit'}</button>
    </div>;
  }
  const history = sessions.find(row => row.id === historyId);
  const formatTime = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' });
  return <section className="stock-taking">
    <div className="stock-taking-heading"><h2>Remaining stock</h2><span>Physical count</span></div>
    <p>Record what is physically remaining. Add stock purchases as expenses in Management → Finance.</p>
    {pendingOrders > 0 && <p role="status">Sync offline orders before confirming a count.</p>}
    {message && <p role="status">{message}</p>}
    {!mode && <><div className="stock-taking-available"><h3>Available stock</h3>{lines.filter(item=>item.category!=='equipment').map(item=><div className="stock-taking-available-row" key={item.key}><span className="stock-item-name"><StockItemPhoto name={item.name} />{item.name}</span><strong>{item.quantity.toFixed(2)} {item.unit}</strong></div>)}{isAdmin && <details><summary>Equipment inventory</summary>{lines.filter(item=>item.category==='equipment').map(item=><p key={item.key}>{item.name}: {item.quantity} {item.unit}</p>)}</details>}</div><div className="stock-taking-actions"><button disabled={loading || busy} onClick={()=>start('count')}>Record remaining stock</button></div></>}
    {mode && <>
      <h3>Count remaining stock</h3>
      <p>Use Edit beside each item, then Done. Save remaining count when finished. Unedited rows keep their available quantities.</p>
      <div className="stock-taking-table">
        <div className="stock-taking-row stock-taking-labels"><span>Item</span><span>Available</span><span>Remaining</span><span /></div>
        {baseline.filter(item=>item.category !== 'equipment').map(renderCountRow)}
        {isAdmin && <details><summary>Equipment inventory (rarely changed)</summary>{baseline.filter(item=>item.category === 'equipment').map(renderCountRow)}</details>}
      </div>
      <div className="stock-taking-actions"><button disabled={busy} onClick={() => {setMode(null);setEditingKey(null);}}>Cancel</button><button disabled={!ready || busy || pendingOrders > 0} onClick={save}>{busy ? 'Saving…' : 'Save remaining count'}</button></div>
      {!ready && <p>Saving will be enabled after the database update is approved.</p>}
    </>}
    {sessions.filter(row=>row.status==='closed').length > 0 && <details><summary>Previous remaining counts</summary>{sessions.filter(row=>row.status==='closed').map(row=><button className="stock-taking-history" key={row.id} onClick={()=>setHistoryId(row.id===historyId?null:row.id)}>{formatTime(row.closed_at)}</button>)}{history && <div>{Object.entries(history.closing).filter(([key])=>isAdmin || lines.find(item=>item.key===key)?.category !== 'equipment').map(([key,count])=><p key={key}>{lines.find(item=>item.key===key)?.name ?? key}: {count} · difference {(count-(history.expected[key]??0)).toFixed(3)}</p>)}{history.note && <p>{history.note}</p>}</div>}</details>}
  </section>;
}
