export const RECEIPT_LIMIT = 10 * 1024 * 1024;
export function validateReceipt(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP receipt image.');
  if (!file.size) throw new Error('This image is empty. Choose another receipt.');
  if (file.size > RECEIPT_LIMIT) throw new Error('Choose a receipt image smaller than 10 MB.');
}
