// Paid expenses remain deducted after approval, without a second deduction.
export function approvedExpenseTotal(expenses) {
  return expenses.reduce((sum, expense) =>
    expense.status === 'approved' || expense.status === 'paid'
      ? sum + Number(expense.amount || 0)
      : sum, 0);
}
