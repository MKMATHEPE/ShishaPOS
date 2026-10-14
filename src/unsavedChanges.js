import { useEffect, useId } from 'react';
import { createDraftGuard } from './draftGuard.js';
const guard = createDraftGuard();
export const hasUnsavedChanges = () => guard.hasChanges();
export function useUnsavedChanges(dirty) {
  const id = useId();
  useEffect(() => {
    guard.set(id, dirty);
    return () => guard.set(id, false);
  }, [id, dirty]);
}
export function installDraftProtection() {
  const handler = event => guard.beforeUnload(event);
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
export function confirmDiscard() {
  return guard.confirm(message => window.confirm(message));
}
