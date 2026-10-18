import MonthlyWeeks from './MonthlyWeeks.jsx';
import { useEffect, useState } from 'react';
import { fetchOrdersByDateRange } from './db';
import { periodDays, previousPeriod, periodRecords, performance, changeLabel, chartTotals } from './overviewModel';

const money=value=>`R${Number(value).toLocaleString('en-ZA',{maximumFractionDigits:0})}`;
const photo={lk:'lady-killer.webp',mc:'cream-mint.webp',bn:'berlin-nights.jpg',gm:'gum-mint.webp',jk:'joker.jpg',hh:'honey-hunter.jpg'};
export default function ManagementOverview({orders,expenses,from,to,timeFrom,timeTo,loading}) {
  const [comparison,setComparison]=useState({key:'',orders:null});
  const previous=previousPeriod(from,to);
  const key=`${previous.from}/${previous.to}`;
  useEffect(()=>{
    let alive=true;
    fetchOrdersByDateRange(`${previous.from}T00:00:00+02:00`,`${previous.to}T23:59:59+02:00`).then(rows=>{if(alive)setComparison({key,orders:rows});});
    return ()=>{alive=false;};
  },[key,previous.from,previous.to]);
  const current=periodRecords(orders,from,to,timeFrom,timeTo);
  const prior=comparison.key===key&&comparison.orders?periodRecords(comparison.orders,previous.from,previous.to,timeFrom,timeTo):null;
  const metrics=performance(current), before=prior?performance(prior):null;
  const spent=periodRecords(expenses,from,to,timeFrom,timeTo).reduce((s,e)=>s+Number(e.amount),0);
  const priorSpent=periodRecords(expenses,previous.from,previous.to,timeFrom,timeTo).reduce((s,e)=>s+Number(e.amount),0);
  const days=periodDays(from,to), priorDays=periodDays(previous.from,previous.to);
  const {values,hours}=chartTotals(current,days);
  const oldValues=chartTotals(prior??[],priorDays).values;
  const max=Math.max(1,...values,...oldValues);
  const points=series=>series.map((value,i)=>`${30+i*300/Math.max(1,series.length-1)},${112-value/max*90}`).join(' ');
  const flavours=Object.values(current.reduce((all,o)=>{
    const id=o.flavour?.id??o.flavour,name=o.flavour?.name??String(o.flavour??'Unknown');
    all[id]??={id,name,count:0,revenue:0};all[id].count++;all[id].revenue+=Number(o.price);return all;
  },{})).sort((a,b)=>b.count-a.count);
  const hourMax=Math.max(1,...hours.map(h=>h.count));
  const percent=value=>metrics.orders?Math.round(value/metrics.orders*100):0;
  return <div className="management-overview" aria-busy={loading}>
    <p className="overview-comparison">Compared with {previous.from} – {previous.to} · same weekdays and hours{loading?' · Updating…':''}</p>
    <section className="overview-card overview-performance-summary"><h2>Performance summary</h2><div className="overview-kpis">{[
      ['Revenue',money(metrics.revenue),before?changeLabel(metrics.revenue,before.revenue):'Loading comparison…'],
      ['Orders',metrics.orders,before?changeLabel(metrics.orders,before.orders):'Loading comparison…'],
      ['Average sale',metrics.orders?money(metrics.average):'—',before?changeLabel(metrics.average,before.average):'Loading comparison…'],
      ['Expenses',money(spent),changeLabel(spent,priorSpent)],
    ].map(([label,value,change])=><div className="overview-kpi" data-metric={label} key={label}><span>{label}</span><strong>{value}</strong><small data-trend={change.startsWith('+') ? (label==='Expenses' ? 'negative' : 'positive') : change.startsWith('-') ? (label==='Expenses' ? 'positive' : 'negative') : 'neutral'}>{comparison.key===key&&comparison.orders===null&&label!=='Expenses'?'Comparison unavailable':change.replace('No prior sales','No comparison')}</small></div>)}</div></section>
    <details className="overview-card overview-collapsible"><summary><h2>Sales performance</h2></summary><div className="overview-collapsible-content"><small>Revenue (R) · {from} – {to}</small>
      {current.length?<><svg viewBox="0 0 360 140" role="img" aria-label={`Sales revenue by day, maximum ${money(max)}`}><text x="0" y="15">{Math.ceil(max)}</text><line x1="30" x2="330" y1="112" y2="112" stroke="#d8d4cb"/>{prior&&<polyline points={points(oldValues)} fill="none" stroke="#999" strokeWidth="2" strokeDasharray="5 4"/>}<polyline points={points(values)} fill="none" stroke="#0a0a0a" strokeWidth="2.5"/>{values.map((v,i)=><circle key={i} cx={30+i*300/Math.max(1,values.length-1)} cy={112-v/max*90} r="3" fill="#0a0a0a"><title>{days[i]}: {money(v)}</title></circle>)}</svg><div className="overview-chart-labels"><span>{from.slice(5)}</span><span>{to.slice(5)}</span></div><p className="overview-legend">━ Current period · ┄ Previous period</p><details><summary>Daily totals</summary>{days.map((day,i)=><div className="overview-detail-row" key={day}><span>{day}</span><strong>{money(values[i])}</strong><span>Prior {prior?money(oldValues[i]):'—'}</span></div>)}</details></>:<p>No sales in this period.</p>}
    </div></details>
    <MonthlyWeeks month={to.slice(0,7)} liveOrders={orders} />
    <details className="overview-card overview-collapsible"><summary><h2>Top flavours</h2></summary><div className="overview-collapsible-content">{!flavours.length?<p>No flavour sales in this period.</p>:<table><thead><tr><th>Flavour</th><th>Orders</th><th>Revenue</th><th>Share</th></tr></thead><tbody>{flavours.map(f=><tr key={f.id}><td><span className="overview-flavour">{photo[f.id]&&<img src={`/brand/${photo[f.id]}`} alt=""/>}{f.name}</span></td><td>{f.count}</td><td>{money(f.revenue)}</td><td>{percent(f.count)}%</td></tr>)}</tbody></table>}</div></details>
    <details className="overview-card overview-collapsible"><summary><h2>Busy hours</h2></summary><div className="overview-collapsible-content"><small>Orders · South African time</small><div className="overview-hours">{hours.map(h=><div key={h.hour}><div className="overview-hour-track"><span style={{height:`${h.count/hourMax*100}%`}} title={`${String(h.hour).padStart(2,'0')}:00–${String(h.hour+1).padStart(2,'0')}:59: ${h.count} orders`}/></div><small>{h.hour}</small><b>{h.count}</b></div>)}</div></div></details>

  </div>;
}
