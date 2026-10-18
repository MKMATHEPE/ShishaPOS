export function salePayload(order) {
  const time = new Date(order.time);
  if (!Number.isFinite(+time)) throw new Error('Invalid sale time.');
  const sessionDate = order.sessionDate ?? new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
  return {id:order.id,flavour:typeof order.flavour==='object'?order.flavour.name:order.flavour,type:order.type,payment:order.payment,price:order.price,time:time.toISOString(),session_date:sessionDate,sold_by:order.soldBy??null,shift_id:order.shiftId??null};
}
export async function persistSale(order,{queue,send,remove,online}) {
  // Commit locally first so a lost server response can be retried with the same ID.
  await queue(order);
  if (!online) return {saved:false,pendingSync:true};
  let saved = false;
  try { saved=await send(order); } catch { /* Keep the durable queue entry. */ }
  if (!saved) return {saved:false,pendingSync:true};
  try { await remove(order.id); return {saved:true,pendingSync:false}; }
  catch { return {saved:true,pendingSync:true}; }
}
export async function syncPendingSales({list,send,remove,onSynced,ownerId}) {
  const pending=await list();let synced=0;
  for(const order of pending) {
    if (!ownerId || order.ownerId !== ownerId) continue;
    if(!await send(order)) break;
    await remove(order.id);
    onSynced(order);synced++;
  }
  return synced;
}
