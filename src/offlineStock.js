// Estimates never overwrite the last confirmed server quantities.
export function estimatedStock(stock, pending) {
  const result = structuredClone(stock);
  for (const item of result) {
    if (item.category === 'consumable' && item.name === 'Coal') item.quantity = Math.max(0, Number(item.quantity) - 2 * pending.length);
  }
  return result;
}
