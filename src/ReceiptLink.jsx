import { useEffect, useRef, useState } from 'react';
import { receiptUrl } from './expenseReceipts.js';
function ReceiptDialog({url,onClose}) {
  const dialog = useRef(null);
  useEffect(()=>{dialog.current.showModal();},[]);
  return <dialog ref={dialog} aria-label="Expense receipt" className="receipt-dialog" onCancel={onClose}>
    <button type="button" autoFocus onClick={onClose}>Close receipt</button>
    <img src={url} alt="Expense receipt" />
  </dialog>;
}
export default function ReceiptLink({path}) {
  const [busy,setBusy] = useState(false);
  const [url,setUrl] = useState('');
  const [thumbnail,setThumbnail] = useState('');
  const [error,setError] = useState('');
  useEffect(()=>{
    if (!path) return;
    let active = true;
    receiptUrl(path).then(url=>{if(active)setThumbnail(url);}).catch(()=>{if(active)setError('Receipt unavailable. Tap to retry.');});
    return ()=>{active=false;};
  },[path]);
  if (!path) return null;
  const open = async () => {
    setBusy(true); setError('');
    try { const fresh = await receiptUrl(path); setThumbnail(fresh); setUrl(fresh); }
    catch(error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <div className="receipt-saved">
    <button type="button" onClick={open} disabled={busy} aria-label="View receipt" title="View receipt">{thumbnail ? <img src={thumbnail} alt="Receipt preview" loading="lazy" onError={()=>setThumbnail('')} /> : <span>{busy ? 'Loading…' : 'Receipt'}</span>}</button>
    {error && <p role="alert">{error}</p>}
    {url && <ReceiptDialog url={url} onClose={()=>setUrl('')} />}
  </div>;
}
