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

export function profitDays(orders,expenses,manualSales,days) {
  const rows=salesDays(orders,days).map(row=>({...row,received:row.revenue,expenses:0,dailyProfit:0,profit:0}));
  const byDate=new Map(rows.map(row=>[row.date,row]));
  for(const expense of expenses) {
    const row=byDate.get(zaDay(expense.time));
    if(row) row.expenses+=Number(expense.amount);
  }
  for(const sale of manualSales) {
    const row=byDate.get(sale.date);
    if(row) row.received+=Number(sale.amount);
  }
  let total=0;
  for(const row of rows) {row.dailyProfit=row.received-row.expenses;total+=row.dailyProfit;row.profit=total;}
  return rows;
}

export function profitMonths(month) {
  const [year,number]=month.split('-').map(Number);
  return [0,1,2].map(offset=>{
    const first=new Date(Date.UTC(year,number-1-offset,1));
    const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0));
    return {month:first.toISOString().slice(0,7),from:first.toISOString().slice(0,10),to:last.toISOString().slice(0,10)};
  });
}
