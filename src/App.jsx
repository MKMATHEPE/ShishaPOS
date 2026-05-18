import { useState, useCallback, useRef, useEffect } from "react";
import chillPipeLogo from "./assets/The_Chill_Pipe.png";

const FLAVOURS = [
  { id: "lk", name: "Lady Killer", short: "LK", icon: "🌹", bg: "#fff1f2", color: "#be123c", border: "#fecdd3" },
  { id: "mc", name: "Mint Cream", short: "MC", icon: "🍃", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  { id: "bn", name: "Berlin Nights", short: "BN", icon: "🌙", bg: "#eef2ff", color: "#4338ca", border: "#c7d2fe" },
  { id: "gm", name: "Gum & Mint", short: "GM", icon: "🫧", bg: "#f0fdfa", color: "#0f766e", border: "#99f6e4" },
  { id: "jk", name: "Joker", short: "JK", icon: "🃏", bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  { id: "hh", name: "Honey Hunter", short: "HH", icon: "🍯", bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
];

const PRICES = { full: 170, refill: 120 };
const LOGO_SRC = chillPipeLogo;

function formatTime(date) {
  return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatCurrency(n) {
  return `R${n.toLocaleString()}`;
}

export default function App() {
  const [orders, setOrders] = useState([]);
  const [orderType, setOrderType] = useState("full");
  const [payMethod, setPayMethod] = useState("card");
  const [showSummary, setShowSummary] = useState(false);
  const [selectedFlavour, setSelectedFlavour] = useState(null);
  const [flash, setFlash] = useState(null);
  const [undoTarget, setUndoTarget] = useState(null);
  const listRef = useRef(null);
  const undoTimer = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [orders]);

  const confirmOrder = useCallback(() => {
    if (!selectedFlavour) return;

    const order = {
      id: Date.now(),
      flavour: selectedFlavour,
      type: orderType,
      payment: payMethod,
      price: PRICES[orderType],
      time: new Date(),
      status: "active",
    };

    setOrders((prev) => [...prev, order]);
    setFlash(selectedFlavour.id);
    setUndoTarget(order.id);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoTarget(null), 4000);
    setTimeout(() => setFlash(null), 300);
    setSelectedFlavour(null);
  }, [selectedFlavour, orderType, payMethod]);

  const undoLast = useCallback(() => {
    if (!undoTarget) return;
    setOrders((prev) => prev.filter((o) => o.id !== undoTarget));
    setUndoTarget(null);
    clearTimeout(undoTimer.current);
  }, [undoTarget]);

  const removeOrder = useCallback((id) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const markDelivered = useCallback((id) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: "delivered", deliveredAt: new Date() } : o))
    );
  }, []);

  const currentOrders = orders.filter((o) => o.status !== "delivered");
  const deliveredOrders = orders.filter((o) => o.status === "delivered");

  const totals = orders.reduce(
    (acc, o) => {
      acc.gross += o.price;
      if (o.payment === "card") acc.card += o.price;
      else acc.cash += o.price;
      return acc;
    },
    { gross: 0, card: 0, cash: 0 }
  );

  const paymentCounts = currentOrders.reduce(
    (acc, o) => {
      acc[o.payment] += 1;
      return acc;
    },
    { card: 0, cash: 0 }
  );

  const deliveredPaymentCounts = deliveredOrders.reduce(
    (acc, o) => {
      acc[o.payment] += 1;
      return acc;
    },
    { card: 0, cash: 0 }
  );

  const flavourCounts = orders.reduce((acc, o) => {
    acc[o.flavour.id] = (acc[o.flavour.id] || 0) + 1;
    return acc;
  }, {});

  const todayLabel = new Date().toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  if (showSummary) {
    const grouped = { card_full: [], card_refill: [], cash_full: [], cash_refill: [] };
    orders.forEach((o) => {
      grouped[`${o.payment}_${o.type}`].push(o);
    });

    return (
      <div style={styles.container}>
        <div style={styles.appChrome}>
          <div style={styles.brandPanel}>
            <img src={LOGO_SRC} alt="The Chill Pipe logo" style={styles.brandLogo} />
          </div>

          <div style={styles.summaryHeader}>
            <div>
              <div style={styles.kicker}>Shift Closeout</div>
              <h1 style={styles.summaryTitle}>Session Summary</h1>
              <div style={styles.terminalMeta}>{todayLabel} · Terminal 01</div>
            </div>
            <button onClick={() => setShowSummary(false)} style={styles.backBtn}>← Back</button>
          </div>

          <div style={styles.statRow}>
            <div style={{ ...styles.statCard, borderLeft: "4px solid #059669" }}>
              <div style={styles.statLabel}>Gross</div>
              <div style={{ ...styles.statValue, color: "#059669" }}>{formatCurrency(totals.gross)}</div>
            </div>
            <div style={{ ...styles.statCard, borderLeft: "4px solid #2563eb" }}>
              <div style={styles.statLabel}>Card</div>
              <div style={{ ...styles.statValue, color: "#2563eb" }}>{formatCurrency(totals.card)}</div>
            </div>
            <div style={{ ...styles.statCard, borderLeft: "4px solid #d97706" }}>
              <div style={styles.statLabel}>Cash</div>
              <div style={{ ...styles.statValue, color: "#d97706" }}>{formatCurrency(totals.cash)}</div>
            </div>
          </div>

          <div style={styles.statRow}>
            {FLAVOURS.map((f) => (
              <div key={f.id} style={{ ...styles.statCard, borderLeft: `4px solid ${f.color}` }}>
                <div style={styles.statLabel}>{f.name}</div>
                <div style={styles.statValue}>{flavourCounts[f.id] || 0}</div>
              </div>
            ))}
          </div>

          {Object.entries(grouped).map(([key, items]) => {
            if (!items.length) return null;
            const [pay, type] = key.split("_");
            const label = `${pay === "card" ? "💳 Card" : "💵 Cash"} · ${type === "full" ? "New Pipe (R170)" : "Refill (R120)"}`;

            return (
              <div key={key} style={styles.summarySection}>
                <div style={styles.sectionLabel}>
                  {label}
                  <span style={styles.countBadge}>{items.length}</span>
                </div>
                <div style={styles.summaryList}>
                  {items.map((o, i) => (
                    <div key={o.id} style={styles.summaryRow}>
                      <span style={styles.summaryIndex}>{String(i + 1).padStart(2, "0")}</span>
                      <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color }}>
                        {o.flavour.icon} {o.flavour.name}
                      </span>
                      <span style={styles.summaryTime}>{formatTime(o.time)}</span>
                      <span style={styles.summaryPrice}>{formatCurrency(o.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <button
            onClick={() => {
              const text = orders.map((o, i) => `${i + 1}. ${o.flavour.name} R${o.price} [${formatTime(o.time)}] ${o.payment} ${o.type}`).join("\n");
              navigator.clipboard?.writeText(`Shisha Orders (${orders.length})\n${text}\n\nGross: R${totals.gross} | Card: R${totals.card} | Cash: R${totals.cash}`);
            }}
            style={styles.copyBtn}
          >
            Copy Shift Report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.appChrome}>
        <div style={styles.topBar}>
          <div style={styles.brandLockup}>
            <img src={LOGO_SRC} alt="The Chill Pipe logo" style={styles.logoImage} />
            <div>
              <div style={styles.kicker}>The Chill Pipe</div>
              <h1 style={styles.logo}>POS</h1>
              <div style={styles.terminalMeta}>{todayLabel} · Terminal 01</div>
            </div>
          </div>
          <button onClick={() => setShowSummary(true)} style={styles.summaryBtn}>
            Summary ({orders.length})
          </button>
        </div>

        <div style={styles.salePanel}>
          <div style={styles.sectionHeaderLabel}>Order type</div>
          <div style={styles.toggleRow}>
            <div style={styles.toggleGroup}>
              {["full", "refill"].map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  style={{ ...styles.toggleBtn, ...(orderType === t ? styles.toggleActive : {}) }}
                >
                  <span>{t === "full" ? "New Pipe" : "Refill"}</span>
                  <strong>{formatCurrency(PRICES[t])}</strong>
                </button>
              ))}
            </div>
            <div style={styles.toggleGroup}>
              {["card", "cash"].map((p) => (
                <button
                  key={p}
                  onClick={() => setPayMethod(p)}
                  style={{ ...styles.toggleBtn, ...(payMethod === p ? styles.toggleActive : {}) }}
                >
                  <span>{p === "card" ? "Card" : "Cash"}</span>
                  <strong>{p === "card" ? "💳" : "💵"}</strong>
                </button>
              ))}
            </div>
          </div>

          <div style={styles.panelHeader}>
            <div style={styles.sectionHeaderLabel}>Flavour</div>
            <div style={styles.panelHint}>Select one item, then confirm</div>
          </div>
          <div style={styles.flavourGrid}>
            {FLAVOURS.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedFlavour(f)}
                style={{
                  ...styles.flavourBtn,
                  background: flash === f.id ? f.color : selectedFlavour?.id === f.id ? f.color : f.bg,
                  color: flash === f.id ? "#fff" : selectedFlavour?.id === f.id ? "#fff" : "#111827",
                  borderColor: selectedFlavour?.id === f.id ? f.color : f.border,
                  transform: selectedFlavour?.id === f.id ? "translateY(-2px)" : "translateY(0)",
                }}
              >
                <span style={styles.flavourIcon}>{f.icon}</span>
                <span style={styles.flavourName}>{f.name}</span>
                <span style={{ ...styles.flavourPrice, color: selectedFlavour?.id === f.id ? "#fff" : f.color }}>
                  {formatCurrency(PRICES[orderType])}
                </span>
                {flavourCounts[f.id] ? (
                  <span style={{ ...styles.flavourCount, background: selectedFlavour?.id === f.id ? "#fff" : f.color, color: selectedFlavour?.id === f.id ? f.color : "#fff" }}>
                    {flavourCounts[f.id]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {selectedFlavour && (
            <button onClick={confirmOrder} style={styles.confirmBtn}>
              Add to order · {selectedFlavour.name} · {orderType === "full" ? "New Pipe" : "Refill"} · {formatCurrency(PRICES[orderType])}
            </button>
          )}

          {undoTarget && (
            <div style={styles.undoBar}>
              <span>Order added to receipt</span>
              <button onClick={undoLast} style={styles.undoBtn}>Undo</button>
            </div>
          )}
        </div>

        <div style={styles.receiptPanel}>
          <div style={styles.totalBar}>
            <div style={styles.totalLeft}>
              <span style={styles.totalLabel}>Current Orders</span>
              <span style={styles.totalSub}>{currentOrders.length} orders · Card {paymentCounts.card} · Cash {paymentCounts.cash}</span>
            </div>
          </div>

          <div ref={listRef} style={styles.orderList}>
            {currentOrders.length === 0 && (
              <div style={styles.emptyState}>No items on this receipt yet</div>
            )}
            {currentOrders.map((o, i) => (
              <div key={o.id} style={styles.orderRow}>
                <span style={styles.orderIndex}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color }}>
                  {o.flavour.icon} {o.flavour.short}
                </span>
                <span style={styles.orderMeta}>
                  <strong>{o.flavour.name}</strong>
                  <small>{o.type === "refill" ? "Refill" : "New Pipe"} · {o.payment === "card" ? "Card" : "Cash"} · {formatTime(o.time)}</small>
                </span>
                <span style={styles.orderPrice}>{formatCurrency(o.price)}</span>
                <button onClick={() => markDelivered(o.id)} style={styles.deliverBtn}>Done</button>
                <button onClick={() => removeOrder(o.id)} style={styles.deleteBtn}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.deliveredPanel}>
          <div style={styles.deliveredBar}>
            <div style={styles.totalLeft}>
              <span style={styles.totalLabel}>Orders Delivered</span>
              <span style={styles.totalSub}>{deliveredOrders.length} orders · Card {deliveredPaymentCounts.card} · Cash {deliveredPaymentCounts.cash}</span>
            </div>
          </div>

          <div style={styles.deliveredList}>
            {deliveredOrders.length === 0 && (
              <div style={styles.emptyState}>No delivered orders yet</div>
            )}
            {deliveredOrders.map((o, i) => (
              <div key={o.id} style={styles.deliveredRow}>
                <span style={styles.orderIndex}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color }}>
                  {o.flavour.icon} {o.flavour.short}
                </span>
                <span style={styles.orderMeta}>
                  <strong>{o.flavour.name}</strong>
                  <small>{o.type === "refill" ? "Refill" : "New Pipe"} · {o.payment === "card" ? "Card" : "Cash"} · delivered {formatTime(o.deliveredAt)}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "'Inter', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    minHeight: "100vh",
    padding: 16,
    background: "#d9dee7",
    color: "#111827",
  },
  appChrome: {
    maxWidth: 560,
    minHeight: "calc(100vh - 32px)",
    margin: "0 auto",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    boxShadow: "0 18px 50px rgba(15,23,42,0.18)",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 10px 12px",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
  },
  brandLockup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  logoImage: {
    width: 86,
    height: 60,
    objectFit: "contain",
    borderRadius: 8,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
  },
  kicker: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "#64748b",
    marginBottom: 3,
  },
  logo: {
    fontSize: 26,
    fontWeight: 900,
    letterSpacing: "-0.05em",
    margin: 0,
    lineHeight: 1,
    color: "#0f172a",
  },
  terminalMeta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
  },
  summaryBtn: {
    background: "#0f172a",
    border: "1px solid #0f172a",
    borderRadius: 8,
    color: "#ffffff",
    padding: "10px 13px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  salePanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
  },
  sectionHeaderLabel: {
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#64748b",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
  },
  panelHint: {
    fontSize: 11,
    fontWeight: 700,
    color: "#94a3b8",
  },
  toggleRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  toggleGroup: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 4,
    padding: 4,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: 9,
  },
  toggleBtn: {
    minHeight: 48,
    padding: "7px 8px",
    border: "1px solid transparent",
    borderRadius: 7,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
    background: "transparent",
    color: "#64748b",
    fontFamily: "inherit",
  },
  toggleActive: {
    background: "#0f172a",
    borderColor: "#0f172a",
    color: "#ffffff",
    boxShadow: "0 6px 16px rgba(15,23,42,0.18)",
  },
  flavourGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 9,
  },
  flavourBtn: {
    position: "relative",
    minHeight: 108,
    padding: "14px 8px 12px",
    border: "1px solid",
    borderRadius: 10,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    fontFamily: "inherit",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 10px rgba(15,23,42,0.06)",
    transition: "all 0.15s ease",
  },
  flavourIcon: {
    fontSize: 25,
    lineHeight: 1,
  },
  flavourName: {
    fontSize: 13,
    fontWeight: 900,
    textAlign: "center",
    lineHeight: 1.15,
  },
  flavourPrice: {
    fontSize: 12,
    fontWeight: 900,
  },
  flavourCount: {
    position: "absolute",
    top: -7,
    right: -7,
    minWidth: 24,
    height: 24,
    padding: "0 7px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "2px solid #fff",
  },
  confirmBtn: {
    width: "100%",
    padding: "14px 16px",
    border: "none",
    borderRadius: 9,
    background: "#16a34a",
    color: "#fff",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 10px 22px rgba(22,163,74,0.22)",
  },
  undoBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#0f172a",
    color: "#fff",
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 800,
  },
  undoBtn: {
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.16)",
    color: "#ffffff",
    padding: "4px 12px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  receiptPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
  },
  deliveredPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    borderRadius: 10,
  },
  totalBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "#0f172a",
    color: "#fff",
    padding: "13px 15px",
    borderRadius: 9,
  },
  deliveredBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "#166534",
    color: "#fff",
    padding: "13px 15px",
    borderRadius: 9,
  },
  totalLeft: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: 900,
    opacity: 0.9,
  },
  totalSub: {
    fontSize: 11,
    opacity: 0.68,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  orderList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    minHeight: 126,
    maxHeight: 300,
  },
  deliveredList: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    maxHeight: 190,
    overflowY: "auto",
  },
  emptyState: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 800,
    padding: "34px 0",
    background: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: 9,
  },
  orderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 10px",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    fontSize: 13,
  },
  deliveredRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 10px",
    background: "#ffffff",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    fontSize: 13,
  },
  orderIndex: {
    width: 24,
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: 900,
    textAlign: "center",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  tag: {
    padding: "4px 8px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  orderMeta: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    flexDirection: "column",
    gap: 1,
    color: "#111827",
    fontWeight: 900,
  },
  orderPrice: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    minWidth: 48,
    textAlign: "right",
    color: "#111827",
  },
  deleteBtn: {
    width: 28,
    height: 28,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    borderRadius: 7,
    color: "#e11d48",
    fontSize: 18,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
    fontFamily: "inherit",
  },
  deliverBtn: {
    height: 28,
    background: "#dcfce7",
    border: "1px solid #86efac",
    borderRadius: 7,
    color: "#166534",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    padding: "0 9px",
    fontFamily: "inherit",
  },
  summaryHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "2px 2px 4px",
  },
  summaryTitle: {
    fontSize: 24,
    fontWeight: 900,
    letterSpacing: "-0.05em",
    margin: 0,
    color: "#0f172a",
  },
  backBtn: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    color: "#334155",
    padding: "9px 12px",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  statRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  statCard: {
    flex: 1,
    minWidth: 92,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 9,
    padding: "11px 12px",
  },
  statLabel: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#64748b",
  },
  statValue: {
    fontSize: 20,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    letterSpacing: "-0.03em",
    color: "#0f172a",
  },
  summarySection: {
    marginTop: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 900,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  countBadge: {
    background: "#0f172a",
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
    fontWeight: 900,
    color: "#fff",
  },
  summaryList: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 9,
    overflow: "hidden",
  },
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
  },
  summaryIndex: {
    width: 24,
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: 900,
    textAlign: "center",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  summaryTime: {
    flex: 1,
    textAlign: "right",
    fontSize: 11,
    color: "#94a3b8",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  summaryPrice: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: "#0f172a",
  },
  copyBtn: {
    marginTop: 4,
    width: "100%",
    padding: "12px",
    background: "#0f172a",
    border: "none",
    color: "#ffffff",
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  brandPanel: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 12,
  },
  brandLogo: {
    display: "block",
    width: "100%",
    maxHeight: 140,
    objectFit: "contain",
  },
};
