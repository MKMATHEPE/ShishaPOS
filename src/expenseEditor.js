export function expenseDate(time) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}
export function expenseChanges(original, draft, lockedThrough, today) {
  if (lockedThrough && (expenseDate(original.time) <= lockedThrough || draft.date <= lockedThrough)) throw new Error('This accounting period is locked.');
  const parsedDate = new Date(`${draft.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(+parsedDate) || parsedDate.toISOString().slice(0,10) !== draft.date || draft.date > today) throw new Error('Choose a valid expense date.');
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  let stockQuantities = original.stockQuantities ?? {};
  if (draft.stockKey !== undefined) {
    if (draft.stockKey) {
      const quantity = Number(draft.stockQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000000) throw new Error('Enter a positive quantity bought.');
      stockQuantities = { [draft.stockKey]: quantity };
    } else stockQuantities = {};
  }
  return { stockQuantities, category: draft.category, description: (draft.description ?? '').trim(), amount, paidBy: draft.paidBy || null,
    time: draft.date === expenseDate(original.time) ? original.time : new Date(`${draft.date}T12:00:00+02:00`).toISOString() };
}
