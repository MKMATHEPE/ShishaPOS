export function validateProfitPartners(rows) {
  if(!rows.length) return 'Add at least one partner.';
  if(rows.some(row=>!row.profileId)) return 'Choose an account for each partner.';
  if(new Set(rows.map(row=>row.profileId)).size!==rows.length) return 'Choose each partner only once.';
  if(rows.some(row=>!Number.isFinite(Number(row.profitShare))||Number(row.profitShare)<=0||Number(row.profitShare)>100)) return 'Enter a percentage greater than 0 and no more than 100.';
  if(Math.abs(rows.reduce((sum,row)=>sum+Number(row.profitShare),0)-100)>0.000001) return 'Partner percentages must total 100%.';
  return '';
}
