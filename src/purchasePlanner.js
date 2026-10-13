const DAY = 86400000;
const zaDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const dayDate = key => new Date(`${key}T00:00:00Z`);
const keyOf = value => value.toISOString().slice(0, 10);

export function planWeekend(stock, orders, usage, packs, now = new Date()) {
  const today = dayDate(zaDate(now));
  const friday = new Date(today);
  friday.setUTCDate(friday.getUTCDate() + (5 - friday.getUTCDay() + 7) % 7);
  const tuesday = new Date(friday); tuesday.setUTCDate(tuesday.getUTCDate() + 4);
  const cutoff = new Date(today); cutoff.setUTCDate(cutoff.getUTCDate() - 56);
  const history = orders.filter(order => {
    const date = zaDate(order.time);
    return date >= keyOf(cutoff) && date < keyOf(today) && !['cancelled', 'canceled'].includes(order.status) && !order.pendingSync;
  });
  const first = history.length ? history.map(order => zaDate(order.time)).sort()[0] : null;
  const days = Array(7).fill(0);
  if (first) for (let date = dayDate(first); date < today; date = new Date(+date + DAY)) days[date.getUTCDay()]++;
  const totalDays = days.reduce((a, b) => a + b, 0);
  const estimate = matching => [5, 6, 0, 1, 2].reduce((sum, weekday) => {
    const count = matching.filter(order => dayDate(zaDate(order.time)).getUTCDay() === weekday).length;
    return sum + (days[weekday] ? count / days[weekday] : matching.length / Math.max(1, totalDays));
  }, 0);
  const forecast = estimate(history);
  const items = stock.flatMap(item => {
    const entries = item.subItems ? item.subItems.map(sub => ({ ...sub, demand: estimate(history.filter(order => (typeof order.flavour === 'object' ? order.flavour.id === sub.id : order.flavour === sub.name))) * (usage.flavours[sub.id] ?? 0), unit: 'boxes', packSize: 1 }))
      : usage[item.name] ? [{ ...item, demand: forecast * usage[item.name], packSize: packs[item.name]?.size ?? 1 }] : [];
    return entries.map(entry => {
      const needed = Math.ceil(Math.max(0, entry.demand) * 1000 - 1e-7) / 1000;
      const shortage = Math.max(0, needed - Math.max(0, entry.quantity));
      const buy = Math.max(0, Math.ceil(shortage / entry.packSize - 1e-9));
      return { ...entry, needed, buy, purchaseUnit: entry.packSize > 1 ? packs[item.name].plural : entry.unit, purchaseQuantity: buy * entry.packSize };
    });
  }).sort((a, b) => b.buy - a.buy || a.name.localeCompare(b.name));
  return { items, forecast, first, totalDays, samples: days, limited: [5,6,0,1,2].some(day => days[day] < 2), from: keyOf(friday), to: keyOf(tuesday) };
}
