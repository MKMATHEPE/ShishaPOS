const DB_NAME = 'chill-pipe-pos'
const DB_VERSION = 1
const STORE_NAME = 'pending-orders'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore(mode, action) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const request = action(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error)
  })
}

export function queueOfflineOrder(order) {
  return withStore('readwrite', store => store.put({
    ...order,
    flavour: typeof order.flavour === 'object' ? order.flavour.name : order.flavour,
    time: order.time instanceof Date ? order.time.toISOString() : order.time,
    queuedAt: new Date().toISOString(),
  }))
}

export async function getOfflineOrders() {
  const orders = await withStore('readonly', store => store.getAll())
  return orders.sort((a, b) => new Date(a.time) - new Date(b.time))
}

export function removeOfflineOrder(id) {
  return withStore('readwrite', store => store.delete(id))
}

