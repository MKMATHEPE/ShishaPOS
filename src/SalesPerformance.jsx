import { zaDay } from './overviewModel.js';
import { shiftSalesMonth } from './salesPerformanceModel.js';
import { useState } from 'react';
import ProfitGrowth from './ProfitGrowth.jsx';
export default function SalesPerformance({days,manualSales=[],month,allExpenses=[]}) {
  const [metric,setMetric]=useState('revenue');
  const currentMonth=zaDay(new Date()).slice(0,7);
  const [selectedMonth,setSelectedMonth]=useState(()=>{const initial=month ?? days.at(-1)?.slice(0,7) ?? currentMonth;return initial>currentMonth?currentMonth:initial;});
  const monthTitle=new Date(`${selectedMonth}-01T12:00:00+02:00`).toLocaleDateString('en-ZA',{timeZone:'Africa/Johannesburg',month:'long',year:'numeric'});
  return <details className="overview-card overview-collapsible"><summary><h2>Sales performance</h2></summary><div className="overview-collapsible-content sales-performance">
    <div className="sales-chart-toolbar"><div role="group" aria-label="Sales chart measure">{['revenue','expenses','profit'].map(value=><button key={value} type="button" aria-pressed={metric===value} onClick={()=>setMetric(value)}>{value==='revenue'?'Revenue':value==='expenses'?'Expenses':'Profit'}</button>)}</div><small>Cumulative</small></div>
    <div className="sales-month-selector" role="group" aria-label="Chart month">
      <button type="button" aria-label="Previous month" disabled={selectedMonth<='1900-01'} onClick={()=>setSelectedMonth(shiftSalesMonth(selectedMonth,-1))}>‹</button>
      <label><span>{monthTitle}</span><input aria-label="Choose chart month" type="month" min="1900-01" max={currentMonth} value={selectedMonth} onChange={event=>{const value=event.target.value;if(/^\d{4}-\d{2}$/.test(value)&&value>='1900-01'&&value<=currentMonth)setSelectedMonth(value);}} /></label>
      <button type="button" aria-label="Next month" disabled={selectedMonth>=currentMonth} onClick={()=>setSelectedMonth(shiftSalesMonth(selectedMonth,1))}>›</button>
    </div>
    <ProfitGrowth key={selectedMonth} measure={metric} month={selectedMonth} expenses={allExpenses} manualSales={manualSales} />
  </div></details>;
}
