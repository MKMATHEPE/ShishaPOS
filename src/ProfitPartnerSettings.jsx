import {recordDiagnostic} from './monitoring';
import {useEffect,useState} from 'react';
import {useUnsavedChanges} from './unsavedChanges';
import {validateProfitPartners} from './partnerSettings.js';
import {expensePersonLabel} from './expensePersonLabel.js';
const signature=rows=>JSON.stringify(rows.map(row=>({profileId:row.profileId,profitShare:row.profitShare===''?'':Number(row.profitShare)})));
export default function ProfitPartnerSettings({users,partners,onSave}) {
  const [draft,setDraft]=useState(()=>partners.map(row=>({...row})));
  const [baseline,setBaseline]=useState(()=>JSON.stringify(partners));
  const [editing,setEditing]=useState(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [failed,setFailed]=useState(false);
  const error=validateProfitPartners(draft);
  const total=draft.reduce((sum,row)=>sum+(Number(row.profitShare)||0),0);
  const dirty=signature(draft)!==signature(JSON.parse(baseline));
  useUnsavedChanges(dirty);
  useEffect(()=>{
    if(!message||failed)return;
    const timer=setTimeout(()=>setMessage(''),4000);
    return ()=>clearTimeout(timer);
  },[message,failed]);
  const change=(index,fields)=>{setDraft(rows=>rows.map((row,i)=>i===index?{...row,...fields}:row));setMessage('');};
  const remove=index=>{setDraft(rows=>rows.filter((_,i)=>i!==index));setEditing(null);setMessage('');};
  const cancel=()=>{setDraft(JSON.parse(baseline));setEditing(null);setMessage('');};
  const save=async()=>{
    if(error||busy) return;
    setBusy(true);setMessage('');
    const next=draft.map(row=>({profileId:row.profileId,profitShare:Number(row.profitShare)}));
    try {await onSave(next,JSON.parse(baseline));setDraft(next);setBaseline(JSON.stringify(next));setEditing(null);setFailed(false);setMessage('✓ Saved');}
    catch(error){recordDiagnostic('save_failed','partner_save_failed');setFailed(true);setMessage(error.message||'Could not save partner shares.');}
    finally{setBusy(false);}
  };
  return <section className="profit-partner-settings frosted-card"><div className="partner-settings-heading"><h3>Profit partners</h3><div className="partner-heading-status">{message&&!failed&&<span role="status" className="partner-save-success">{message}</span>}<span className={error?'':'partner-total-valid'}>Total {Number(total.toFixed(2))}%{!error?' ✓':''}</span></div></div>
    <div className="partner-column-labels"><span>Account</span><span>Share</span><span /></div><fieldset disabled={busy}>{draft.map((row,index)=>{
      const name=expensePersonLabel(users.find(user=>user.id===row.profileId)?.name)??'Choose partner';
      const rowValid=!!row.profileId&&Number(row.profitShare)>0&&Number(row.profitShare)<=100&&!draft.some((other,i)=>i!==index&&other.profileId===row.profileId);
      return editing===index?<div className="partner-row-editor" key={index}>
        <div className="partner-edit-fields"><label><select aria-label={`Partner ${index+1} account`} value={row.profileId} onChange={event=>change(index,{profileId:event.target.value})}><option value="">Choose partner</option>{users.map(user=><option key={user.id} value={user.id} disabled={draft.some((other,i)=>i!==index&&other.profileId===user.id)}>{expensePersonLabel(user.name)}</option>)}</select></label>
        <label><input aria-label={`Partner ${index+1} percentage`} type="number" min="0.01" max="100" step="0.01" inputMode="decimal" value={row.profitShare} onChange={event=>change(index,{profitShare:event.target.value})} /></label></div>
        <div className="partner-edit-actions"><button type="button" onClick={()=>remove(index)} aria-label={`Remove ${name}`}>Remove</button><button type="button" disabled={!rowValid} onClick={()=>setEditing(null)}>Done</button></div>
      </div>:<div className="partner-compact-row" key={index}><button className="partner-text-edit" type="button" aria-label={`Edit account for ${name}`} onClick={()=>{setEditing(index);setMessage('');}}>{name}</button><button className="partner-text-edit partner-share-edit" type="button" aria-label={`Edit share for ${name}`} onClick={()=>{setEditing(index);setMessage('');}}>{row.profitShare||0}%</button><button type="button" aria-label={`Remove ${name}`} onClick={()=>remove(index)}>×</button></div>;
    })}
    <button type="button" className="partner-add" onClick={()=>{setEditing(draft.length);setDraft(rows=>[...rows,{profileId:'',profitShare:''}]);setMessage('');}}>＋ Add partner</button>
    {error&&(dirty||editing!==null)&&<p className="partner-validation">{error}</p>}
    {dirty&&<div className="partner-settings-actions"><button type="button" onClick={cancel}>Cancel</button><button type="button" disabled={!!error} onClick={save}>{busy?'Saving…':'Save shares'}</button></div>}</fieldset>
    {message&&failed&&<p role="alert" className="partner-save-error">{message}</p>}
  </section>;
}
