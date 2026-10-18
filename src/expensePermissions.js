export function canManageExpense(expense, userId, isAdmin) {
  return !!userId && (isAdmin || (expense.submittedBy ?? expense.paidBy) === userId);
}
