import { zaDay } from './overviewModel.js';
export function salesDays(orders,days) {
  const totals=new Map(days.map(date=>[date,{date,revenue:0,orders:0}]));
  for(const order of orders) {
    const row=totals.get(zaDay(order.time));
    if(row){row.revenue+=Number(order.price);row.orders++;}
  }
  return [...totals.values()];
}
export function salesInsights(rows,metric) {
  const total=rows.reduce((sum,row)=>sum+row[metric],0);
  const best=rows.reduce((best,row)=>!best || row[metric]>best[metric] ? row : best,null);
  return {best:total>0 ? best : null,average:rows.length ? total/rows.length : 0};
}
