import {supabase} from './supabase';
async function rows(table,configure) {
 const result=[];
 for(let offset=0;;offset+=500){
  const {data,error}=await configure(supabase.from(table).select('*')).range(offset,offset+499);
  if(error)throw error;
  result.push(...data);
  if(data.length<500)return result;
 }
}
export async function fetchReviewSetup() {
 if(!supabase)throw Error('Connect before reviewing shifts.');
 const [counts,reviews,tracking]=await Promise.all([
  supabase.from('pos_stocktakes').select('id,closed_at,closing').eq('status','closed').order('closed_at',{ascending:false}).order('id').limit(100),
  supabase.from('pos_shift_reviews').select('*').order('created_at',{ascending:false}).limit(50),
  supabase.from('pos_review_tracking').select('started_at').eq('id',true).single(),
 ]);
 if(counts.error||reviews.error||tracking.error)throw counts.error||reviews.error||tracking.error;
 return {counts:counts.data,reviews:reviews.data,trackingStart:tracking.data.started_at};
}
export async function fetchReviewInterval(start,end) {
 const from=start.closed_at,to=end.closed_at;
 const window=query=>query.gt('recorded_at',from).lte('recorded_at',to).order('recorded_at').order('id');
 const [orders,movements,receipts,expenses,manualSales]=await Promise.all([
  rows('pos_orders',q=>q.gt('time',from).lte('time',to).order('time').order('id')),
  rows('pos_review_stock_movements',window),rows('pos_stock_receipts',window),
  rows('pos_expenses',q=>q.gt('created_at',from).lte('created_at',to).order('created_at').order('id')),
  rows('pos_manual_sales',q=>q.order('sale_date').order('id')),
 ]);
 return {orders,movements,receipts,expenses,manualSales};
}
export async function saveShiftReview(record) {
 // Same ID after a lost response: retry reads the committed review, never duplicates it.
 const {error}=await supabase.from('pos_shift_reviews').upsert(record,{onConflict:'id',ignoreDuplicates:true});
 if(error)throw error;
 const {data,error:readError}=await supabase.from('pos_shift_reviews').select('*').eq('id',record.id).single();
 if(readError)throw readError;
 return data;
}
