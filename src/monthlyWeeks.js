const DAY=86400000;
export function monthBounds(month) {
  if(!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(5))<1||Number(month.slice(5))>12) throw new Error('Invalid month');
  const from=`${month}-01`, start=new Date(`${from}T00:00:00Z`);
  const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0));
  return {from,to:end.toISOString().slice(0,10)};
}
export function tradingPeriods(month) {
  const {from,to}=monthBounds(month),weeks=[];
  let start=new Date(`${from}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate()+(6-start.getUTCDay()+7)%7);
  while(start.toISOString().slice(0,10)<=to) {
    const fromKey=start.toISOString().slice(0,10),toKey=new Date(+start+3*DAY).toISOString().slice(0,10);
    weeks.push({label:`Week ${weeks.length+1}`,from:fromKey,to:toKey,start:+new Date(`${fromKey}T00:00:00+02:00`),end:+new Date(`${toKey}T02:00:00+02:00`)});
    start=new Date(+start+7*DAY);
  }
  return weeks;
}
export function tradingMonthBounds(month) {
 const weeks=tradingPeriods(month);
 return {from:new Date(weeks[0].start).toISOString(),to:new Date(weeks.at(-1).end).toISOString()};
}
export function monthlyWeeks(month,orders,now=new Date()) {
  const weeks=tradingPeriods(month).map(week=>({...week,revenue:0,orders:0,status:+now<week.start?'Upcoming':+now<week.end?'Incomplete':'Complete'}));
  for(const order of orders) {
    if(order.pendingSync||['cancelled','canceled'].includes(order.status))continue;
    const time=+new Date(order.time),price=Number(order.price);
    if(!Number.isFinite(time)||time>+now||!Number.isFinite(price)||price<0)continue;
    const week=weeks.find(w=>time>=w.start&&time<w.end);
    if(!week)continue;
    week.revenue+=price;week.orders++;
  }
  const total=weeks.reduce((sum,w)=>sum+w.revenue,0);
  return {weeks:weeks.map(w=>({...w,share:total?w.revenue/total*100:0})),total};
}
