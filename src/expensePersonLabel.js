// Display alias only; expense ownership and audit IDs remain unchanged.
export function expensePersonLabel(name) {
  return typeof name==='string' && name.trim().toUpperCase()==='MKMATHEPE' ? 'Business' : name;
}
