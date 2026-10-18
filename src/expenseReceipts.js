import { supabase } from './supabase';
import { validateReceipt } from './receiptValidation.js';
const BUCKET = 'expense-receipts';
// Re-encode to reduce upload size and remove photo metadata.
export async function uploadReceipt(file, userId) {
  validateReceipt(file);
  const image = new Image();
  const source = URL.createObjectURL(file);
  let blob;
  try {
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1,Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));
    if (!blob) throw new Error('Could not prepare receipt. Choose another image.');
  } finally { URL.revokeObjectURL(source); }
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const {error} = await supabase.storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:false});
  if (error) throw new Error(`Receipt upload failed. Your expense has not been saved. ${error.message}`);
  return path;
}
export async function receiptUrl(path) {
  const {data,error} = await supabase.storage.from(BUCKET).createSignedUrl(path,60);
  if (error) throw new Error('Could not open receipt. Please try again.');
  return data.signedUrl;
}
