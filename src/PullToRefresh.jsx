import { useEffect, useRef, useState } from "react";

const THRESHOLD = 72;

export default function PullToRefresh({ children, style }) {
  const container = useRef(null);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const element = container.current;
    let start = null;
    let pull = 0;
    let reloading = false;
    const reset = () => {
      start = null;
      pull = 0;
      setDistance(0);
    };
    const onStart = event => {
      reset();
      if (reloading || event.touches.length !== 1 || element.scrollTop > 0) return;
      // Leave form controls and independently scrolling lists alone.
      if (event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      for (let node = event.target; node && node !== element; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
      }
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const onMove = event => {
      if (!start) return;
      if (event.touches.length !== 1 || element.scrollTop > 0) return reset();
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (dy < 0 || Math.abs(dx) > Math.abs(dy)) return reset();
      if (dy < 8) return;
      if (!event.cancelable) return reset();
      event.preventDefault();
      pull = Math.min(100, dy * 0.5);
      setDistance(pull);
    };
    const onEnd = () => {
      if (start && pull >= THRESHOLD) {
        reloading = true;
        start = null;
        setRefreshing(true);
        setDistance(48);
        // Give the refresh status a frame to paint before navigation.
        requestAnimationFrame(() => requestAnimationFrame(() => window.location.reload()));
      } else reset();
    };
    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", reset);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", reset);
    };
  }, []);

  return <main ref={container} style={{ ...style, overscrollBehaviorY: "contain" }}>
    <div className="pull-refresh-status" style={{ height: distance, minHeight: distance }} role="status" aria-live="polite">
      {refreshing ? "Refreshing…" : distance >= THRESHOLD ? "Release to refresh" : distance > 0 ? "↓ Pull to refresh" : ""}
    </div>
    {children}
  </main>;
}
