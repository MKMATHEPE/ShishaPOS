import {useEffect,useMemo,useState} from 'react';
import {fetchOrdersByDateRange} from './db';
import {tradingMonthBounds,monthlyWeeks} from './monthlyWeeks.js';
const colours=['#8fada0','#ba9d6b','#8298af','#b88d8b','#a49ab8','#a7aa7c'];
const shortDate=value=>new Intl.DateTimeFormat('en-ZA',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`));
const money=value=>`R${value.toLocaleString('en-ZA',{maximumFractionDigits:0})}`;
export default function MonthlyWeeks({month,liveOrders}) {
  const [history,setHistory]=useState({month:'',orders:null});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let alive=true;const bounds=tradingMonthBounds(month);
    fetchOrdersByDateRange(bounds.from,bounds.to).then(orders=>{if(alive)setHistory({month,orders});},()=>{if(alive)setHistory({month,orders:null});});
    return ()=>{alive=false;};
  },[month,retry]);
  const data=useMemo(()=>{
    const merged=new Map((history.month===month?history.orders??[]:[]).map(o=>[String(o.id),o]));
    for(const order of liveOrders) if(!order.pendingSync) merged.set(String(order.id),order);
    return monthlyWeeks(month,[...merged.values()]);
  },[month,history,liveOrders]);
  const title=new Intl.DateTimeFormat('en-ZA',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`));
  const stops=data.weeks.reduce((result,week,index)=>({offset:result.offset+week.share,stops:[...result.stops,`${colours[index]} ${result.offset}% ${result.offset+week.share}%`]}),{offset:0,stops:[]}).stops.join(',');
  const ready=history.month===month,failed=ready&&history.orders===null;
  return <section className="overview-card monthly-weeks"><h2>Weekly performance</h2><small>{title} · Sat–Tue 02:00 · share of trading revenue</small>
    {!ready?<p role="status">Loading monthly sales…</p>:failed?<><p role="status">Monthly sales could not be loaded.</p><button onClick={()=>{setHistory({month:'',orders:null});setRetry(n=>n+1);}}>Try again</button></>:<>
      {data.total>0?<div className="monthly-donut-wrap"><div className="monthly-donut" style={{background:`conic-gradient(${stops})`}} role="img" aria-label={`${title}: ${data.weeks.map(w=>`${w.label} ${w.share.toFixed(1)} percent`).join(', ')}`}><div><strong>{money(data.total)}</strong><span>Trading total</span></div></div></div>:<p>No recorded sales this month.</p>}
      <ul className="monthly-week-legend">{data.weeks.map((week,index)=><li key={week.from}><span className="monthly-week-dot" style={{backgroundColor:colours[index]}} aria-hidden="true"/><span><strong>{week.label}</strong><small>{shortDate(week.from)}–{shortDate(week.to)} · Tue 02:00{week.status!=='Complete'?` · ${week.status}`:''}</small></span><span className="monthly-week-value"><strong>{money(week.revenue)}</strong><small>{week.share.toFixed(1)}% · {week.orders} orders</small></span></li>)}</ul>
      <p>Each week runs from Saturday 00:00 until Tuesday 02:00, South African time. Weeks belong to the month their Saturday falls in, including sales past month-end. Incomplete weeks are still trading.</p>
    </>}
  </section>;
}
