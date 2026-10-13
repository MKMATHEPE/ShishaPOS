const DAY = 86400000;
export const zaDay = value => new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function periodDays(from, to) {
  const days=[];
  for(let date=new Date(`${from}T00:00:00Z`); date<=new Date(`${to}T00:00:00Z`); date=new Date(+date+DAY)) days.push(date.toISOString().slice(0,10));
  return days;
}
export function previousPeriod(from,to) {
  const shift=Math.ceil(periodDays(from,to).length/7)*7*DAY;
  return {from:new Date(+new Date(`${from}T00:00:00Z`)-shift).toISOString().slice(0,10),to:new Date(+new Date(`${to}T00:00:00Z`)-shift).toISOString().slice(0,10)};
}
export function periodRecords(records,from,to,timeFrom='00:00',timeTo='23:59') {
  return records.filter(row=>{
    if(['cancelled','canceled'].includes(row.status)||row.pendingSync) return false;
    const day=zaDay(row.time);
    const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(row.time));
    return day>=from&&day<=to&&time>=timeFrom&&time<=timeTo;
  });
}
export function performance(orders) {
  const revenue=orders.reduce((sum,row)=>sum+Number(row.price),0);
  return {revenue,orders:orders.length,average:orders.length?revenue/orders.length:0};
}
export function changeLabel(current,previous) {
  if(!previous) return current?'No prior sales':'No change';
  const change=(current-previous)/previous*100;
  return `${change>0?'+':''}${change.toFixed(0)}%`;
}
