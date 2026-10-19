import {Fragment,useEffect,useRef,useState} from 'react';
import {stockLines} from './stockTakingModel.js';
import {buildShiftReview,validReviewAmount,sortReviewFlavours} from './shiftReviewModel.js';
import {fetchReviewSetup,fetchReviewInterval,saveShiftReview} from './shiftReviewDb.js';
import {confirmDiscard,useUnsavedChanges} from './unsavedChanges';
import {recordDiagnostic} from './monitoring';
const money=value=>`R${Number(value).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const number=value=>Number(value.toFixed(2)).toLocaleString('en-ZA');
const shortCountDate=value=>new Date(value).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).replace(',',' ·');
const date=value=>new Date(value).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
export default function ShiftReview({stock,pendingOrders}) {
 const [setup,setSetup]=useState(null),[selection,setSelection]=useState({start:'',end:''});
 const [interval,setIntervalData]=useState(null),[retry,setRetry]=useState(0),[error,setError]=useState('');
 const [draft,setDraft]=useState({cash:'',card:'',note:'',coal:false}),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
 const [historyId,setHistoryId]=useState(null),[showNote,setShowNote]=useState(false);
 const saveId=useRef(crypto.randomUUID()),running=useRef(false),submitted=useRef(null);
 const dirty=!saved&&(draft.cash!==''||draft.card!==''||draft.note!==''||draft.coal);
 useUnsavedChanges(dirty);
 useEffect(()=>{
  let alive=true;
  fetchReviewSetup().then(data=>{if(!alive)return;setSetup(data);setSelection({start:data.counts[1]?.id??'',end:data.counts[0]?.id??''});setError('');}).catch(()=>{if(alive)setError('Could not load shift reviews. Check your connection and try again.');});
  return()=>{alive=false;};
 },[retry]);
 const start=setup?.counts.find(row=>row.id===selection.start),end=setup?.counts.find(row=>row.id===selection.end);
 const intervalKey=`${selection.start}/${selection.end}`;
 useEffect(()=>{
  if(!start||!end||+new Date(start.closed_at)>=+new Date(end.closed_at))return;
  let alive=true;
  fetchReviewInterval(start,end).then(data=>{if(alive){setIntervalData({key:intervalKey,data});setError('');}}).catch(()=>{if(alive){setIntervalData({key:intervalKey,error:true});setError('Could not load this comparison. Try again.');}});
  return()=>{alive=false;};
 },[start,end,intervalKey,retry]);
 const change=fields=>{setDraft(value=>({...value,...fields}));setSaved(false);if(submitted.current){saveId.current=crypto.randomUUID();submitted.current=null;}};
 const choose=async(field,value)=>{
  if(!await confirmDiscard())return;
  setSelection(current=>({...current,[field]:value}));setDraft({cash:'',card:'',note:'',coal:false});setSaved(false);setError('');saveId.current=crypto.randomUUID();submitted.current=null;
 };
 const validInterval=start&&end&&+new Date(start.closed_at)<+new Date(end.closed_at);
 const result=validInterval&&interval?.key===intervalKey&&interval.data?buildShiftReview({start,end,lines:stockLines(stock),trackingStart:setup.trackingStart,...interval.data}):null;
 const flavourRows=result?sortReviewFlavours(result.flavours):[];
 const chartMax=Math.max(1,...flavourRows.flatMap(row=>[row.recorded,row.high??0]));
 const valid=validReviewAmount(draft.cash)&&validReviewAmount(draft.card);
 const save=async()=>{
  if(!result||!valid||running.current||pendingOrders||saved)return;
  running.current=true;setBusy(true);setError('');
  // Freeze the snapshot on first attempt, including after an uncertain response.
  const record=submitted.current??{id:saveId.current,start_count:start.id,end_count:end.id,actual_cash:draft.cash===''?null:Number(draft.cash),actual_card:draft.card===''?null:Number(draft.card),coal_confirmed:draft.coal,explanation:draft.note,snapshot:result};
  submitted.current=record;
  try{const review=await saveShiftReview(record);setSetup(current=>({...current,reviews:[review,...current.reviews.filter(row=>row.id!==review.id)].slice(0,50)}));setSaved(true);}
  catch{recordDiagnostic('save_failed','shift_review_save_failed');setError('Review was not confirmed. Your entries are kept. Try saving again.');}
  finally{running.current=false;setBusy(false);}
 };
 const historical=setup?.reviews.find(row=>row.id===historyId);
 const reload=async()=>{if(!await confirmDiscard())return;setSetup(null);setIntervalData(null);setDraft({cash:'',card:'',note:'',coal:false});setSaved(false);submitted.current=null;saveId.current=crypto.randomUUID();setRetry(value=>value+1);};
 return <div className="shift-review">
  <div className="shift-review-heading"><h2>Shift review</h2><button type="button" disabled={busy} onClick={reload}>Refresh</button></div>
  {error&&<p role="alert" className="review-warning">{error}</p>}
  {!setup&&!error&&<p role="status">Loading stock counts…</p>}
  {setup&&setup.counts.length<2&&<section className="frosted-card review-card"><p>Save at least two remaining stock counts to compare usage.</p></section>}
  {setup&&setup.counts.length>=2&&<>
   <section className="frosted-card review-card review-count-card"><h3>Flavour reconciliation</h3>
    <div className="review-count-selectors">{[['start','From count'],['end','To count']].map(([field,label])=><label key={field}>{label}<span className="review-date-control"><span className="review-selected-date" aria-hidden="true">{shortCountDate((field==='start'?start:end).closed_at)}</span><select disabled={busy} value={selection[field]} onChange={event=>choose(field,event.target.value)}>{setup.counts.map(row=><option key={row.id} value={row.id}>{date(row.closed_at)}</option>)}</select></span></label>)}</div>
    {!validInterval?<p role="status">Choose a From count earlier than the To count.</p>:!result&&!error?<p role="status">Loading comparison…</p>:null}
    {result&&<>
     {!result.tracked&&<details className="review-estimate-info"><summary>Historical estimate <span aria-hidden="true">ⓘ</span></summary><p>Purchase tracking started {date(setup.trackingStart)}. Earlier purchases may have been edited or removed. These comparisons are estimates, not confirmed shortages.</p></details>}
     <div className="review-chart-legend"><span><i/>Recorded orders</span><span><i/>Estimated usage range</span></div>
     <table className="review-flavour-table"><thead><tr><th scope="col">Flavour</th><th scope="col">Orders</th><th scope="col">Estimated usage<br/><span>servings</span></th></tr></thead><tbody>{flavourRows.map(row=><Fragment key={row.key}>
      <tr className="review-flavour-values"><th scope="row">{row.name}</th><td>{row.recorded}</td><td>{row.low===null?'Unavailable':`${number(row.low)}–${number(row.high)}`}</td></tr>
      <tr className="review-flavour-chart"><td colSpan={3}><div className="review-bars" role="img" aria-label={`${row.name}: ${row.recorded} recorded orders, ${row.low===null?'usage unavailable':`${number(row.low)} to ${number(row.high)} estimated servings`}`}><div className="review-order-bar" style={{width:`${row.recorded/chartMax*100}%`}}/><div className="review-range-track">{row.low!==null&&<i style={{left:`${row.low/chartMax*100}%`,width:`${Math.max(.5,(row.high-row.low)/chartMax*100)}%`}}/>}</div></div>{(result.tracked||row.status==='Check counts')&&<small className={row.status==='Review difference'||row.status==='Check counts'?'review-warning':row.status==='Within range'?'review-matched':''}>{row.status}</small>}</td></tr>
     </Fragment>)}</tbody></table>
     {!flavourRows.length&&<p>No flavour usage or orders recorded for these counts.</p>}
     <details className="review-calculation-info"><summary>How it’s calculated</summary><p>Opening count + stock added − closing count = boxes used. Multiply boxes used by 3–3.5 servings per box to estimate usage. Compare this range with recorded orders. Waste, portions and counting errors can cause differences.</p></details>
    </>}
   </section>
   {!!pendingOrders&&<p className="review-warning">Sync queued sales before saving this review.</p>}
   {result&&<>
    <section className="frosted-card review-card"><h3>Payments</h3><small>Recorded POS receipts; exclude cash float and account separately for cash payouts.</small>{(result.manualSalesExcluded>0||result.unknownPayments>0)&&<p className="review-warning">{result.manualSalesExcluded} missing-sale adjustments excluded because their time is unknown. {result.unknownPayments} orders have an unknown payment method.</p>}
     <div className="review-payment-table"><span/><small>Expected</small><small>Actual</small><small>Difference</small>{['cash','card'].map(method=>{const actual=draft[method],difference=actual===''||!validReviewAmount(actual)?null:Math.round((Number(actual)-result.payments[method])*100)/100;return <div className="review-payment-row" key={method}><strong>{method==='cash'?'Cash':'Card'}</strong><span>{money(result.payments[method])}</span><input disabled={busy} aria-label={`Actual ${method} receipts in rand`} type="number" inputMode="decimal" min="0" step=".01" placeholder="—" value={actual} onChange={event=>change({[method]:event.target.value})}/><span className={difference===0?'review-matched':'review-warning'}>{difference===null?'—':difference===0?'Matched':`${difference>0?'+':'−'}${money(Math.abs(difference))}`}</span></div>;})}</div><small>Blank actual amounts are not recorded.</small>
     {!valid&&<p className="review-warning">Enter a non-negative amount with up to two decimal places.</p>}
     <fieldset disabled={busy}><div className="review-actions"><button type="button" aria-expanded={showNote} onClick={()=>setShowNote(value=>!value)}>Record explanation</button><button type="button" onClick={save} disabled={!valid||saved||!!pendingOrders}>{busy?'Saving…':'Save review'}</button></div>{showNote&&<label className="review-note">Explanation (optional)<textarea maxLength={1000} value={draft.note} onChange={event=>change({note:event.target.value})}/></label>}</fieldset>{saved&&<p role="status" className="review-matched">Review saved.</p>}
    </section>
   </>}
  </>}
  {!!setup?.reviews.length&&<details className="frosted-card review-card"><summary>Previous reviews <small>Latest 50</small></summary><div className="review-history-list">{setup.reviews.map(row=><button type="button" key={row.id} aria-expanded={historyId===row.id} onClick={()=>setHistoryId(historyId===row.id?null:row.id)}>{date(row.created_at)}</button>)}</div>{historical&&<div className="review-saved"><strong>{date(historical.snapshot.from)} → {date(historical.snapshot.to)}</strong>{['cash','card'].map(key=><p key={key}>{key==='cash'?'Cash':'Card'}: expected {money(historical.snapshot.payments[key])} · actual {historical[`actual_${key}`]===null?'Not recorded':money(historical[`actual_${key}`])}</p>)}{historical.snapshot.flavours.map(row=><p key={row.key}>{row.name}: {row.recorded} orders · {row.low===null?'usage unavailable':`${number(row.low)}–${number(row.high)} estimated servings`} · {row.status}</p>)}{historical.explanation&&<p>{historical.explanation}</p>}</div>}</details>}
 </div>;
}
