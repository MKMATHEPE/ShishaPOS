export function orderPage(orders, requestedPage = 0) {
  const unique = [...new Map(orders.map(order=>[order.id,order])).values()];
  unique.sort((a,b)=>new Date(b.time)-new Date(a.time) || Number(b.id)-Number(a.id));
  const totalPages = Math.max(1,Math.ceil(unique.length / 5));
  const page = Math.max(0,Math.min(requestedPage,totalPages-1));
  return {items:unique.slice(page*5,page*5+5),page,totalPages};
}
