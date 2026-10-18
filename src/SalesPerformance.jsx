import { useState } from 'react';
import { salesDays,salesInsights } from './salesPerformanceModel.js';
const money=value=>`R${Number(value).toLocaleString('en-ZA',{maximumFractionDigits:0})}`;
const dateLabel=date=>new Date(`${date}T12:00:00+02:00`).toLocaleDateString('en-ZA',{timeZone:'Africa/Johannesburg',weekday:'short',day:'numeric',month:'short'});
export default function SalesPerformance({orders,prior,days,priorDays,loading}) {
  const [metric,setMetric]=useState('revenue');
  const [selected,setSelected]=useState(null);
  const rows=salesDays(orders,days),oldRows=salesDays(prior??[],priorDays);
  const hasComparison=!!prior?.length;
  const max=Math.max(1,...rows.map(row=>row[metric]),...(hasComparison?oldRows.map(row=>row[metric]):[]));
  const x=index=>rows.length===1?180:30+index*300/Math.max(1,rows.length-1);
  const y=value=>112-value/max*88;
  const points=data=>data.map((row,index)=>`${x(index)},${y(row[metric])}`).join(' ');
  const {best,average}=salesInsights(rows,metric);
  const selectedRow=rows.find(row=>row.date===selected);
  const format=value=>metric==='revenue'?money(value):Number(value.toFixed(1)).toLocaleString('en-ZA');
  return <details className="overview-card overview-collapsible"><summary><h2>Sales performance</h2></summary><div className="overview-collapsible-content sales-performance">
    <div className="sales-chart-toolbar"><div role="group" aria-label="Sales chart measure">{['revenue','orders'].map(value=><button key={value} type="button" aria-pressed={metric===value} onClick={()=>setMetric(value)}>{value==='revenue'?'Revenue':'Orders'}</button>)}</div><small>{metric==='revenue'?'Rand':'Orders'} · Daily</small></div>
    {orders.length || hasComparison ? <>
      <svg viewBox="0 0 360 145" aria-label={`${metric==='revenue'?'Revenue':'Orders'} by day`}>
        <text x="0" y="15">{format(max)}</text><line x1="30" x2="330" y1="112" y2="112" className="sales-axis"/>
        {hasComparison && <polyline points={points(oldRows)} fill="none" className="sales-prior" strokeWidth="2" strokeDasharray="5 4"/>}
        <polyline points={points(rows)} fill="none" className="sales-current" strokeWidth="2.5"/>
        {rows.map((row,index)=><g key={row.date} role="button" tabIndex="0" aria-label={`${dateLabel(row.date)}: ${money(row.revenue)}, ${row.orders} orders`} aria-pressed={selected===row.date} onClick={()=>setSelected(row.date)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(row.date);}}}>
          <circle cx={x(index)} cy={y(row[metric])} r="20" fill="transparent"/>
          <circle cx={x(index)} cy={y(row[metric])} r={selected===row.date?5:3} className="sales-point"/>
        </g>)}
      </svg>
      <div className="overview-chart-labels"><span>{days[0]?.slice(5)}</span><span>{days.at(-1)?.slice(5)}</span></div>
      <p className="sales-legend">━ Current period · {hasComparison?'┄ Previous period':loading?'Loading comparison…':'No comparison'}</p>
      {selectedRow?<p className="sales-point-detail" role="status"><strong>{dateLabel(selectedRow.date)}</strong> · {money(selectedRow.revenue)} · {selectedRow.orders} orders</p>:<p className="sales-point-detail">Tap a point to see revenue and orders.</p>}
    </>:<p>No sales in this period.{loading?' Loading comparison…':' No comparison.'}</p>}
    <div className="sales-insights"><div><span>Best day</span><strong>{best?dateLabel(best.date):'—'}</strong><small>{best?`${format(best[metric])}${metric==='orders'?' orders':''}`:'No sales'}</small></div><div><span>Daily average</span><strong>{format(average)}{metric==='orders'?' orders':''}</strong><small>Across {rows.length} calendar {rows.length===1?'day':'days'}</small></div></div>
    <details><summary>Daily totals</summary>{rows.map((row,index)=><button type="button" className="sales-daily-row" key={row.date} onClick={()=>setSelected(row.date)}><span>{dateLabel(row.date)}</span><strong>{format(row[metric])}</strong><span>Prior {hasComparison?format(oldRows[index]?.[metric]??0):'—'}</span></button>)}</details>
  </div></details>;
}
