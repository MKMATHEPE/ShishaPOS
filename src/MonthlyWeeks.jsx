import {useEffect,useMemo,useRef,useState} from 'react';
import {shiftSalesMonth} from './salesPerformanceModel.js';
import {zaDay} from './overviewModel.js';
import {fetchOrdersByDateRange} from './db';
import {tradingMonthBounds,monthlyWeeks} from './monthlyWeeks.js';
const colours=['#8fada0','#ba9d6b','#8298af','#b88d8b','#a49ab8','#a7aa7c'];
const shortDate=value=>new Intl.DateTimeFormat('en-ZA',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`));
const money=value=>`R${value.toLocaleString('en-ZA',{maximumFractionDigits:0})}`;
export default function MonthlyWeeks({month:initialMonth,liveOrders}) {
  const currentMonth=zaDay(new Date()).slice(0,7);
  const [month,setMonth]=useState(()=>initialMonth>currentMonth?currentMonth:initialMonth);
  const swipeStart=useRef(null);
  const moveMonth=direction=>setMonth(value=>{
    const next=shiftSalesMonth(value,direction);
    return next>='1900-01' && next<=currentMonth?next:value;
  });
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
  const bestRevenue=Math.max(0,...data.weeks.map(week=>week.revenue));
  const title=new Intl.DateTimeFormat('en-ZA',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`));
  const stops=data.weeks.reduce((result,week,index)=>({offset:result.offset+week.share,stops:[...result.stops,`${colours[index]} ${result.offset}% ${result.offset+week.share}%`]}),{offset:0,stops:[]}).stops.join(',');
  const ready=history.month===month,failed=ready&&history.orders===null;
  return <details className="overview-card monthly-weeks overview-collapsible"><summary><h2>Weekly performance</h2></summary><div className="overview-collapsible-content"><div className="weekly-month-navigation" role="group" aria-label="Weekly performance month">
    <button type="button" aria-label="Previous weekly month" disabled={month<='1900-01'} onClick={()=>moveMonth(-1)}>‹</button>
    <div className="weekly-month-swipe" onTouchStart={event=>{const touch=event.touches[0];swipeStart.current=event.touches.length===1?{x:touch.clientX,y:touch.clientY}:null;}} onTouchCancel={()=>{swipeStart.current=null;}} onTouchEnd={event=>{
      const start=swipeStart.current;swipeStart.current=null;
      if(!start)return;
      const touch=event.changedTouches[0],dx=touch.clientX-start.x,dy=touch.clientY-start.y;
      if(Math.abs(dx)>=45 && Math.abs(dx)>Math.abs(dy)*1.5)moveMonth(dx<0?1:-1);
    }}><small aria-live="polite">{title} · Sat–Tue 02:00 · share of trading revenue</small></div>
    <button type="button" aria-label="Next weekly month" disabled={month>=currentMonth} onClick={()=>moveMonth(1)}>›</button>
    </div>
    {!ready?<p role="status">Loading monthly sales…</p>:failed?<><p role="status">Monthly sales could not be loaded.</p><button onClick={()=>{setHistory({month:'',orders:null});setRetry(n=>n+1);}}>Try again</button></>:<>
      {data.total>0?<div className="monthly-donut-wrap"><div className="monthly-donut" style={{background:`conic-gradient(${stops})`}} role="img" aria-label={`${title}: ${data.weeks.map(w=>`${w.label} ${w.share.toFixed(1)} percent`).join(', ')}`}><div><strong>{money(data.total)}</strong><span>Trading total</span></div></div></div>:<p>No recorded sales this month.</p>}
      <ul className="monthly-week-legend">{data.weeks.map((week,index)=>{
        const upcoming=week.status==='Upcoming';
        const sameMonth=week.from.slice(0,7)===week.to.slice(0,7);
        const dates=`${sameMonth?Number(week.from.slice(8)):shortDate(week.from)}–${shortDate(week.to)}`;
        const best=bestRevenue>0 && week.revenue===bestRevenue;
        return <li key={week.from} className={`${best?'is-best-week ':''}${upcoming?'is-upcoming-week':''}`}>
          <span className="monthly-week-dot" style={{backgroundColor:colours[index]}} aria-hidden="true"/>
          <span className="monthly-week-description"><strong>{week.label}<span className="monthly-week-dates"> · {dates}</span></strong>{!upcoming&&<small>{week.orders} orders · {week.share.toFixed(1)}%</small>}</span>
          <span className="monthly-week-value">{upcoming?<small>Upcoming</small>:<><strong>{money(week.revenue)}</strong>{week.status==='Incomplete'&&<small>In progress</small>}</>}</span>
        </li>;
      })}</ul>
    </>}
  </div></details>;
}
