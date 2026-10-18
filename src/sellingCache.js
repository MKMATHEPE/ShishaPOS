const KEY = 'chill-pipe:selling-cache-v1';
export function readSellingCache(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(KEY));
    return value?.version === 1 && Array.isArray(value.stock) && value.stock.length && value.stock.every(item=>Number.isFinite(Number(item.quantity ?? 0))) ? value : null;
  } catch { return null; }
}
export function cacheSellingData(patch, storage = globalThis.localStorage) {
  try {
    const existing = JSON.parse(storage.getItem(KEY) ?? 'null');
    const value = {...(existing?.version === 1 ? existing : {}), ...patch, version:1};
    storage.setItem(KEY,JSON.stringify(value));return true;
  } catch { return false; }
}
