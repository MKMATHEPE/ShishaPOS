import { useEffect, useRef, useState } from 'react';
import { registerDiscardPrompt } from './unsavedChanges';

export default function DraftDiscardDialog({ children }) {
  const [prompt, setPrompt] = useState(null);
  const pending = useRef(null);
  const keepButton = useRef(null);
  useEffect(() => registerDiscardPrompt(() => new Promise(resolve => {
    pending.current?.resolve(false);
    const next = { resolve, focus: document.activeElement };
    pending.current = next;
    setPrompt(next);
  })), []);
  useEffect(() => {
    if (prompt) keepButton.current?.focus();
    return () => { prompt?.focus?.focus?.(); };
  }, [prompt]);
  useEffect(() => () => pending.current?.resolve(false), []);
  const choose = discard => {
    const current = pending.current;
    pending.current = null;
    setPrompt(null);
    current?.resolve(discard);
  };
  return <>{children}{prompt && <div className="draft-dialog-backdrop">
    <div role="alertdialog" aria-modal="true" aria-labelledby="draft-dialog-title" aria-describedby="draft-dialog-description" className="draft-dialog" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); choose(false); }
      if (event.key === 'Tab') {
        const buttons = event.currentTarget.querySelectorAll('button');
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault();buttons[1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault();buttons[0].focus(); }
      }
    }}>
      <h2 id="draft-dialog-title">Unsaved changes</h2>
      <p id="draft-dialog-description">Keep editing, or discard your changes and continue?</p>
      <div><button ref={keepButton} onClick={() => choose(false)}>Keep editing</button><button onClick={() => choose(true)}>Discard changes</button></div>
    </div>
  </div>}</>;
}
