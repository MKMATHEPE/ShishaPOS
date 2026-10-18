import { createPortal } from 'react-dom';
export default function Pagination({page,totalPages,onChange,disabled=false,listRef,label}) {
  if (totalPages <= 1) return null;
  const changePage = next => {
    onChange(next);
    requestAnimationFrame(()=>listRef?.current?.scrollIntoView({
      block:'start', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    }));
  };
  return <><div className="pagination-space" aria-hidden="true" />{createPortal(<nav className="list-pagination" aria-label={label}>
    <button type="button" disabled={disabled || page <= 1} onClick={()=>changePage(page-1)} aria-label="Previous page"><span aria-hidden="true">‹</span> Prev</button>
    <span className="list-pagination-count" role="status" aria-label={`Page ${page} of ${totalPages}`}>{page} <span aria-hidden="true">/</span> {totalPages}</span>
    <button type="button" disabled={disabled || page >= totalPages} onClick={()=>changePage(page+1)} aria-label="Next page">Next <span aria-hidden="true">›</span></button>
  </nav>,document.body)}</>;
}
