export function createDraftGuard() {
  const drafts = new Set();
  return {
    set(id, dirty) { if(dirty) drafts.add(id); else drafts.delete(id); },
    hasChanges() { return drafts.size>0; },
    confirm(confirm) { return !drafts.size || confirm('You have unsaved changes. Discard them and continue?'); },
    beforeUnload(event) { if(!drafts.size) return; event.preventDefault();event.returnValue=''; },
  };
}
