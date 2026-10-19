import {useState} from 'react';
import {useUnsavedChanges} from './unsavedChanges';
import {validateProfitPartners} from './partnerSettings.js';
import {expensePersonLabel} from './expensePersonLabel.js';
export default function ProfitPartnerSettings({users,partners,onSave}) {
  const [draft,setDraft]=useState(()=>partners.map(row=>({...row})));
  const [baseline,setBaseline]=useState(()=>JSON.stringify(partners));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [failed,setFailed]=useState(false);
  const error=validateProfitPartners(draft);
  const total=draft.reduce((sum,row)=>sum+(Number(row.profitShare)||0),0);
  const dirty=JSON.stringify(draft)!==baseline;
  useUnsavedChanges(dirty);
  const change=(index,fields)=>{setDraft(rows=>rows.map((row,i)=>i===index?{...row,...fields}:row));setMessage('');};
  const save=async()=>{
    if(error||busy) return;
    setBusy(true);setMessage('');
    const next=draft.map(row=>({profileId:row.profileId,profitShare:Number(row.profitShare)}));
    try {await onSave(next,JSON.parse(baseline));setDraft(next);setBaseline(JSON.stringify(next));setFailed(false);setMessage('Partner shares saved.');}
    catch(error){setFailed(true);setMessage(error.message||'Could not save partner shares.');}
    finally{setBusy(false);}
  };
  return <section className="profit-partner-settings frosted-card"><div className="partner-settings-heading"><h3>Profit partners</h3><span className={error?'':'partner-total-valid'}>Total {Number(total.toFixed(2))}%</span></div>
    <fieldset disabled={busy}>{draft.map((row,index)=><div className="partner-settings-row" key={index}>
      <label>Account<select aria-label={`Partner ${index+1} account`} value={row.profileId} onChange={event=>change(index,{profileId:event.target.value})}><option value="">Choose partner</option>{users.map(user=><option key={user.id} value={user.id} disabled={draft.some((other,i)=>i!==index&&other.profileId===user.id)}>{expensePersonLabel(user.name)}</option>)}</select></label>
      <label>Share %<input aria-label={`Partner ${index+1} percentage`} type="number" min="0.01" max="100" step="0.01" inputMode="decimal" value={row.profitShare} onChange={event=>change(index,{profitShare:event.target.value})} /></label>
      <button type="button" aria-label={`Remove partner ${index+1}`} onClick={()=>{setDraft(rows=>rows.filter((_,i)=>i!==index));setMessage('');}}>×</button>
    </div>)}
    <button type="button" className="partner-add" onClick={()=>setDraft(rows=>[...rows,{profileId:'',profitShare:''}])}>＋ Add partner</button>
    {error&&<p className="partner-validation">{error}</p>}
    <div className="partner-settings-actions"><button type="button" disabled={!dirty} onClick={()=>{setDraft(JSON.parse(baseline));setMessage('');}}>Cancel</button><button type="button" disabled={!!error||!dirty} onClick={save}>{busy?'Saving…':'Save shares'}</button></div></fieldset>
    {message&&<p role={failed?'alert':'status'} className={failed?'partner-save-error':'partner-save-success'}>{message}</p>}
  </section>;
}
