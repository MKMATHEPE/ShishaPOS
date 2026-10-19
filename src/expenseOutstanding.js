export function outstandingExpenses(expenses) {
  const unpaid=expenses.filter(expense=>expense.status==='pending'||expense.status==='approved');
  return {amount:unpaid.reduce((sum,expense)=>sum+Number(expense.amount||0),0),count:unpaid.length};
}
