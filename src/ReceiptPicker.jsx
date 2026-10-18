import { useEffect, useRef, useState } from 'react';
import { validateReceipt } from './receiptValidation.js';
export default function ReceiptPicker({file,onChange}) {
  const input = useRef(null);
  const camera = useRef(null);
  const [preview,setPreview] = useState(()=>file ? URL.createObjectURL(file) : '');
  const [error,setError] = useState('');
  useEffect(()=>()=>{if (preview) URL.revokeObjectURL(preview);},[preview]);
  const choose = event => {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    try { validateReceipt(selected); setPreview(URL.createObjectURL(selected)); onChange(selected); setError(''); }
    catch(error) { setError(error.message); }
  };
  return <section className="receipt-picker" aria-label="Receipt attachment">
    <span>Receipt <span className="expense-optional">(optional)</span></span>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} hidden />
    <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choose} hidden />
    {file ? <div className="receipt-preview">
      <img src={preview} alt="Selected receipt" />
      <div><span className="receipt-filename">{file.name}</span><div className="receipt-controls"><a href={preview} target="_blank" rel="noreferrer">View</a><button type="button" onClick={()=>input.current.click()}>Replace</button><button type="button" onClick={()=>{onChange(null);setError('');}}>Remove</button></div></div>
    </div> : <div className="receipt-upload">
      <button type="button" className="receipt-choose" onClick={()=>input.current.click()}><span aria-hidden="true">＋</span><span><strong>Add receipt</strong><small>Take a photo or choose an image</small></span></button>
      <button type="button" className="receipt-camera" onClick={()=>camera.current.click()} aria-label="Take receipt photo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/></svg></button>
    </div>}
    {error && <p className="expense-error" role="alert">{error}</p>}
  </section>;
}
