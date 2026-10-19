import { useEffect,useState } from 'react';
import {profitDays,profitMonths} from './salesPerformanceModel.js';
import {periodDays,periodRecords,zaDay} from './overviewModel.js';
import {fetchOrdersByDateRange} from './db.js';
const money=value=>`R${Number(value).toLocaleString('en-ZA',{maximumFractionDigits:0})}`;
const monthLabel=month=>new Date(`${month}-01T12:00:00+02:00`).toLocaleDateString('en-ZA',{timeZone:'Africa/Johannesburg',month:'short',year:'numeric'});
export default function ProfitGrowth({month,expenses,manualSales,measure='profit'}) {
  const isExpenses=measure==='expenses';
  const label=isExpenses?'expenses':measure==='revenue'?'revenue':'profit';
  const [history,setHistory]=useState({month:'',orders:null,error:false});
  const [selected,setSelected]=useState(null);
  const [retry,setRetry]=useState(0);
  const ranges=profitMonths(month);
  const from=ranges[2].from,to=ranges[0].to;
  useEffect(()=>{
    let active=true;
    fetchOrdersByDateRange(`${from}T00:00:00+02:00`,`${to}T23:59:59.999+02:00`).then(orders=>{
      if(active)setHistory({month,orders,error:orders===null});
    }).catch(()=>{if(active)setHistory({month,orders:null,error:true});});
    return ()=>{active=false;};
  },[month,from,to,retry]);
  const loading=history.month!==month;
  const today=zaDay(new Date());
  const series=ranges.map(range=>{
    const dates=periodDays(range.from,range.to).filter(date=>date<=today);
    let running=0;
    const rows=profitDays(periodRecords(history.orders??[],range.from,range.to),expenses,manualSales,dates).map(row=>{running+=isExpenses?row.expenses:row.received;return {...row,chartValue:measure==='profit'?row.profit:running};});
    return {...range,rows};
  });
  const axisDays=Math.max(...ranges.map(range=>Number(range.to.slice(8))));
  const values=series.flatMap(item=>item.rows.map(row=>row.chartValue));
  const min=Math.min(0,...values),max=Math.max(0,...values),range=max-min||1;
  const x=day=>day*334/axisDays,y=value=>112-(value-min)/range*88;
  const axisLabels=series.map((item,index)=>({index,month:item.month,value:item.rows.at(-1)?.chartValue??0})).map(item=>({...item,position:y(item.value)})).sort((a,b)=>a.position-b.position);
  axisLabels.forEach((item,index)=>{item.labelY=Math.max(item.position,index?axisLabels[index-1].labelY+13:24);});
  for(let index=axisLabels.length-1;index>=0;index--) axisLabels[index].labelY=Math.min(axisLabels[index].labelY,index===axisLabels.length-1?112:axisLabels[index+1].labelY-13);
  const selectDay=day=>setSelected(day);
  return <div className="profit-growth">
    {loading?<p role="status">Loading monthly {label}…</p>:history.error?<p role="alert">Could not load {label} history. <button onClick={()=>{setHistory({month:'',orders:null,error:false});setRetry(value=>value+1);}}>Retry</button></p>:<>
      <svg viewBox="0 0 360 145" aria-label={`Cumulative monthly ${label} compared with the previous two months`}>
        <line x1="0" x2="0" y1="24" y2="112" className="sales-axis"/>
        <line x1="0" x2="334" y1={y(0)} y2={y(0)} className="sales-axis" strokeDasharray="3 3"/>
        {[2,1,0].map(index=>{const item=series[index];return item.rows.length>0&&<polyline key={item.month} points={`0,${y(0)} ${item.rows.map(row=>`${x(Number(row.date.slice(8)))},${y(row.chartValue)}`).join(' ')}`} fill="none" className={`profit-month-line profit-month-${index}`} strokeWidth={index===0?'1.8':'1.4'} strokeDasharray={index===1?'5 4':index===2?'2 4':undefined}/>;})}
        {Array.from({length:axisDays},(_,index)=>index+1).map(day=><g key={day} role="button" tabIndex="0" aria-label={`Compare ${label} on day ${day}`} onClick={()=>selectDay(day)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectDay(day);}}}><rect x={x(day)-167/axisDays} y="20" width={334/axisDays} height="96" fill="transparent"/>{selected===day&&<line x1={x(day)} x2={x(day)} y1="22" y2="112" className="sales-axis"/>}</g>)}
        {axisLabels.map(item=><g key={item.month} className={`profit-axis-value profit-axis-${item.index}`} pointerEvents="none"><text x="0" y={item.labelY+3}>{money(item.value)}</text></g>)}
      </svg>
      <div className="overview-chart-labels profit-chart-dates"><span>Day 1</span><span>Day 7</span><span>Day 14</span><span>Day 21</span><span>Day {axisDays}</span></div>
      {selected && <p className="sales-point-detail" role="status">Day {selected} · {series.map(item=>{const row=item.rows.find(row=>Number(row.date.slice(8))===selected);return `${monthLabel(item.month)}: ${row?money(row.chartValue):'—'}`;}).join(' · ')}</p>}
    </>}
  </div>;
}
