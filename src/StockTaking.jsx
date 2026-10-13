import { useEffect, useState } from 'react';
import StockItemPhoto from './StockItemPhoto.jsx';
import { supabase } from './supabase';
import { stockLines, countPayload, reconcileStock } from './stockTakingModel';

export default function StockTaking({ stock, refreshStock, pendingOrders }) {
  const [sessions, setSessions] = useState([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState({});
  const [baseline, setBaseline] = useState([]);
  const [review, setReview] = useState(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyId, setHistoryId] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
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
      setEditingKey(null); setBaseline(snapshot); setDraft(Object.fromEntries(snapshot.filter(item => item.category === 'equipment').map(item => [item.key, String(item.quantity)]))); setMode(action); setReview(null); setNote('');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const prepare = () => {
    try { setReview(countPayload(baseline, draft)); setEditingKey(null); setMessage(''); }
    catch(error) { setMessage(error.message); }
  };
  const save = async () => {
    if (!ready || busy || pendingOrders || !review) return;
    setBusy(true); setMessage('');
    try {
      const expected = Object.fromEntries(baseline.map(item => [item.key, item.quantity]));
      const { error } = await supabase.rpc('record_pos_stocktake', { action: mode, counts: review, expected_counts: expected, closing_note: note });
      if (error) throw error;
      setMode(null); setReview(null); setEditingKey(null);
      await refreshStock(); await load(); setMessage('Stock record saved.');
    } catch(error) { setMessage(error.message || 'Could not save. Refresh stock and try again.'); }
    finally { setBusy(false); }
  };
  function renderCountRow(item) {
    const editing = editingKey === item.key;
    return <div className="stock-taking-row stock-count-row" key={item.key}>
      <label htmlFor={`count-${item.key}`}><span className="stock-item-name"><StockItemPhoto name={item.name} />{item.name}</span><small>{item.unit}</small></label>
      <span>{item.quantity.toFixed(2)}</span>
      {editing && !review ? <input autoFocus id={`count-${item.key}`} aria-label={`${item.name} counted ${item.unit}`} type="number" inputMode="decimal" min="0" step="0.001" placeholder="Count" value={draft[item.key] ?? ''} onChange={event=>setDraft(prev=>({...prev,[item.key]:event.target.value}))} /> : <strong>{(review ?? draft)[item.key] ?? '—'}</strong>}
      {!review && <button onClick={()=>setEditingKey(editing ? null : item.key)}>{editing ? 'Done' : 'Edit'}</button>}
    </div>;
  }
  const history = sessions.find(row => row.id === historyId);
  const formatTime = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' });
  return <section className="stock-taking">
    <div className="stock-taking-heading"><h2>Remaining stock</h2><span>Physical count</span></div>
    <p>Record what is physically remaining. Add stock purchases as expenses in Management → Finance.</p>
    {pendingOrders > 0 && <p role="status">Sync offline orders before confirming a count.</p>}
    {message && <p role="status">{message}</p>}
    {!mode && <><div className="stock-taking-available"><h3>Available stock</h3>{lines.filter(item=>item.category!=='equipment').map(item=><div className="stock-taking-available-row" key={item.key}><span className="stock-item-name"><StockItemPhoto name={item.name} />{item.name}</span><strong>{item.quantity.toFixed(2)} {item.unit}</strong></div>)}<details><summary>Equipment inventory</summary>{lines.filter(item=>item.category==='equipment').map(item=><p key={item.key}>{item.name}: {item.quantity} {item.unit}</p>)}</details></div><div className="stock-taking-actions"><button disabled={loading || busy} onClick={()=>start('count')}>Record remaining stock</button></div></>}
    {mode && <>
      <h3>Count remaining stock</h3>
      <p>Use Edit beside each item to record what remains. Equipment keeps its current count unless changed.</p>
      <div className="stock-taking-table">
        <div className="stock-taking-row stock-taking-labels"><span>Item</span><span>Available</span><span>Remaining</span><span /></div>
        {baseline.filter(item=>item.category !== 'equipment').map(renderCountRow)}
        <details><summary>Equipment inventory (rarely changed)</summary>{baseline.filter(item=>item.category === 'equipment').map(renderCountRow)}</details>
      </div>
      {review && <div className="stock-taking-differences"><h3>Differences to recorded stock</h3>{reconcileStock(baseline,review).filter(item => item.difference !== 0).map(item => <p key={item.key}>{item.name}: <strong>{item.difference > 0 ? '+' : ''}{item.difference.toFixed(3)} {item.unit}</strong></p>)}{reconcileStock(baseline,review).every(item => item.difference === 0) && <p>All counts match.</p>}<p>Confirming replaces the recorded quantities with your physical count.</p></div>}
      {mode === 'count' && <label className="stock-taking-note">Count note<textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="Explain shortages or surplus (optional)" /></label>}
      <div className="stock-taking-actions"><button disabled={busy} onClick={() => {setMode(null);setReview(null);setEditingKey(null);}}>Cancel</button>{review ? <><button disabled={busy} onClick={() => setReview(null)}>Edit count</button><button disabled={!ready || busy || pendingOrders > 0} onClick={save}>{busy ? 'Saving…' : 'Save remaining count'}</button></> : <button disabled={busy} onClick={prepare}>Review count</button>}</div>
      {!ready && <p>Saving will be enabled after the database update is approved.</p>}
    </>}
    {sessions.filter(row=>row.status==='closed').length > 0 && <details><summary>Previous remaining counts</summary>{sessions.filter(row=>row.status==='closed').map(row=><button className="stock-taking-history" key={row.id} onClick={()=>setHistoryId(row.id===historyId?null:row.id)}>{formatTime(row.closed_at)}</button>)}{history && <div>{Object.entries(history.closing).map(([key,count])=><p key={key}>{lines.find(item=>item.key===key)?.name ?? key}: {count} · difference {(count-(history.expected[key]??0)).toFixed(3)}</p>)}{history.note && <p>{history.note}</p>}</div>}</details>}
  </section>;
}
