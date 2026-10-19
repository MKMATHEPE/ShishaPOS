const round=value=>Math.round((value+Number.EPSILON)*1000)/1000;
const nameKey=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function sortReviewFlavours(rows) {
 const gap=row=>row.low===null?0:Math.max(0,row.low-row.recorded,row.recorded-row.high);
 return rows.filter(row=>row.recorded||row.used!==0).sort((a,b)=>gap(b)-gap(a)||b.recorded-a.recorded);
}
const quantity=(counts,key)=>Object.hasOwn(counts??{},key)&&counts[key]!==null&&Number.isFinite(Number(counts[key]))?Number(counts[key]):null;
export function validReviewAmount(value) {
 return value==='' || (value!=null && String(value).trim()!=='' && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=100000000 && Math.abs(Number(value)*100-Math.round(Number(value)*100))<1e-6);
}
export function buildShiftReview({start,end,lines,orders,movements=[],receipts=[],expenses=[],trackingStart,manualSales=[]}) {
 const from=+new Date(start.closed_at),to=+new Date(end.closed_at);
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw Error('Choose an earlier opening count and a later closing count.');
 const inRange=time=>+new Date(time)>from&&+new Date(time)<=to;
 const tracked=Number.isFinite(+new Date(trackingStart))&&from>=+new Date(trackingStart);
 const additions={};const uncertain=new Set();
 const add=counts=>{for(const [key,value] of Object.entries(counts??{}))if(Number.isFinite(Number(value)))additions[key]=(additions[key]??0)+Number(value);};
 for(const row of movements)if(inRange(row.recorded_at))add(row.quantities);
 // Before movement tracking was activated, only a dated estimate is possible.
 if(!tracked)for(const row of expenses)if(inRange(row.created_at)&&(!trackingStart||+new Date(row.created_at)<+new Date(trackingStart)))add(row.stock_quantities);
 for(const row of receipts)if(inRange(row.recorded_at)){
  if(row.kind==='add')add(row.counts);
  else for(const key of Object.keys(row.counts??{}))uncertain.add(key);
 }
 const sales=orders.filter(order=>!order.pendingSync&&!['cancelled','canceled'].includes(order.status)&&inRange(order.time));
 const usage=item=>{
  const opening=quantity(start.closing,item.key),closing=quantity(end.closing,item.key);
  const used=opening===null||closing===null?null:round(opening+(additions[item.key]??0)-closing);
  return {opening,closing,added:round(additions[item.key]??0),used,reliable:tracked&&!uncertain.has(item.key)&&used!==null&&used>=0};
 };
 const flavours=lines.filter(item=>item.flavour).map(item=>{
  const counts=usage(item);
  const recorded=sales.filter(order=>nameKey(typeof order.flavour==='object'?order.flavour.name:order.flavour)===nameKey(item.name)).length;
  const low=counts.used===null||counts.used<0?null:round(counts.used*3),high=low===null?null:round(counts.used*3.5);
  return {key:item.key,name:item.name,...counts,recorded,low,high,status:low===null?'Check counts':!counts.reliable?'Estimate only':recorded>=low-0.001&&recorded<=high+0.001?'Within range':'Review difference'};
 });
 const coalLine=lines.find(item=>nameKey(item.name)==='coal');
 const coal={...(coalLine?usage(coalLine):{used:null,reliable:false}),expected:sales.length*2};
 coal.difference=coal.used===null?null:round(coal.used-coal.expected);
 const payments={cash:0,card:0};let unknownPayments=0;
 for(const order of sales){const amount=Number(order.price);if(!Number.isFinite(amount))continue;if(Object.hasOwn(payments,order.payment))payments[order.payment]+=amount;else unknownPayments++;}
 for(const key of Object.keys(payments))payments[key]=Math.round(payments[key]*100)/100;
 const day=time=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
 const manualInRange=manualSales.filter(row=>row.sale_date>=day(from)&&row.sale_date<=day(to));
 return {version:1,from:start.closed_at,to:end.closed_at,tracked,flavours,coal,payments,orders:sales.length,unknownPayments,manualSalesExcluded:manualInRange.length,assumptions:{servingsLow:3,servingsHigh:3.5,coalPerServing:2,coalPerBox:72}};
}
