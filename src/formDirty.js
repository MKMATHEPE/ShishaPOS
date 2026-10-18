// Flat form values: compare against the values shown when editing began.
export function formHasChanges(values, initial) {
  return [...new Set([...Object.keys(values), ...Object.keys(initial)])]
    .some(key => String(values[key] ?? '') !== String(initial[key] ?? ''));
}
