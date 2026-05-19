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

const DEFAULT_PRICES = { full: 170, refill: 120 };

// Stock auto-deduction per sale
const COAL_PER_SALE = 2;         // pieces
const MOUTHPIECES_PER_SALE = 2;  // pieces
// Boxes of flavour used per sale (1 carton = 10 boxes)
const FLAVOUR_PER_SALE = {
  lk: 1 / 3.5,  // Lady Killer   — 1/3.5 box
  bn: 1 / 3.5,  // Berlin Nights — 1/3.5 box
  jk: 1 / 3.5,  // Joker         — 1/3.5 box
  hh: 1 / 3.5,  // Honey Hunter  — 1/3.5 box
  mc: 1 / 4,    // Mint Cream    — 1/4 box
  gm: 1 / 4,    // Gum & Mint    — 1/4 box
};

// How many pieces are in each restock unit
const RESTOCK_PACK = {
  "Coal":         { size: 72, unit: "box",  plural: "boxes" },
  "Mouth Pieces": { size: 50, unit: "pack", plural: "packs" },
};

const STOCK_PRESETS = [
  { name: "Coal",          category: "consumable", unit: "bags",    lowThreshold: 2 },
  { name: "Flavour",       category: "consumable", unit: "pouches", lowThreshold: 3 },
  { name: "Lady Killer",   category: "consumable", unit: "pouches", lowThreshold: 3 },
  { name: "Mint Cream",    category: "consumable", unit: "pouches", lowThreshold: 3 },
  { name: "Berlin Nights", category: "consumable", unit: "pouches", lowThreshold: 3 },
  { name: "Gum & Mint",    category: "consumable", unit: "pouches", lowThreshold: 3 },
  { name: "Joker",         category: "consumable", unit: "pouches", lowThreshold: 3 },
  { name: "Honey Hunter",  category: "consumable", unit: "pouches", lowThreshold: 3 },
  { name: "Mouth Pieces",  category: "consumable", unit: "pieces",  lowThreshold: 10 },
  { name: "Kops",          category: "equipment",  unit: "units",   lowThreshold: 1 },
  { name: "Rotas",         category: "equipment",  unit: "units",   lowThreshold: 2 },
  { name: "Rota Tops",     category: "equipment",  unit: "units",   lowThreshold: 2 },
  { name: "Stove",         category: "equipment",  unit: "units",   lowThreshold: 1 },
  { name: "New Hookah",    category: "equipment",  unit: "units",   lowThreshold: 1 },
];
const LOGO_SRC = chillPipeLogo;

function formatTime(date) {
  return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatCurrency(n) {
  return `R${n.toLocaleString()}`;
}

export default function App() {
  const [orders, setOrders] = useState([]);
  const [prices, setPrices] = useState(DEFAULT_PRICES);
  const [draftPrices, setDraftPrices] = useState({ full: String(DEFAULT_PRICES.full), refill: String(DEFAULT_PRICES.refill) });
  const [users, setUsers] = useState(() => {
    try {
      const s = localStorage.getItem("pos_users");
      return s ? JSON.parse(s) : [{ id: 1, name: "Admin", role: "Admin", pin: "1234", permissions: { delivered: true, stock: true, management: true, settings: true } }];
    } catch { return [{ id: 1, name: "Admin", role: "Admin", pin: "1234", permissions: { delivered: true, stock: true, management: true, settings: true } }]; }
  });
  const [activeUser, setActiveUser] = useState(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState("Staff");
  const [newUserPin, setNewUserPin] = useState("");
  const [orderType, setOrderType] = useState("full");
  const [payMethod, setPayMethod] = useState("card");
  const [selectedFlavour, setSelectedFlavour] = useState(null);
  const [flash, setFlash] = useState(null);
  const [undoTarget, setUndoTarget] = useState(null);
  const [activeTab, setActiveTab] = useState("pos");
  const [deliveredPage, setDeliveredPage] = useState(0);
  const [stock, setStock] = useState(() => {
    const defaults = [
      { id: 1,  name: "Coal",         category: "consumable", quantity: 72, unit: "pieces",  lowThreshold: 10 },
      { id: 14, name: "Flavour", category: "consumable", unit: "boxes", lowThreshold: 1,
        subItems: FLAVOURS.map(f => ({ id: f.id, name: f.name, icon: f.icon, color: f.color, bg: f.bg, quantity: 10 })) },
      { id: 2,  name: "Lady Killer",  category: "consumable", quantity: 10, unit: "pouches", lowThreshold: 3 },
      { id: 3,  name: "Mint Cream",   category: "consumable", quantity: 10, unit: "pouches", lowThreshold: 3 },
      { id: 4,  name: "Berlin Nights",category: "consumable", quantity: 10, unit: "pouches", lowThreshold: 3 },
      { id: 5,  name: "Gum & Mint",   category: "consumable", quantity: 10, unit: "pouches", lowThreshold: 3 },
      { id: 6,  name: "Joker",        category: "consumable", quantity: 10, unit: "pouches", lowThreshold: 3 },
      { id: 7,  name: "Honey Hunter", category: "consumable", quantity: 10, unit: "pouches", lowThreshold: 3 },
      { id: 8,  name: "Mouth Pieces", category: "consumable", quantity: 50, unit: "pieces",  lowThreshold: 10 },
      { id: 9,  name: "Kops",         category: "equipment",  quantity: 5,  unit: "units",   lowThreshold: 1 },
      { id: 10, name: "Rotas",        category: "equipment",  quantity: 8,  unit: "units",   lowThreshold: 2 },
      { id: 11, name: "Rota Tops",    category: "equipment",  quantity: 8,  unit: "units",   lowThreshold: 2 },
      { id: 12, name: "Stove",        category: "equipment",  quantity: 2,  unit: "units",   lowThreshold: 1 },
      { id: 13, name: "New Hookah",   category: "equipment",  quantity: 3,  unit: "units",   lowThreshold: 1 },
    ];
    try {
      const s = localStorage.getItem("pos_stock");
      if (!s) return defaults;
      const saved = JSON.parse(s);
      // Merge: update unit/threshold from defaults, add subItems if missing, add new default items
      const merged = saved.map(i => {
        const def = defaults.find(d => d.name === i.name);
        if (!def) return i;
        return {
          ...i,
          unit: def.unit,
          lowThreshold: def.lowThreshold,
          subItems: i.subItems ?? def.subItems,
        };
      });
      const missing = defaults.filter(d => !saved.some(i => i.name === d.name));
      return [...merged, ...missing];
    } catch { return defaults; }
  });
  const [newStockName, setNewStockName] = useState("");
  const [newStockQty, setNewStockQty] = useState("");
  const [newStockUnit, setNewStockUnit] = useState("units");
  const [newStockThreshold, setNewStockThreshold] = useState("");
  const [newStockCategory, setNewStockCategory] = useState("consumable");
  const [newStockCustomName, setNewStockCustomName] = useState("");
  const [usersCollapsed, setUsersCollapsed] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [expandedStockIds, setExpandedStockIds] = useState(new Set());
  const [restockId, setRestockId] = useState(null);
  const [restockQty, setRestockQty] = useState("");
  const listRef = useRef(null);
  const undoTimer = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [orders]);

  useEffect(() => {
    localStorage.setItem("pos_users", JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem("pos_stock", JSON.stringify(stock));
  }, [stock]);


  const confirmOrder = useCallback(() => {
    if (!selectedFlavour) return;

    const order = {
      id: Date.now(),
      flavour: selectedFlavour,
      type: orderType,
      payment: payMethod,
      price: prices[orderType],
      time: new Date(),
      status: "active",
    };

    setOrders((prev) => [...prev, order]);

    // Auto-deduct stock
    const flavourId = selectedFlavour.id;
    setStock(prev => prev.map(item => {
      if (item.name === "Coal")
        return { ...item, quantity: Math.max(0, item.quantity - COAL_PER_SALE) };
      if (item.name === "Mouth Pieces")
        return { ...item, quantity: Math.max(0, item.quantity - MOUTHPIECES_PER_SALE) };
      if (item.name === "Flavour" && item.subItems)
        return { ...item, subItems: item.subItems.map(s =>
          s.id === flavourId
            ? { ...s, quantity: Math.max(0, parseFloat((s.quantity - (FLAVOUR_PER_SALE[s.id] ?? 0)).toFixed(3))) }
            : s
        )};
      return item;
    }));

    setFlash(selectedFlavour.id);
    setUndoTarget(order.id);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoTarget(null), 4000);
    setTimeout(() => setFlash(null), 300);
    setSelectedFlavour(null);
    setActiveTab("pos");
  }, [selectedFlavour, orderType, payMethod, prices]);

  const updatePrice = useCallback((type, value) => {
    const nextPrice = Number(value);
    setPrices((prev) => ({
      ...prev,
      [type]: Number.isFinite(nextPrice) && nextPrice >= 0 ? nextPrice : 0,
    }));
  }, []);

  const handleLogin = useCallback(() => {
    const match = users.find(
      (u) => u.name.toLowerCase() === loginUsername.trim().toLowerCase() && u.pin === loginPassword
    );
    if (match) {
      setActiveUser(match);
      setLoginUsername("");
      setLoginPassword("");
      setLoginError("");
    } else {
      setLoginError("Invalid username or password.");
      setLoginPassword("");
    }
  }, [users, loginUsername, loginPassword]);

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

  const PAGE_SIZE = 12;
  const totalDeliveredPages = Math.max(1, Math.ceil(deliveredOrders.length / PAGE_SIZE));
  const safePage = Math.min(deliveredPage, totalDeliveredPages - 1);

  const isAdmin = activeUser?.role === "Admin";
  const currentUserPerms = users.find((u) => u.id === activeUser?.id)?.permissions ?? {};
  const canAccess = (tab) => {
    if (!activeUser) return false;
    if (tab === "pos") return true;
    if (isAdmin) return true;
    return currentUserPerms[tab] ?? false;
  };
  const visibleTab = canAccess(activeTab) ? activeTab : "pos";

  return (
    <div style={styles.container}>
      <div style={styles.appChrome}>
        {!activeUser ? (
          <div style={styles.loginScreen}>
            <div style={styles.loginOrb1} />
            <div style={styles.loginOrb2} />
            <div style={styles.loginOrb3} />

            <div style={styles.loginCard}>
              <div style={styles.loginLogoWrap}>
                <img src={LOGO_SRC} alt="The Chill Pipe logo" style={styles.loginLogo} />
              </div>

              <div style={styles.loginBrandTag}>The Chill Pipe · POS</div>
              <h1 style={styles.loginAppName}>Welcome back</h1>
              <p style={styles.loginMeta}>Sign in to start your shift.</p>

              <div style={styles.loginField}>
                <label style={styles.loginLabel}>Username</label>
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => { setLoginUsername(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="Enter your username"
                  style={styles.loginInput}
                  autoComplete="off"
                />
              </div>

              <div style={styles.loginField}>
                <label style={styles.loginLabel}>Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => { setLoginPassword(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="Enter your password"
                  style={styles.loginInput}
                />
              </div>

              {loginError && <div style={styles.loginErrorMsg}>{loginError}</div>}

              <button onClick={handleLogin} style={styles.loginSignInBtn}>Sign In</button>

              <div style={styles.loginFooterNote}>{todayLabel} · Terminal 01</div>
            </div>
          </div>
        ) : (
        <>
        <div style={styles.topBar}>
          <div style={styles.brandLockup}>
            <img src={LOGO_SRC} alt="The Chill Pipe logo" style={styles.logoImage} />
            <div>
              <div style={styles.kicker}>The Chill Pipe</div>
              <h1 style={styles.logo}>POS</h1>
              <div style={styles.terminalMeta}>{todayLabel} · Terminal 01</div>
            </div>
          </div>
          <button onClick={() => setActiveUser(null)} style={styles.activeUserChip}>
            <div style={styles.activeUserAvatar}>{activeUser.name.charAt(0).toUpperCase()}</div>
            <div style={styles.activeUserInfo}>
              <span style={styles.activeUserName}>{activeUser.name}</span>
              <span style={styles.activeUserRoleLabel}>{activeUser.role} · Switch</span>
            </div>
          </button>
        </div>

        <main style={styles.mainContent}>
          {visibleTab === "pos" && (
            <>
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
                  <strong>{formatCurrency(prices[t])}</strong>
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
                  {formatCurrency(prices[orderType])}
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
              Add to order · {selectedFlavour.name} · {orderType === "full" ? "New Pipe" : "Refill"} · {formatCurrency(prices[orderType])}
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
                <button onClick={() => markDelivered(o.id)} style={styles.deliverBtn}>Delivered</button>
                <button onClick={() => removeOrder(o.id)} style={styles.deleteBtn}>×</button>
              </div>
            ))}
          </div>
        </div>
            </>
          )}

          {visibleTab === "delivered" && (
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
                {deliveredOrders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE).map((o, i) => (
                  <div key={o.id} style={styles.deliveredRow}>
                    <span style={styles.orderIndex}>{String(safePage * PAGE_SIZE + i + 1).padStart(2, "0")}</span>
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
          )}

          {visibleTab === "management" && (() => {
            const newPipeOrders = orders.filter((o) => o.type === "full");
            const refillOrders = orders.filter((o) => o.type === "refill");
            const maxFlavourCount = Math.max(...FLAVOURS.map((f) => flavourCounts[f.id] || 0), 1);
            return (
            <div style={styles.settingsPanel}>
              <div style={styles.settingsBar}>
                <div style={styles.totalLeft}>
                  <span style={styles.totalLabel}>Management</span>
                  <span style={styles.totalSub}>Terminal 01 · {todayLabel}</span>
                </div>
              </div>

              <div style={styles.settingsGrid}>
                <div style={styles.settingCard}>
                  <span style={styles.statLabel}>Active Orders</span>
                  <strong style={styles.settingValue}>{currentOrders.length}</strong>
                </div>
                <div style={styles.settingCard}>
                  <span style={styles.statLabel}>Delivered</span>
                  <strong style={styles.settingValue}>{deliveredOrders.length}</strong>
                </div>
              </div>

              {/* Divider */}
              <div style={styles.summaryDivider}>
                <div style={styles.summaryDividerLine} />
                <span style={styles.summaryDividerLabel}>Shift Summary</span>
                <div style={styles.summaryDividerLine} />
              </div>

              {/* Revenue hero */}
              <div style={styles.revenueHero}>
                <div style={styles.revenueHeroTop}>
                  <div>
                    <div style={styles.revenueHeroLabel}>Total Revenue</div>
                    <div style={styles.revenueHeroAmount}>{formatCurrency(totals.gross)}</div>
                  </div>
                  <div style={styles.revenueHeroMeta}>{orders.length} {orders.length === 1 ? "order" : "orders"} · {todayLabel}</div>
                </div>
                <div style={styles.revenueStatRow}>
                  <div style={styles.revenueStat}>
                    <span style={styles.revenueStatIcon}>💳</span>
                    <span style={styles.revenueStatLabel}>Card</span>
                    <span style={styles.revenueStatValue}>{formatCurrency(totals.card)}</span>
                  </div>
                  <div style={styles.revenueStatDivider} />
                  <div style={styles.revenueStat}>
                    <span style={styles.revenueStatIcon}>💵</span>
                    <span style={styles.revenueStatLabel}>Cash</span>
                    <span style={styles.revenueStatValue}>{formatCurrency(totals.cash)}</span>
                  </div>
                  <div style={styles.revenueStatDivider} />
                  <div style={styles.revenueStat}>
                    <span style={styles.revenueStatIcon}>🪈</span>
                    <span style={styles.revenueStatLabel}>Pipes</span>
                    <span style={styles.revenueStatValue}>{newPipeOrders.length}</span>
                  </div>
                  <div style={styles.revenueStatDivider} />
                  <div style={styles.revenueStat}>
                    <span style={styles.revenueStatIcon}>🔄</span>
                    <span style={styles.revenueStatLabel}>Refills</span>
                    <span style={styles.revenueStatValue}>{refillOrders.length}</span>
                  </div>
                </div>
              </div>

              {/* Flavour breakdown with bars */}
              <div style={styles.flavourBreakdown}>
                <div style={styles.flavourBreakdownHeader}>By Flavour</div>
                {FLAVOURS.map((f) => {
                  const count = flavourCounts[f.id] || 0;
                  return (
                    <div key={f.id} style={styles.flavourBreakdownRow}>
                      <span style={styles.flavourBreakdownIcon}>{f.icon}</span>
                      <span style={styles.flavourBreakdownName}>{f.name}</span>
                      <div style={styles.flavourBarTrack}>
                        <div style={{ ...styles.flavourBar, width: `${(count / maxFlavourCount) * 100}%`, background: f.color }} />
                      </div>
                      <span style={{ ...styles.flavourBreakdownCount, color: count > 0 ? f.color : "#cbd5e1" }}>{count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Full order log */}
              {orders.length > 0 && (
                <div style={styles.orderLogSection}>
                  <div style={styles.orderLogHeader}>Full Order Log</div>
                  <div style={styles.orderLog}>
                    {orders.map((o, i) => (
                      <div key={o.id} style={styles.orderLogRow}>
                        <span style={styles.orderLogIndex}>{String(i + 1).padStart(2, "0")}</span>
                        <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color, fontSize: 11, padding: "3px 7px" }}>
                          {o.flavour.icon} {o.flavour.short}
                        </span>
                        <span style={styles.orderLogMeta}>{o.type === "refill" ? "Refill" : "New Pipe"} · {o.payment === "card" ? "💳" : "💵"}</span>
                        <span style={styles.orderLogTime}>{formatTime(o.time)}</span>
                        <span style={styles.orderLogPrice}>{formatCurrency(o.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
            );
          })()}
          {visibleTab === "stock" && (() => {
            const consumables = stock.filter(i => i.category === "consumable");
            const equipment   = stock.filter(i => i.category === "equipment");
            const lowCount    = stock.filter(i => i.quantity <= i.lowThreshold).length;

            const adjustQty = (id, delta) =>
              setStock(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i));

            const adjustSubQty = (stockId, subId, delta) =>
              setStock(prev => prev.map(i => i.id === stockId
                ? { ...i, subItems: i.subItems.map(s => s.id === subId ? { ...s, quantity: Math.max(0, s.quantity + delta) } : s) }
                : i));

            const toggleStockExpand = (id) => setExpandedStockIds(prev => {
              const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
            });

            const confirmRestock = (id) => {
              const n = Number(restockQty);
              if (n > 0) {
                const target = stock.find(i => i.id === id);
                const pack = target ? RESTOCK_PACK[target.name] : null;
                adjustQty(id, pack ? n * pack.size : n);
              }
              setRestockId(null); setRestockQty("");
            };

            const renderItem = (item) => {
              // Sub-items (e.g. Flavour with individual flavour quantities)
              if (item.subItems) {
                const totalQty = item.subItems.reduce((s, f) => s + f.quantity, 0);
                const anyOut   = item.subItems.some(f => f.quantity === 0);
                const anyLow   = !anyOut && item.subItems.some(f => f.quantity <= item.lowThreshold);
                const isOpen   = expandedStockIds.has(item.id);
                const rowStyle = anyOut ? styles.stockRowCritical : anyLow ? styles.stockRowLow : styles.stockRow;
                return (
                  <div key={item.id}>
                    <div style={{ ...rowStyle, cursor: "pointer" }} onClick={() => toggleStockExpand(item.id)}>
                      <div style={styles.stockInfo}>
                        <span style={styles.stockName}>{item.name}</span>
                        <div style={styles.stockMeta}>
                          <span style={styles.stockUnit}>{Number.isInteger(totalQty) ? totalQty : totalQty.toFixed(2)} {item.unit} total</span>
                          {anyOut && <span style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", borderColor: "#fecaca" }}>Out of stock</span>}
                          {anyLow && <span style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", borderColor: "#fde68a" }}>Low</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, marginRight: 4 }}>{isOpen ? "▲ Hide" : "▼ Show"}</span>
                      <button onClick={e => { e.stopPropagation(); setStock(prev => prev.filter(i => i.id !== item.id)); }} style={styles.userDeleteBtn}>×</button>
                    </div>
                    {isOpen && (
                      <div style={styles.subItemList}>
                        {item.subItems.map(f => {
                          const fOut = f.quantity === 0;
                          const fLow = !fOut && f.quantity <= item.lowThreshold;
                          return (
                            <div key={f.id} style={styles.subItemRow}>
                              <span style={{ ...styles.subItemTag, background: f.bg, color: f.color }}>{f.icon} {f.name}</span>
                              {fOut && <span style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", borderColor: "#fecaca", fontSize: 9 }}>Out</span>}
                              {fLow && <span style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", borderColor: "#fde68a", fontSize: 9 }}>Low</span>}
                              <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                                {(() => {
                                  const perSale = FLAVOUR_PER_SALE[f.id];
                                  if (!perSale) return <span style={{ fontSize: 12, color: "#94a3b8" }}>{f.quantity.toFixed(2)} bx</span>;
                                  const denom = Math.round((1 / perSale) * 10) / 10;
                                  const qty = Math.round(f.quantity * 1000) / 1000;
                                  const wholeBoxes = Math.floor(qty);
                                  const servingsInOpen = Math.round((qty - wholeBoxes) * denom * 10) / 10;
                                  const openLabel = Number.isInteger(servingsInOpen) ? String(servingsInOpen) : servingsInOpen.toFixed(1);
                                  if (qty === 0) return <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>–</span>;
                                  return <>
                                    {wholeBoxes > 0 && (
                                      <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", background: "rgba(15,23,42,0.07)", padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                        📦 {wholeBoxes} {wholeBoxes === 1 ? "box" : "boxes"}
                                      </span>
                                    )}
                                    {servingsInOpen > 0 && (
                                      <span style={{ fontSize: 11, fontWeight: 800, color: f.color, background: f.bg, padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                        {openLabel}/{denom} open
                                      </span>
                                    )}
                                  </>;
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const isOut = item.quantity === 0;
              const isLow = !isOut && item.quantity <= item.lowThreshold;
              const rowStyle = isOut ? styles.stockRowCritical : isLow ? styles.stockRowLow : styles.stockRow;
              const isRestocking = restockId === item.id;
              const pack = RESTOCK_PACK[item.name];

              return (
                <div key={item.id} style={rowStyle}>
                  <div style={styles.stockInfo}>
                    <span style={styles.stockName}>{item.name}</span>
                    <div style={styles.stockMeta}>
                      <span style={styles.stockUnit}>{item.unit}</span>
                      {pack && (
                        <span style={{ ...styles.stockUnit, color: "#94a3b8" }}>
                          · {Math.floor(item.quantity / pack.size)} {pack.plural} + {item.quantity % pack.size} pcs
                        </span>
                      )}
                      {isOut && <span style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", borderColor: "#fecaca" }}>Out of stock</span>}
                      {isLow && <span style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", borderColor: "#fde68a" }}>Low</span>}
                    </div>
                  </div>

                  {isRestocking ? (
                    <div style={{ ...styles.restockRow, flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ ...styles.stockUnit, fontWeight: 700 }}>
                          {pack ? `${pack.plural[0].toUpperCase()}${pack.plural.slice(1)}:` : "Add:"}
                        </span>
                        <input
                          type="number"
                          autoFocus
                          min="1"
                          value={restockQty}
                          onChange={e => setRestockQty(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") confirmRestock(item.id); if (e.key === "Escape") { setRestockId(null); setRestockQty(""); } }}
                          style={styles.restockInput}
                          placeholder="0"
                        />
                        <button onClick={() => confirmRestock(item.id)} style={styles.restockConfirmBtn}>✓</button>
                        <button onClick={() => { setRestockId(null); setRestockQty(""); }} style={styles.restockCancelBtn}>✕</button>
                      </div>
                      {pack && Number(restockQty) > 0 && (
                        <span style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>
                          = {Number(restockQty) * pack.size} {item.unit} added
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={styles.stockControls}>
                      <span style={styles.stockQty}>{item.quantity}</span>
                      <button onClick={() => { setRestockId(item.id); setRestockQty(""); }} style={styles.restockBtn}>
                        {pack ? `+ ${pack.unit}` : "Restock"}
                      </button>
                    </div>
                  )}

                  <button onClick={() => setStock(prev => prev.filter(i => i.id !== item.id))} style={styles.userDeleteBtn}>×</button>
                </div>
              );
            };

            return (
              <div style={styles.stockPanel}>
                <div style={styles.settingsBar}>
                  <div style={styles.totalLeft}>
                    <span style={styles.totalLabel}>Stock</span>
                    <span style={styles.totalSub}>
                      {lowCount > 0 ? `⚠ ${lowCount} item${lowCount > 1 ? "s" : ""} running low` : "All items stocked"} · {todayLabel}
                    </span>
                  </div>
                </div>

                {consumables.length > 0 && (
                  <>
                    <div style={styles.stockCategoryHeader}>🔥 Consumables</div>
                    <div style={styles.stockList}>{consumables.map(renderItem)}</div>
                  </>
                )}

                {equipment.length > 0 && (
                  <>
                    <div style={styles.stockCategoryHeader}>🛠️ Equipment</div>
                    <div style={styles.stockList}>{equipment.map(renderItem)}</div>
                  </>
                )}

                <div style={styles.settingsSectionLabel}>Add Item</div>

                {/* Preset dropdown */}
                <select
                  value={newStockName}
                  onChange={e => {
                    const val = e.target.value;
                    setNewStockName(val);
                    if (val && val !== "__custom__") {
                      const preset = STOCK_PRESETS.find(p => p.name === val);
                      if (preset) {
                        setNewStockCategory(preset.category);
                        setNewStockUnit(preset.unit);
                        setNewStockThreshold(String(preset.lowThreshold));
                      }
                    } else if (val === "__custom__") {
                      setNewStockCategory("consumable");
                      setNewStockUnit("units");
                      setNewStockThreshold("");
                    }
                  }}
                  style={styles.stockSelectInput}
                >
                  <option value="">— Select an item —</option>
                  {["consumable", "equipment"].map(cat => {
                    const items = STOCK_PRESETS.filter(p => p.category === cat && !stock.some(s => s.name === p.name));
                    if (!items.length) return null;
                    return (
                      <optgroup key={cat} label={cat === "consumable" ? "🔥 Consumables" : "🛠️ Equipment"}>
                        {items.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </optgroup>
                    );
                  })}
                  <optgroup label="──────────">
                    <option value="__custom__">+ Custom item</option>
                  </optgroup>
                </select>

                {/* Custom name input */}
                {newStockName === "__custom__" && (
                  <input
                    type="text"
                    placeholder="Enter custom item name"
                    value={newStockCustomName}
                    onChange={e => setNewStockCustomName(e.target.value)}
                    style={styles.userNameInput}
                    autoFocus
                  />
                )}

                {/* Qty / unit / threshold / add — shown once a preset or custom name exists */}
                {(newStockName && newStockName !== "__custom__") || (newStockName === "__custom__" && newStockCustomName.trim()) ? (
                  <div style={styles.stockAddForm}>
                    <input type="number" min="0" placeholder="Qty" value={newStockQty} onChange={e => setNewStockQty(e.target.value)} style={{ ...styles.userNameInput, width: 72, flex: "none" }} />
                    <input type="text" placeholder="Unit" value={newStockUnit} onChange={e => setNewStockUnit(e.target.value)} style={{ ...styles.userNameInput, width: 90, flex: "none" }} />
                    <input type="number" min="0" placeholder="Low at" value={newStockThreshold} onChange={e => setNewStockThreshold(e.target.value)} style={{ ...styles.userNameInput, width: 72, flex: "none" }} />
                    <button
                      onClick={() => {
                        const name = newStockName === "__custom__" ? newStockCustomName.trim() : newStockName;
                        if (!name) return;
                        setStock(prev => [...prev, { id: Date.now(), name, category: newStockCategory, quantity: Number(newStockQty) || 0, unit: newStockUnit.trim() || "units", lowThreshold: Number(newStockThreshold) || 0 }]);
                        setNewStockName(""); setNewStockQty(""); setNewStockUnit("units"); setNewStockThreshold(""); setNewStockCategory("consumable"); setNewStockCustomName("");
                      }}
                      style={styles.addUserBtn}
                    >Add</button>
                  </div>
                ) : null}
              </div>
            );
          })()}

          {visibleTab === "settings" && (
            <div style={styles.settingsPanel}>
              <div style={styles.settingsBar}>
                <div style={styles.totalLeft}>
                  <span style={styles.totalLabel}>Settings</span>
                  <span style={styles.totalSub}>Terminal 01 · {todayLabel}</span>
                </div>
              </div>

              {/* ── Staff view: only their own profile ── */}
              {!isAdmin && (
                <>
                  <div style={styles.settingsSectionLabel}>My Profile</div>
                  <div style={styles.userCard}>
                    <div style={styles.userRow}>
                      <div style={styles.userAvatar}>
                        {activeUser.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={styles.userMeta}>
                        <strong style={styles.userName}>{activeUser.name}</strong>
                        <span style={styles.userRole}>{activeUser.role}</span>
                      </div>
                    </div>
                    <div style={styles.userPermissions}>
                      {[
                        { key: "pos",       label: "POS",             always: true },
                        { key: "delivered", label: "Orders Delivered", always: false },
                        { key: "stock",     label: "Stock",            always: false },
                        { key: "management",label: "Management",       always: false },
                        { key: "settings",  label: "Settings",         always: false },
                      ].map(({ key, label, always }) => {
                        const allowed = always || (currentUserPerms[key] ?? false);
                        return (
                          <span
                            key={key}
                            style={{ ...styles.permissionPill, ...(allowed ? styles.permissionPillOn : {}), cursor: "default" }}
                          >
                            {allowed ? "✓" : "✕"} {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* ── Admin view: full settings ── */}
              {isAdmin && <>

              <div style={styles.settingsSectionLabel}>Pricing</div>

              <div style={styles.settingsGrid}>
                <div style={styles.settingCard}>
                  <label style={styles.statLabel} htmlFor="new-pipe-price">New Pipe Price</label>
                  <input
                    id="new-pipe-price"
                    type="number"
                    min="0"
                    value={draftPrices.full}
                    onChange={(e) => setDraftPrices((p) => ({ ...p, full: e.target.value }))}
                    style={{ ...styles.priceInput, ...(draftPrices.full !== String(prices.full) ? styles.priceInputDirty : {}) }}
                  />
                  {draftPrices.full !== String(prices.full) && (
                    <div style={styles.priceConfirmRow}>
                      <button onClick={() => updatePrice("full", draftPrices.full)} style={styles.priceConfirmBtn}>Confirm</button>
                      <button onClick={() => setDraftPrices((p) => ({ ...p, full: String(prices.full) }))} style={styles.priceCancelBtn}>Cancel</button>
                    </div>
                  )}
                </div>
                <div style={styles.settingCard}>
                  <label style={styles.statLabel} htmlFor="refill-price">Refill Price</label>
                  <input
                    id="refill-price"
                    type="number"
                    min="0"
                    value={draftPrices.refill}
                    onChange={(e) => setDraftPrices((p) => ({ ...p, refill: e.target.value }))}
                    style={{ ...styles.priceInput, ...(draftPrices.refill !== String(prices.refill) ? styles.priceInputDirty : {}) }}
                  />
                  {draftPrices.refill !== String(prices.refill) && (
                    <div style={styles.priceConfirmRow}>
                      <button onClick={() => updatePrice("refill", draftPrices.refill)} style={styles.priceConfirmBtn}>Confirm</button>
                      <button onClick={() => setDraftPrices((p) => ({ ...p, refill: String(prices.refill) }))} style={styles.priceCancelBtn}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Users section — collapsible */}
              <button
                onClick={() => setUsersCollapsed((c) => !c)}
                style={styles.collapsibleHeader}
              >
                <span>Users</span>
                <span style={styles.collapseChevron}>{usersCollapsed ? "▶" : "▼"}</span>
              </button>

              {!usersCollapsed && (
                <div style={styles.userList}>
                  {users.filter((u) => isAdmin || u.role !== "Admin").map((u) => (
                    <div key={u.id} style={styles.userCard}>
                      <div style={styles.userRow}>
                        <div style={styles.userAvatar}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={styles.userMeta}>
                          <strong style={styles.userName}>{u.name}</strong>
                          <span style={styles.userRole}>{u.role}</span>
                        </div>
                        {isAdmin && (
                          deleteConfirmId === u.id ? (
                            <div style={styles.deleteConfirmRow}>
                              <span style={styles.deleteConfirmLabel}>Delete?</span>
                              <button
                                onClick={() => { setUsers((prev) => prev.filter((x) => x.id !== u.id)); setDeleteConfirmId(null); }}
                                style={styles.deleteConfirmYes}
                              >Yes</button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                style={styles.deleteConfirmNo}
                              >No</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(u.id)}
                              style={styles.userDeleteBtn}
                            >
                              ×
                            </button>
                          )
                        )}
                      </div>
                      <div style={styles.userPermissions}>
                        <span style={{ ...styles.permissionPill, ...styles.permissionPillAlwaysOn }}>
                          ✓ POS
                        </span>
                        {u.role !== "Admin" && [
                          { key: "delivered", label: "Orders Delivered" },
                          { key: "stock",     label: "Stock" },
                          { key: "management",label: "Management" },
                          { key: "settings",  label: "Settings" },
                        ].map(({ key, label }) => {
                          const allowed = u.permissions?.[key] ?? false;
                          return isAdmin ? (
                            <button
                              key={key}
                              onClick={() => setUsers((prev) => prev.map((x) =>
                                x.id === u.id ? { ...x, permissions: { ...x.permissions, [key]: !allowed } } : x
                              ))}
                              style={{ ...styles.permissionPill, ...(allowed ? styles.permissionPillOn : {}) }}
                            >
                              {allowed ? "✓" : "✕"} {label}
                            </button>
                          ) : (
                            <span
                              key={key}
                              style={{ ...styles.permissionPill, ...(allowed ? styles.permissionPillOn : {}), cursor: "default" }}
                            >
                              {allowed ? "✓" : "✕"} {label}
                            </span>
                          );
                        })}
                        {u.role === "Admin" && [
                          { key: "delivered", label: "Orders Delivered" },
                          { key: "stock",     label: "Stock" },
                          { key: "management",label: "Management" },
                          { key: "settings",  label: "Settings" },
                        ].map(({ key, label }) => (
                          <span key={key} style={{ ...styles.permissionPill, ...styles.permissionPillAlwaysOn }}>
                            ✓ {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {users.length === 0 && (
                    <div style={styles.emptyState}>No users added yet</div>
                  )}
                </div>
              )}

              {isAdmin && (
                <div style={styles.addUserForm}>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    style={styles.userNameInput}
                  />
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value)}
                    style={styles.userRoleSelect}
                  >
                    <option value="Staff">Staff</option>
                    <option value="Admin">Admin</option>
                  </select>
                  <input
                    type="password"
                    placeholder="Password"
                    value={newUserPin}
                    onChange={(e) => setNewUserPin(e.target.value)}
                    style={styles.userPinInput}
                  />
                  <button
                    onClick={() => {
                      if (!newUserName.trim() || !newUserPin) return;
                      const defaultPerms = newUserRole === "Admin"
                        ? { delivered: true, stock: true, management: true, settings: true }
                        : { delivered: true, stock: false, management: false, settings: false };
                      setUsers((prev) => [...prev, { id: Date.now(), name: newUserName.trim(), role: newUserRole, pin: newUserPin, permissions: defaultPerms }]);
                      setNewUserName("");
                      setNewUserPin("");
                    }}
                    style={styles.addUserBtn}
                  >
                    Add
                  </button>
                </div>
              )}
              </>}
            </div>
          )}
        </main>

        {visibleTab === "delivered" && totalDeliveredPages > 1 && (
          <div style={styles.pagination}>
            <button
              onClick={() => setDeliveredPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              style={{ ...styles.pageBtn, ...(safePage === 0 ? styles.pageBtnDisabled : {}) }}
            >
              ← Prev
            </button>
            <span style={styles.pageInfo}>Page {safePage + 1} of {totalDeliveredPages}</span>
            <button
              onClick={() => setDeliveredPage((p) => Math.min(totalDeliveredPages - 1, p + 1))}
              disabled={safePage === totalDeliveredPages - 1}
              style={{ ...styles.pageBtn, ...(safePage === totalDeliveredPages - 1 ? styles.pageBtnDisabled : {}) }}
            >
              Next →
            </button>
          </div>
        )}

        <footer style={styles.footer}>
          <button
            onClick={() => setActiveTab("pos")}
            style={{ ...styles.footerTab, ...(visibleTab === "pos" ? styles.footerTabActive : {}) }}
          >
            POS
            <span style={styles.footerBadge}>{currentOrders.length}</span>
          </button>
          {canAccess("delivered") && (
            <button
              onClick={() => setActiveTab("delivered")}
              style={{ ...styles.footerTab, ...(visibleTab === "delivered" ? styles.footerTabActive : {}) }}
            >
              Orders Delivered
              <span style={styles.footerBadge}>{deliveredOrders.length}</span>
            </button>
          )}
          {canAccess("stock") && (
            <button
              onClick={() => setActiveTab("stock")}
              style={{ ...styles.footerTab, ...(visibleTab === "stock" ? styles.footerTabActive : {}) }}
            >
              Stock
            </button>
          )}
          {canAccess("management") && (
            <button
              onClick={() => setActiveTab("management")}
              style={{ ...styles.footerTab, ...(visibleTab === "management" ? styles.footerTabActive : {}) }}
            >
              Management
            </button>
          )}
          {canAccess("settings") && (
            <button
              onClick={() => setActiveTab("settings")}
              style={{ ...styles.footerTab, ...(visibleTab === "settings" ? styles.footerTabActive : {}) }}
            >
              Settings
            </button>
          )}
        </footer>
        </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "'Inter', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    minHeight: "100vh",
    padding: 16,
    background: "transparent",
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
    background: "transparent",
    borderRadius: 12,
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 10px 12px",
    background: "rgba(255,255,255,0.7)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
  },
  mainContent: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
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
    background: "rgba(255,255,255,0.65)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.8)",
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
    background: "rgba(241,245,249,0.7)",
    border: "1px solid rgba(255,255,255,0.75)",
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
    background: "rgba(241,245,249,0.6)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 10,
  },
  deliveredPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    background: "rgba(241,245,249,0.6)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 10,
  },
  settingsPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    background: "rgba(248,250,252,0.6)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 10,
  },
  totalBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "rgba(15,23,42,0.82)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "13px 15px",
    borderRadius: 9,
  },
  deliveredBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "rgba(15,23,42,0.82)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "13px 15px",
    borderRadius: 9,
  },
  settingsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "rgba(51,65,85,0.82)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
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
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingTop: 4,
  },
  pageBtn: {
    padding: "8px 16px",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.65)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  pageBtnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  pageInfo: {
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
  },
  settingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  permissionsList: {},
  permissionRow: {},
  permissionLabel: {},
  permissionToggle: {},
  permissionToggleOn: {},
  permissionToggleKnob: {},
  permissionStatus: {},
  userCard: {
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
    overflow: "hidden",
  },
  userPermissions: {
    display: "flex",
    gap: 6,
    padding: "8px 12px 10px",
    borderTop: "1px solid rgba(203,213,225,0.3)",
    flexWrap: "wrap",
  },
  permissionPill: {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #cbd5e1",
    background: "rgba(255,255,255,0.5)",
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s ease",
  },
  permissionPillOn: {
    background: "#0f172a",
    borderColor: "#0f172a",
    color: "#ffffff",
  },
  permissionPillAlwaysOn: {
    background: "rgba(15,23,42,0.08)",
    borderColor: "rgba(15,23,42,0.15)",
    color: "#64748b",
    cursor: "default",
  },
  settingsSectionLabel: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#64748b",
    paddingLeft: 2,
    marginTop: 4,
  },
  userList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  userRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
  },
  userAvatar: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  userMeta: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 13,
    fontWeight: 900,
    color: "#0f172a",
  },
  userRole: {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
  },
  collapsibleHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    background: "none",
    border: "none",
    padding: "2px 2px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#64748b",
  },
  collapseChevron: {
    fontSize: 10,
    color: "#94a3b8",
    fontWeight: 900,
  },
  expandChevron: {
    fontSize: 10,
    color: "#94a3b8",
    marginLeft: "auto",
    flexShrink: 0,
    marginRight: 6,
  },
  deleteConfirmRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  deleteConfirmLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#e11d48",
  },
  deleteConfirmYes: {
    padding: "4px 10px",
    border: "none",
    borderRadius: 7,
    background: "#e11d48",
    color: "#fff",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  deleteConfirmNo: {
    padding: "4px 10px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 7,
    background: "rgba(255,255,255,0.7)",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  userDeleteBtn: {
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
    flexShrink: 0,
  },
  addUserForm: {
    display: "flex",
    gap: 6,
    alignItems: "flex-start",
  },
  userPinInput: {
    width: 64,
    minHeight: 40,
    padding: "8px 10px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
    textAlign: "center",
    letterSpacing: "0.2em",
    flexShrink: 0,
  },
  // Stock tab
  stockPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    background: "rgba(248,250,252,0.6)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 10,
  },
  stockCategoryHeader: {
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#64748b",
    paddingLeft: 2,
    marginTop: 4,
  },
  stockList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  stockRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 9,
  },
  stockRowLow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    background: "rgba(255,251,235,0.88)",
    border: "1px solid rgba(253,230,138,0.7)",
    borderRadius: 9,
  },
  stockRowCritical: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    background: "rgba(254,242,242,0.88)",
    border: "1px solid rgba(254,202,202,0.7)",
    borderRadius: 9,
  },
  stockInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
  },
  stockName: {
    fontSize: 13,
    fontWeight: 800,
    color: "#0f172a",
  },
  stockMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  stockUnit: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
  },
  stockBadge: {
    fontSize: 10,
    fontWeight: 800,
    padding: "1px 7px",
    borderRadius: 999,
    border: "1px solid",
    whiteSpace: "nowrap",
  },
  stockControls: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  stockBtnMinus: {
    width: 32,
    height: 32,
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.7)",
    color: "#64748b",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  stockBtnPlus: {
    width: 32,
    height: 32,
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.7)",
    color: "#0f172a",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  stockQty: {
    fontSize: 15,
    fontWeight: 900,
    color: "#0f172a",
    minWidth: 32,
    textAlign: "center",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  restockBtn: {
    height: 32,
    padding: "0 10px",
    border: "1px solid rgba(15,23,42,0.2)",
    borderRadius: 8,
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    marginLeft: 4,
  },
  restockRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  restockInput: {
    width: 60,
    height: 32,
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: "rgba(255,255,255,0.8)",
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    textAlign: "center",
    outline: "none",
    padding: "0 6px",
  },
  restockConfirmBtn: {
    width: 32,
    height: 32,
    border: "none",
    borderRadius: 8,
    background: "#16a34a",
    color: "#fff",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  restockCancelBtn: {
    width: 32,
    height: 32,
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.7)",
    color: "#64748b",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  subItemList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "6px 4px 2px 8px",
  },
  subItemRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    background: "rgba(255,255,255,0.6)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 8,
  },
  subItemTag: {
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  stockAddForm: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap",
  },
  stockSelectInput: {
    width: "100%",
    minHeight: 44,
    padding: "10px 12px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 10,
    background: "rgba(255,255,255,0.7)",
    color: "#0f172a",
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
    appearance: "auto",
  },
  // Login screen
  loginScreen: {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "calc(100vh - 60px)",
    background: "transparent",
    borderRadius: 10,
    margin: -14,
    padding: "28px 22px",
  },
  loginOrb1: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(100,130,180,0.25) 0%, transparent 70%)",
    top: -80,
    left: -60,
    pointerEvents: "none",
  },
  loginOrb2: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(80,110,160,0.18) 0%, transparent 70%)",
    bottom: -60,
    right: -50,
    pointerEvents: "none",
  },
  loginOrb3: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(148,163,184,0.2) 0%, transparent 70%)",
    top: "38%",
    right: 20,
    pointerEvents: "none",
  },
  loginCard: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    background: "rgba(255,255,255,0.55)",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 20,
    padding: "32px 24px 28px",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    boxShadow: "0 8px 32px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
    display: "flex",
    flexDirection: "column",
  },
  loginLogoWrap: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.9)",
    boxShadow: "0 4px 16px rgba(15,23,42,0.1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    alignSelf: "center",
  },
  loginHero: {},
  loginLogo: {
    width: 48,
    height: 36,
    objectFit: "contain",
  },
  loginHeroText: {},
  loginBrandTag: {
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: "#64748b",
    marginBottom: 6,
    textAlign: "center",
  },
  loginBrandName: {},
  loginAppName: {
    fontSize: 26,
    fontWeight: 900,
    letterSpacing: "-0.03em",
    color: "#0f172a",
    margin: "0 0 6px",
    lineHeight: 1.1,
    textAlign: "center",
  },
  loginMeta: {
    fontSize: 13,
    fontWeight: 500,
    color: "#64748b",
    margin: "0 0 28px",
    textAlign: "center",
  },
  loginCardLabel: {},
  loginField: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginBottom: 20,
  },
  loginLabel: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#64748b",
  },
  loginInput: {
    border: "none",
    borderBottom: "1.5px solid rgba(15,23,42,0.15)",
    padding: "10px 0",
    fontSize: 14,
    color: "#0f172a",
    outline: "none",
    background: "transparent",
    fontFamily: "inherit",
    width: "100%",
  },
  loginErrorMsg: {
    fontSize: 12,
    fontWeight: 700,
    color: "#e11d48",
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    borderRadius: 8,
    padding: "8px 12px",
    marginBottom: 12,
    textAlign: "center",
  },
  loginSignInBtn: {
    width: "100%",
    padding: "15px",
    background: "#0f172a",
    border: "none",
    borderRadius: 10,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    boxShadow: "0 4px 16px rgba(15,23,42,0.2)",
    marginTop: 8,
  },
  loginFooterNote: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: 600,
    color: "#94a3b8",
    marginTop: 20,
    letterSpacing: "0.04em",
  },
  userPickerGrid: { display: "flex", flexDirection: "column", gap: 0 },
  userPickerCard: {},
  userPickerCardActive: {},
  userPickerAvatar: {},
  userPickerName: {},
  userPickerRoleBadge: {},
  pinBackBtn: {},
  pinTargetInfo: {},
  pinTargetName: {},
  pinTargetRole: {},
  pinDotsRow: {},
  pinDot: {},
  pinDotFilled: {},
  pinError: {},
  pinPad: {},
  pinKey: {},
  pinLabel: {},
  // Active user chip in top bar
  activeUserChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    background: "rgba(255,255,255,0.6)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 9,
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  activeUserAvatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  activeUserInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    textAlign: "left",
  },
  activeUserName: {
    fontSize: 12,
    fontWeight: 900,
    color: "#0f172a",
    lineHeight: 1.2,
  },
  activeUserRoleLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#64748b",
    lineHeight: 1.2,
  },
  userNameInput: {
    flex: 1,
    minHeight: 40,
    padding: "8px 10px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
  },
  userRoleSelect: {
    minHeight: 40,
    padding: "8px 10px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
  },
  addUserBtn: {
    minHeight: 40,
    padding: "0 16px",
    border: "none",
    borderRadius: 8,
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  settingCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 9,
  },
  settingValue: {
    fontSize: 20,
    fontWeight: 900,
    color: "#0f172a",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  priceInput: {
    width: "100%",
    minHeight: 42,
    padding: "8px 10px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0f172a",
    fontSize: 18,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    outline: "none",
  },
  priceInputDirty: {
    borderColor: "#f59e0b",
    background: "#fffbeb",
  },
  priceConfirmRow: {
    display: "flex",
    gap: 6,
    marginTop: 4,
  },
  priceConfirmBtn: {
    flex: 1,
    padding: "7px 0",
    border: "none",
    borderRadius: 7,
    background: "#16a34a",
    color: "#fff",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  priceCancelBtn: {
    padding: "7px 12px",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 7,
    background: "rgba(255,255,255,0.65)",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  emptyState: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 800,
    padding: "34px 0",
    background: "rgba(255,255,255,0.5)",
    border: "1px dashed rgba(203,213,225,0.8)",
    borderRadius: 9,
  },
  orderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 10px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 8,
    fontSize: 13,
  },
  deliveredRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 10px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
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
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
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
    background: "rgba(255,255,255,0.65)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 9,
    overflow: "hidden",
  },
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid rgba(241,245,249,0.8)",
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
    background: "rgba(255,255,255,0.65)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 10,
    padding: 12,
  },
  brandLogo: {
    display: "block",
    width: "100%",
    maxHeight: 140,
    objectFit: "contain",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: 6,
    background: "rgba(255,255,255,0.5)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.7)",
    borderRadius: 10,
  },
  footerTab: {
    flex: 1,
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    border: "1px solid transparent",
    borderRadius: 8,
    background: "transparent",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "center",
  },
  footerTabActive: {
    background: "rgba(255,255,255,0.75)",
    borderColor: "rgba(255,255,255,0.9)",
    color: "#0f172a",
    boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
  },
  footerBadge: {
    minWidth: 20,
    height: 20,
    padding: "0 6px",
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 900,
  },
  summaryDivider: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "4px 0",
  },
  summaryDividerLine: {
    flex: 1,
    height: 1,
    background: "#e2e8f0",
  },
  summaryDividerLabel: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "#94a3b8",
    whiteSpace: "nowrap",
  },
  revenueHero: {
    background: "rgba(15,23,42,0.82)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderRadius: 10,
    padding: "14px 16px 12px",
    color: "#ffffff",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  revenueHeroTop: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  revenueHeroLabel: {
    fontSize: 9,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "#475569",
    marginBottom: 2,
  },
  revenueHeroAmount: {
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: "-0.04em",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    lineHeight: 1,
  },
  revenueHeroMeta: {
    fontSize: 11,
    fontWeight: 700,
    color: "#475569",
    paddingBottom: 2,
  },
  revenueStatRow: {
    display: "flex",
    background: "rgba(255,255,255,0.05)",
    borderRadius: 7,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.07)",
  },
  revenueStat: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 1,
    padding: "8px 4px",
  },
  revenueStatDivider: {
    width: 1,
    background: "rgba(255,255,255,0.07)",
  },
  revenueStatIcon: {
    fontSize: 13,
    lineHeight: 1,
  },
  revenueStatLabel: {
    fontSize: 9,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#475569",
  },
  revenueStatValue: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: "#f1f5f9",
    letterSpacing: "-0.02em",
  },
  flavourBreakdown: {
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  flavourBreakdownHeader: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#64748b",
    marginBottom: 2,
  },
  flavourBreakdownRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  flavourBreakdownIcon: {
    fontSize: 15,
    width: 20,
    textAlign: "center",
    flexShrink: 0,
  },
  flavourBreakdownName: {
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
    width: 88,
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  flavourBarTrack: {
    flex: 1,
    height: 6,
    background: "#f1f5f9",
    borderRadius: 999,
    overflow: "hidden",
  },
  flavourBar: {
    height: "100%",
    borderRadius: 999,
    transition: "width 0.3s ease",
    minWidth: 2,
  },
  flavourBreakdownCount: {
    fontSize: 13,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    width: 20,
    textAlign: "right",
    flexShrink: 0,
  },
  orderLogSection: {
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
    overflow: "hidden",
  },
  orderLogHeader: {
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "#64748b",
    padding: "10px 14px 8px",
    borderBottom: "1px solid #f1f5f9",
  },
  orderLog: {
    maxHeight: 220,
    overflowY: "auto",
  },
  orderLogRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 14px",
    borderBottom: "1px solid #f8fafc",
    fontSize: 12,
  },
  orderLogIndex: {
    width: 22,
    fontSize: 10,
    color: "#cbd5e1",
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    flexShrink: 0,
  },
  orderLogMeta: {
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
  },
  orderLogTime: {
    fontSize: 11,
    color: "#94a3b8",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    flexShrink: 0,
  },
  orderLogPrice: {
    fontSize: 12,
    fontWeight: 900,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: "#0f172a",
    width: 44,
    textAlign: "right",
    flexShrink: 0,
  },
};
