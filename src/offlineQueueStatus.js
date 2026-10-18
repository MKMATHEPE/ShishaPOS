export function blocksSignOut(pending, ownerId, saving = false, syncing = false) {
  return saving || syncing || pending.some(order => order.ownerId === ownerId);
}
