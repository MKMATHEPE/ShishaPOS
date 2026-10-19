export function partnerProfitSplit(profit,partners,payouts=[]) {
  if (!partners.length) return {rows:[],error:'No partners are configured. Add partners and their percentages before allocating profit.'};
  const shares=partners.map(partner=>Number(partner.profitShare||0));
  const total=shares.reduce((sum,share)=>sum+share,0);
  if (new Set(partners.map(partner=>partner.profileId)).size!==partners.length || shares.some(share=>!Number.isFinite(share)||share<0) || (total!==0&&Math.abs(total-100)>0.01)) return {rows:[],error:'Partner percentages must total 100% before profit can be split.'};
  const cents=Math.max(0,Math.round(Number(profit||0)*100));
  const weights=shares.map(share=>total===0?1/partners.length:share/total);
  const allocations=weights.map(weight=>Math.floor(cents*weight));
  const remainders=weights.map((weight,index)=>({index,fraction:cents*weight-allocations[index]})).sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  let leftover=cents-allocations.reduce((sum,value)=>sum+value,0);
  for(let index=0;leftover>0;index++,leftover--) allocations[remainders[index%remainders.length].index]++;
  return {error:null,equal:total===0,rows:partners.map((partner,index)=>{
    const paid=Math.round(payouts.filter(payment=>payment.profileId===partner.profileId).reduce((sum,payment)=>sum+Number(payment.amount||0),0)*100);
    return {profileId:partner.profileId,percentage:weights[index]*100,share:allocations[index]/100,paid:paid/100,remaining:Math.max(0,allocations[index]-paid)/100};
  })};
}
