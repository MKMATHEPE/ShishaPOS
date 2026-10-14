export async function saveEquipmentChange(item, write, onSaved) {
  const confirmed = await write(item);
  if (!confirmed) throw new Error('Could not save. Check your connection and try again.');
  onSaved(item);
}
