import {recordDiagnostic} from './monitoring';
import {useState} from 'react';
import {useUnsavedChanges} from './unsavedChanges';
import {validPrices} from './priceSettingsModel.js';
export default function PriceSettings({prices,onSave}) {
 const [draft,setDraft]=useState(()=>({full:String(prices.full),refill:String(prices.refill)}));
 const [baseline,setBaseline]=useState(prices);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 const dirty=['full','refill'].some(key=>draft[key]===''||Number(draft[key])!==Number(baseline[key]));
 useUnsavedChanges(dirty);
 const save=async()=>{
  if(!validPrices(draft)||busy)return;
  setBusy(true);setMessage('');
  const next={full:Number(draft.full),refill:Number(draft.refill)};
  try {await onSave(next,baseline);setBaseline(next);setFailed(false);setMessage('✓ Prices saved');}
  catch(error){recordDiagnostic('save_failed','price_save_failed');setFailed(true);setMessage(error.message||'Could not save prices.');}
  finally{setBusy(false);}
 };
 return <section className="business-price-card frosted-card"><h3>Pricing</h3><fieldset disabled={busy}><div className="business-price-fields">{[['full','New Pipe'],['refill','Refill']].map(([key,label])=><label key={key}>{label}<span className="business-price-input"><span aria-hidden="true">R</span><input aria-label={`${label} price in rand`} type="number" min="0" max="1000000" step="0.01" inputMode="decimal" value={draft[key]} onChange={event=>{setDraft(current=>({...current,[key]:event.target.value}));setMessage('');}} /></span></label>)}</div>
 {dirty&&<div className="partner-settings-actions"><button onClick={()=>{setDraft({full:String(baseline.full),refill:String(baseline.refill)});setMessage('');}}>Cancel</button><button disabled={!validPrices(draft)} onClick={save}>{busy?'Saving…':'Save prices'}</button></div>}</fieldset>
 {message&&<p className={failed?'partner-save-error':'partner-save-success'} role={failed?'alert':'status'}>{message}</p>}</section>;
}
