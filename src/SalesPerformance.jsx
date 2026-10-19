import { useState } from 'react';
import ProfitGrowth from './ProfitGrowth.jsx';
export default function SalesPerformance({days,manualSales=[],month,allExpenses=[]}) {
  const [metric,setMetric]=useState('revenue');
  return <details className="overview-card overview-collapsible"><summary><h2>Sales performance</h2></summary><div className="overview-collapsible-content sales-performance">
    <div className="sales-chart-toolbar"><div role="group" aria-label="Sales chart measure">{['revenue','expenses','profit'].map(value=><button key={value} type="button" aria-pressed={metric===value} onClick={()=>setMetric(value)}>{value==='revenue'?'Revenue':value==='expenses'?'Expenses':'Profit'}</button>)}</div><small>Cumulative</small></div>
    <ProfitGrowth measure={metric} month={month ?? days.at(-1)?.slice(0,7)} expenses={allExpenses} manualSales={manualSales} />
  </div></details>;
}
