// Estimates never overwrite the last confirmed server quantities.
export function estimatedStock(stock, pending) {
  const result = structuredClone(stock);
  for (const order of pending) {
    const name = typeof order.flavour === 'object' ? order.flavour.name : order.flavour;
    for (const item of result) {
      if (item.category !== 'consumable') continue;
      if (['Coal', 'Mouth Pieces'].includes(item.name)) item.quantity = Math.max(0, Number(item.quantity) - 2);
      if (item.name === 'Flavour') for (const sub of item.subItems ?? []) {
        if (sub.name === name) sub.quantity = Math.max(0, Math.round((Number(sub.quantity) - (['mc','gm'].includes(sub.id) ? .25 : 1/3.5)) * 1000) / 1000);
      }
    }
  }
  return result;
}
