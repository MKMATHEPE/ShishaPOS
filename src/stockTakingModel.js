export function stockLines(stock) {
  return stock.flatMap(item => item.subItems ? item.subItems.map(sub => ({ key: `${item.id}:${sub.id}`, name: sub.name, unit: 'boxes', quantity: Number(sub.quantity), category: item.category, flavour: sub })) : [{ key: String(item.id), name: item.name, unit: item.unit, quantity: Number(item.quantity), category: item.category }]).sort((a,b) => Number(a.category === 'equipment') - Number(b.category === 'equipment'));
}
export function countPayload(lines, draft, additions = false) {
  const result = {};
  for (const item of lines) {
    const raw = draft[item.key];
    if (additions && (raw === '' || raw == null)) continue;
    const quantity = Number(raw);
    if (raw === '' || raw == null || !Number.isFinite(quantity) || quantity < 0 || quantity > 10000000) throw new Error(`Enter a valid quantity for ${item.name}.`);
    if (!additions || quantity > 0) result[item.key] = quantity;
  }
  if (!Object.keys(result).length) throw new Error('Enter stock to add.');
  return result;
}
export function reconcileStock(lines, counted) {
  return lines.map(item => ({ ...item, counted: counted[item.key], difference: Math.round((counted[item.key] - item.quantity) * 1000) / 1000 }));
}

export function stockAfterAddition(available, added) {
  return Math.round((Number(available) + Number(added || 0)) * 1000) / 1000;
}

export function initialCountDraft(lines) {
  return Object.fromEntries(lines.map(item => [item.key, String(item.quantity)]));
}
