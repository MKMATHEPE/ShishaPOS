import { useState, useCallback, useRef, useEffect } from "react";

async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Pre-computed SHA-256("1234") for the sync useState initializer
const HASH_1234 = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";
import chillPipeLogo from "./assets/The_Chill_Pipe.png";
import { supabase } from "./supabase";
import {
  fetchUsers, syncUsers,
  fetchStock, syncStock,
  fetchOrders, fetchUnreturnedPipes, insertOrder, updateOrder, deleteOrder,
  fetchExpenses, syncExpenses,
  fetchHistoricalRevenue,
  fetchOrdersByDateRange, fetchSessionDates,
} from "./db";

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

const LOGO_SRC = chillPipeLogo;

const isPipeEquipment = (item) =>
  item.category === "equipment" && (
    item.name.toLowerCase().includes("hookah") ||
    item.name.toLowerCase().includes("rota") ||
    item.name.toLowerCase().includes("kop")
  );

function formatTime(date) {
  return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function localToday() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
}

function formatSessionDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" });
}

function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
}

function formatCurrency(n) {
  return `R${n.toLocaleString()}`;
}

export default function App() {
  const [orders, setOrders] = useState([]);
  const [unreturnedPipes, setUnreturnedPipes] = useState([]);
  const [prices, setPrices] = useState(DEFAULT_PRICES);
  const [draftPrices, setDraftPrices] = useState({ full: String(DEFAULT_PRICES.full), refill: String(DEFAULT_PRICES.refill) });
  const [dbReady, setDbReady] = useState(false);
  const [avgDailyRevenue, setAvgDailyRevenue] = useState(null);
  const [users, setUsers] = useState(() => {
    try {
      const s = localStorage.getItem("pos_users");
      return s ? JSON.parse(s) : [{ id: 1, name: "Admin", role: "Admin", pin: HASH_1234, permissions: { delivered: true, stock: true, management: true, settings: true } }];
    } catch { return [{ id: 1, name: "Admin", role: "Admin", pin: HASH_1234, permissions: { delivered: true, stock: true, management: true, settings: true } }]; }
  });
  const [activeUser, setActiveUser] = useState(() => {
    try { const s = localStorage.getItem("pos_active_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  useEffect(() => {
    if (activeUser) localStorage.setItem("pos_active_user", JSON.stringify(activeUser));
    else localStorage.removeItem("pos_active_user");
  }, [activeUser]);

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
      { id: 8,  name: "Mouth Pieces", category: "consumable", quantity: 50, unit: "pieces",  lowThreshold: 10 },
      { id: 9,  name: "Kops",         category: "equipment",  quantity: 5,  unit: "units",   lowThreshold: 1 },
      { id: 10, name: "Rotas",        category: "equipment",  quantity: 8,  unit: "units",   lowThreshold: 2 },
      { id: 11, name: "Rota Tops",    category: "equipment",  quantity: 8,  unit: "units",   lowThreshold: 2 },
      { id: 12, name: "Stove",        category: "equipment",  quantity: 2,  unit: "units",   lowThreshold: 1 },
          ];
    try {
      const s = localStorage.getItem("pos_stock");
      if (!s) return defaults;
      const flavourNames = new Set(FLAVOURS.map(f => f.name));
      // Strip old individual flavour rows — they're now sub-items under Flavour
      const saved = JSON.parse(s).filter(i => !flavourNames.has(i.name));
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
  const [usersCollapsed, setUsersCollapsed] = useState(false);
  const [consumablesCollapsed, setConsumablesCollapsed] = useState(true);
  const [equipmentCollapsed, setEquipmentCollapsed] = useState(true);
  const [stockSummaryCollapsed, setStockSummaryCollapsed] = useState(true);
  const [kpisCollapsed, setKpisCollapsed] = useState(true);
  const [accountingCollapsed, setAccountingCollapsed] = useState(true);
  const [expensesCollapsed, setExpensesCollapsed] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [expandedStockIds, setExpandedStockIds] = useState(new Set());
  const [editSubId, setEditSubId] = useState(null); // { stockId, subId }
  const [editSubQty, setEditSubQty] = useState("");
  const [editStockId, setEditStockId] = useState(null);
  const [editStockQty, setEditStockQty] = useState("");
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [expenses, setExpenses] = useState(() => {
    try { const s = localStorage.getItem("pos_expenses"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [newExpenseCat, setNewExpenseCat] = useState("Coal");
  const [newExpenseDesc, setNewExpenseDesc] = useState("");
  const [newExpenseAmt, setNewExpenseAmt] = useState("");
  const [editStockCost, setEditStockCost] = useState("");
  const [editSubCost, setEditSubCost] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(formatTime(new Date())), 60000);
    return () => clearInterval(id);
  }, []);
  const [managementDateFrom, setManagementDateFrom] = useState(localToday);
  const [managementDateTo, setManagementDateTo] = useState(localToday);
  const [managementTimeFrom, setManagementTimeFrom] = useState("00:00");
  const [managementTimeTo, setManagementTimeTo] = useState("23:59");
  const [managementOrders, setManagementOrders] = useState([]);
  const [managementLoading, setManagementLoading] = useState(false);
  const [sessionDates, setSessionDates] = useState([]);
  const listRef = useRef(null);
  const undoTimer = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [orders]);

  // ── On mount: load from Supabase, fall back to localStorage ──
  useEffect(() => {
    async function load() {
      const [remoteUsers, remoteStock, remoteOrders, remoteExpenses, histRevenue, remoteUnreturned] = await Promise.all([
        fetchUsers(), fetchStock(), fetchOrders(), fetchExpenses(), fetchHistoricalRevenue(), fetchUnreturnedPipes(),
      ]);
      if (histRevenue !== null) setAvgDailyRevenue(histRevenue);
      if (remoteUsers && remoteUsers.length > 0) {
        setUsers(remoteUsers);
        localStorage.setItem("pos_users", JSON.stringify(remoteUsers));
      } else if (remoteUsers && remoteUsers.length === 0) {
        // Supabase is empty — seed it with current defaults
        const defaults = [{ id: 1, name: "Admin", role: "Admin", pin: HASH_1234, permissions: { delivered: true, stock: true, management: true, settings: true } }];
        setUsers(defaults);
        localStorage.setItem("pos_users", JSON.stringify(defaults));
        syncUsers(defaults);
      }
      if (remoteStock && remoteStock.length > 0) { setStock(remoteStock); localStorage.setItem("pos_stock", JSON.stringify(remoteStock)); }
      if (remoteOrders && remoteOrders.length > 0)  { setOrders(remoteOrders); }
      if (remoteUnreturned) setUnreturnedPipes(remoteUnreturned);
      if (remoteExpenses && remoteExpenses.length > 0){ setExpenses(remoteExpenses); localStorage.setItem("pos_expenses", JSON.stringify(remoteExpenses)); }
      setDbReady(true);
    }
    if (supabase) { load(); } else { setDbReady(true); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync to localStorage + Supabase on every change ──
  useEffect(() => {
    localStorage.setItem("pos_users", JSON.stringify(users));
    if (dbReady) syncUsers(users);
  }, [users]); // eslint-disable-line

  useEffect(() => {
    localStorage.setItem("pos_stock", JSON.stringify(stock));
    if (dbReady) syncStock(stock);
  }, [stock]); // eslint-disable-line

  useEffect(() => {
    localStorage.setItem("pos_expenses", JSON.stringify(expenses));
    if (dbReady) syncExpenses(expenses);
  }, [expenses]); // eslint-disable-line

  // Re-fetch from Supabase whenever the user switches tabs
  useEffect(() => {
    if (!dbReady || !supabase) return;
    async function refresh() {
      const [remoteOrders, remoteStock, remoteExpenses, remoteUnreturned] = await Promise.all([
        fetchOrders(), fetchStock(), fetchExpenses(), fetchUnreturnedPipes(),
      ]);
      if (remoteOrders) setOrders(remoteOrders);
      if (remoteUnreturned) setUnreturnedPipes(remoteUnreturned);
      if (remoteStock && remoteStock.length > 0) {
        setStock(remoteStock);
        localStorage.setItem("pos_stock", JSON.stringify(remoteStock));
      }
      if (remoteExpenses) {
        setExpenses(remoteExpenses);
        localStorage.setItem("pos_expenses", JSON.stringify(remoteExpenses));
      }
    }
    refresh();
  }, [activeTab]); // eslint-disable-line

  // Fetch session dates list once management tab is opened
  useEffect(() => {
    if (activeTab !== "management" || !supabase || sessionDates.length > 0) return;
    fetchSessionDates().then(dates => { if (dates) setSessionDates(dates); });
  }, [activeTab]); // eslint-disable-line

  // Fetch orders when the management date/time range changes
  useEffect(() => {
    const todayStr = localToday();
    if (managementDateFrom === todayStr && managementDateTo === todayStr) {
      setManagementOrders([]); return; // today filtered client-side from live orders
    }
    if (!supabase) return;
    setManagementLoading(true);
    const from = new Date(`${managementDateFrom}T${managementTimeFrom}:00`).toISOString();
    const to   = new Date(`${managementDateTo}T${managementTimeTo}:59`).toISOString();
    fetchOrdersByDateRange(from, to).then(o => {
      setManagementOrders(o ?? []);
      setManagementLoading(false);
    });
  }, [managementDateFrom, managementDateTo, managementTimeFrom, managementTimeTo]); // eslint-disable-line

  const hookahPipeQty = stock.find(i => i.category === "equipment" && i.name.toLowerCase().includes("hookah"))?.quantity ?? 0;
  const rotasQty      = stock.find(i => i.category === "equipment" && i.name.toLowerCase() === "rotas")?.quantity ?? 0;
  const rotaTopsQty   = stock.find(i => i.category === "equipment" && i.name.toLowerCase().includes("rota top"))?.quantity ?? 0;
  const kopsQty       = stock.find(i => i.category === "equipment" && i.name.toLowerCase().includes("kop"))?.quantity ?? 0;

  const confirmOrder = useCallback(() => {
    if (!selectedFlavour) return;
    if (orderType === "full" && (hookahPipeQty <= 1 || rotasQty <= 1 || rotaTopsQty <= 1 || kopsQty <= 1)) return;

    const order = {
      id: Date.now(),
      flavour: selectedFlavour,
      type: orderType,
      payment: payMethod,
      price: prices[orderType],
      time: new Date(),
      status: "active",
      soldBy: activeUser?.name ?? "Unknown",
      pipeReturned: false,
    };

    setOrders((prev) => [...prev, order]);
    insertOrder(order);

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
  }, [selectedFlavour, orderType, payMethod, prices, hookahPipeQty, rotasQty, rotaTopsQty, kopsQty]);

  const updatePrice = useCallback((type, value) => {
    const nextPrice = Number(value);
    setPrices((prev) => ({
      ...prev,
      [type]: Number.isFinite(nextPrice) && nextPrice >= 0 ? nextPrice : 0,
    }));
  }, []);

  const handleLogin = useCallback(async () => {
    const hashed = await hashPin(loginPassword);
    const match = users.find(
      (u) => u.name.toLowerCase() === loginUsername.trim().toLowerCase() && u.pin === hashed
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
  }, [users, loginUsername, loginPassword]);  // eslint-disable-line

  // Restores the 4 equipment items deducted by markDelivered.
  // Must be called BEFORE the order is removed from state.
  // Guard conditions prevent double-restoration and refill false-positives.
  const restorePipeEquipment = useCallback((order) => {
    if (
      order?.type === "full" &&
      order?.status === "delivered" &&
      !order?.pipeReturned
    ) {
      setStock(s => s.map(item =>
        isPipeEquipment(item) ? { ...item, quantity: item.quantity + 1 } : item
      ));
    }
  }, []);

  const undoLast = useCallback(() => {
    if (!undoTarget) return;
    // Read current order state to check if it was marked delivered in the undo window.
    // If it was, restorePipeEquipment handles the equipment reversal.
    const order = orders.find(o => o.id === undoTarget);
    if (order) restorePipeEquipment(order);
    setOrders(prev => prev.filter(o => o.id !== undoTarget));
    deleteOrder(undoTarget);
    setUndoTarget(null);
    clearTimeout(undoTimer.current);
  }, [undoTarget, orders, restorePipeEquipment]);

  // Accepts the full order object so there is no stale-closure risk when reading
  // order.status / order.pipeReturned — we inspect before any state mutation.
  const removeOrder = useCallback((order) => {
    // 1. Restore equipment if the pipe was out when the order is cancelled
    restorePipeEquipment(order);
    // 2. Remove from local state
    setOrders(prev => prev.filter(o => o.id !== order.id));
    // 3. Hard-delete from DB
    deleteOrder(order.id);
  }, [restorePipeEquipment]);

  // Removes a historical unreturned pipe (from a previous session).
  // Equipment must be restored before deletion — pipe was never returned.
  const removeUnreturnedPipe = useCallback((pipe) => {
    restorePipeEquipment(pipe);
    setUnreturnedPipes(prev => prev.filter(o => o.id !== pipe.id));
    deleteOrder(pipe.id);
  }, [restorePipeEquipment]);

  const returnPipe = useCallback((id) => {
    setOrders((prev) => prev.map((o) => o.id === id ? { ...o, pipeReturned: true } : o));
    setUnreturnedPipes((prev) => prev.filter(o => o.id !== id));
    setStock(s => s.map(item => isPipeEquipment(item) ? { ...item, quantity: item.quantity + 1 } : item));
    updateOrder(id, { pipeReturned: true });
  }, []);

  // Accepts the full order object to avoid reading order.type inside a state updater
  // (calling setState inside setState updater is an anti-pattern — updaters must be pure).
  const markDelivered = useCallback((order) => {
    const deliveredAt = new Date();
    // Deduct one unit of each equipment item for new-pipe orders.
    // This is reversed by returnPipe, or by removeOrder if the order is later cancelled.
    if (order.type === "full") {
      setStock(s => s.map(item =>
        isPipeEquipment(item) ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item
      ));
    }
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "delivered", deliveredAt } : o));
    updateOrder(order.id, { status: "delivered", deliveredAt });
  }, []);

  const currentOrders = orders.filter((o) => o.status !== "delivered");
  const deliveredOrders = orders.filter((o) => o.status === "delivered");
  const pipesOut = deliveredOrders.filter((o) => o.type === "full" && !o.pipeReturned).length + unreturnedPipes.length;

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

              <div style={styles.loginFooterNote}>{todayLabel} · {currentTime}</div>
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
              <div style={styles.terminalMeta}>{todayLabel} · {currentTime}</div>
            </div>
          </div>
          {confirmLogout ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.85)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Switch user?</span>
              <button
                onClick={() => { setActiveUser(null); setConfirmLogout(false); }}
                style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#0f172a", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >Yes</button>
              <button
                onClick={() => setConfirmLogout(false)}
                style={{ fontSize: 12, fontWeight: 800, color: "#64748b", background: "rgba(0,0,0,0.06)", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmLogout(true)} style={styles.activeUserChip}>
              <div style={styles.activeUserAvatar}>{activeUser.name.charAt(0).toUpperCase()}</div>
              <div style={styles.activeUserInfo}>
                <span style={styles.activeUserName}>{activeUser.name}</span>
                <span style={styles.activeUserRoleLabel}>{activeUser.role} · Switch</span>
              </div>
            </button>
          )}
        </div>

        <main style={styles.mainContent}>
          {visibleTab === "pos" && (
            <div key="pos" className="tab-enter">
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
                  border: `1px solid ${selectedFlavour?.id === f.id ? f.color : f.border}`,
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

          {selectedFlavour && (() => {
            const blockedItem = orderType === "full"
              ? (hookahPipeQty <= 1 ? "Hookah Pipe" : rotasQty <= 1 ? "Rotas" : rotaTopsQty <= 1 ? "Rota Tops" : kopsQty <= 1 ? "Kops" : null)
              : null;
            const blocked = !!blockedItem;
            return (
              <button
                onClick={confirmOrder}
                disabled={blocked}
                style={{ ...styles.confirmBtn, ...(blocked ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}
              >
                {blocked
                  ? `No ${blockedItem} available · ${selectedFlavour.name}`
                  : `Add to order · ${selectedFlavour.name} · ${orderType === "full" ? "New Pipe" : "Refill"} · ${formatCurrency(prices[orderType])}`
                }
              </button>
            );
          })()}

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
              <div key={o.id} className="card-enter" style={{ ...styles.orderRow, animationDelay: `${i * 0.07}s` }}>
                <span style={styles.orderIndex}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color }}>
                  {o.flavour.icon} {o.flavour.short}
                </span>
                <span style={styles.orderMeta}>
                  <strong>{o.flavour.name}</strong>
                  <small>{o.type === "refill" ? "Refill" : "New Pipe"} · {o.payment === "card" ? "Card" : "Cash"} · {formatTime(o.time)}</small>
                </span>
                <span style={styles.orderPrice}>{formatCurrency(o.price)}</span>
                <button onClick={() => markDelivered(o)} style={styles.deliverBtn}>Delivered</button>
                <button onClick={() => removeOrder(o)} style={styles.deleteBtn}>×</button>
              </div>
            ))}
          </div>
        </div>
            </div>
          )}

          {visibleTab === "delivered" && (
            <div key="delivered" className="tab-enter" style={styles.deliveredPanel}>
              <div style={{ ...styles.deliveredBar, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={styles.totalLeft}>
                  <span style={styles.totalLabel}>Orders Delivered</span>
                  <span style={styles.totalSub}>{deliveredOrders.length} orders · Card {deliveredPaymentCounts.card} · Cash {deliveredPaymentCounts.cash}</span>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span style={styles.totalSub}>{pipesOut} out · {hookahPipeQty} available</span>
                </div>
              </div>

              <div style={styles.deliveredList}>
                {deliveredOrders.length === 0 && unreturnedPipes.length === 0 && (
                  <div style={styles.emptyState}>No delivered orders yet</div>
                )}
                {unreturnedPipes.map((o, i) => (
                  <div key={o.id} style={styles.deliveredRow}>
                    <span style={styles.orderIndex}>{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color }}>
                      {o.flavour.icon} {o.flavour.short}
                    </span>
                    <span style={styles.orderMeta}>
                      <strong>{o.flavour.name}</strong>
                      <small>New Pipe · {o.payment === "card" ? "Card" : "Cash"} · {formatDateShort(o.sessionDate)} · delivered {formatTime(o.deliveredAt)}</small>
                    </span>
                    <button
                      onClick={() => returnPipe(o.id)}
                      style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid #fca5a5", background: "#fef2f2", color: "#dc2626", cursor: "pointer", flexShrink: 0, marginLeft: o.soldBy ? 8 : "auto" }}
                    >Return Pipe</button>
                    {o.soldBy && <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{o.soldBy}</span>}
                  </div>
                ))}
                {deliveredOrders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE).map((o, i) => (
                  <div key={o.id} style={styles.deliveredRow}>
                    <span style={styles.orderIndex}>{String(unreturnedPipes.length + safePage * PAGE_SIZE + i + 1).padStart(2, "0")}</span>
                    <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color }}>
                      {o.flavour.icon} {o.flavour.short}
                    </span>
                    <span style={styles.orderMeta}>
                      <strong>{o.flavour.name}</strong>
                      <small>{o.type === "refill" ? "Refill" : "New Pipe"} · {o.payment === "card" ? "Card" : "Cash"} · ordered {formatTime(o.time)} · delivered {formatTime(o.deliveredAt)}</small>
                    </span>
                    {o.type === "full" && (
                      o.pipeReturned
                        ? <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0, marginLeft: o.soldBy ? 8 : "auto" }}>Returned</span>
                        : <button
                            onClick={() => returnPipe(o.id)}
                            style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid #cbd5e1", background: "transparent", color: "#64748b", cursor: "pointer", flexShrink: 0, marginLeft: o.soldBy ? 8 : "auto" }}
                          >Return Pipe</button>
                    )}
                    {o.soldBy && <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0, marginLeft: o.type === "full" ? 0 : "auto" }}>{o.soldBy}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleTab === "management" && (() => {
            const todayStr = localToday();
            const isViewingToday = managementDateFrom === todayStr && managementDateTo === todayStr;
            const [ffh, ffm] = managementTimeFrom.split(":").map(Number);
            const [fth, ftm] = managementTimeTo.split(":").map(Number);
            const fromMin = ffh * 60 + ffm;
            const toMin   = fth * 60 + ftm;
            const displayOrders = isViewingToday
              ? orders.filter(o => {
                  const t = o.time instanceof Date ? o.time : new Date(o.time);
                  const m = t.getHours() * 60 + t.getMinutes();
                  return m >= fromMin && m <= toMin;
                })
              : managementOrders;
            const displayTotals = displayOrders.reduce((acc, o) => {
              acc.gross += o.price;
              if (o.payment === "card") acc.card += o.price; else acc.cash += o.price;
              return acc;
            }, { gross: 0, card: 0, cash: 0 });
            const displayFlavourCounts = displayOrders.reduce((acc, o) => {
              acc[o.flavour.id] = (acc[o.flavour.id] || 0) + 1; return acc;
            }, {});
            const displayDeliveredOrders = displayOrders.filter((o) => o.status === "delivered");
            const displayCurrentOrders   = displayOrders.filter((o) => o.status !== "delivered");
            const displayExpenses = expenses.filter(e => {
              const d = new Date(e.time);
              const eDate = [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
              return eDate >= managementDateFrom && eDate <= managementDateTo;
            });

            const newPipeOrders = displayOrders.filter((o) => o.type === "full");
            const refillOrders  = displayOrders.filter((o) => o.type === "refill");
            const maxFlavourCount = Math.max(...FLAVOURS.map((f) => displayFlavourCounts[f.id] || 0), 1);

            // KPIs
            const totalOrders = displayOrders.length;
            const avgOrderValue = totalOrders > 0 ? displayTotals.gross / totalOrders : 0;
            const refillRate = totalOrders > 0 ? Math.round((refillOrders.length / totalOrders) * 100) : 0;
            const cardPct = displayTotals.gross > 0 ? Math.round((displayTotals.card / displayTotals.gross) * 100) : 0;
            const cashPct = 100 - cardPct;

            const sortedFlavours = [...FLAVOURS].sort((a, b) => (displayFlavourCounts[b.id] || 0) - (displayFlavourCounts[a.id] || 0));
            const topFlavour = totalOrders > 0 ? sortedFlavours[0] : null;
            const topFlavourCount = topFlavour ? (displayFlavourCounts[topFlavour.id] || 0) : 0;
            const leastFlavour = totalOrders > 0 ? sortedFlavours[sortedFlavours.length - 1] : null;
            const leastFlavourCount = leastFlavour ? (displayFlavourCounts[leastFlavour.id] || 0) : 0;
            const activeFlavours = FLAVOURS.filter(f => (displayFlavourCounts[f.id] || 0) > 0).length;

            const sessionMins = (() => {
              if (displayOrders.length < 2) return null;
              const times = displayOrders.map(o => new Date(o.time).getTime());
              return Math.round((Math.max(...times) - Math.min(...times)) / 60000);
            })();
            const ordersPerHour = sessionMins > 0 ? ((totalOrders / sessionMins) * 60).toFixed(1) : null;
            const revenuePerHour = sessionMins > 0 ? Math.round((displayTotals.gross / sessionMins) * 60) : null;

            const deliveryRate = totalOrders > 0 ? Math.round((displayDeliveredOrders.length / totalOrders) * 100) : 0;
            const mgmtDateLabel = isViewingToday ? todayLabel
              : managementDateFrom === managementDateTo ? formatSessionDate(managementDateFrom)
              : `${formatSessionDate(managementDateFrom)} – ${formatSessionDate(managementDateTo)}`;

            // Status helpers
            const refillStatus = refillRate >= 40
              ? { label: "Strong", color: "#16a34a", bg: "#dcfce7", tip: "Customers are staying & coming back" }
              : refillRate >= 20
              ? { label: "Average", color: "#b45309", bg: "#fef9c3", tip: "Encourage more refills" }
              : { label: "Low", color: "#dc2626", bg: "#fee2e2", tip: "Promote refill packages" };

            const avgStatus = avgOrderValue >= prices.full * 0.9
              ? { label: "Strong", color: "#16a34a", bg: "#dcfce7", tip: "Mostly new pipes — great revenue" }
              : avgOrderValue >= (prices.full + prices.refill) / 2
              ? { label: "Moderate", color: "#b45309", bg: "#fef9c3", tip: "Balance of pipes & refills" }
              : { label: "Low", color: "#dc2626", bg: "#fee2e2", tip: "Mostly refills — push new pipes" };

            const paceStatus = ordersPerHour >= 10
              ? { label: "Busy", color: "#16a34a", bg: "#dcfce7" }
              : ordersPerHour >= 5
              ? { label: "Steady", color: "#b45309", bg: "#fef9c3" }
              : { label: "Slow", color: "#dc2626", bg: "#fee2e2" };

            return (
            <div key="management" className="tab-enter" style={styles.settingsPanel}>
              <div style={{ ...styles.settingsBar, justifyContent: "space-between", alignItems: "center" }}>
                <div style={styles.totalLeft}>
                  <span style={styles.totalLabel}>Management</span>
                  <span style={styles.totalSub}>
                    <span
                      onClick={() => { setManagementDateFrom(localToday()); setManagementDateTo(localToday()); setManagementTimeFrom("00:00"); setManagementTimeTo("23:59"); }}
                      style={{ cursor: "pointer", borderBottom: "1px dotted rgba(255,255,255,0.3)" }}
                    >{currentTime}</span>
                    {" · "}{mgmtDateLabel}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.1)", borderRadius: 12, padding: "8px 12px", flexShrink: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 8, fontWeight: 900, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.14em" }}>From</span>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }}>{formatDateShort(managementDateFrom)}</span>
                      <input type="date" value={managementDateFrom} max={managementDateTo}
                        onChange={e => { if (e.target.value) setManagementDateFrom(e.target.value); }}
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                      />
                    </div>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      {managementTimeFrom !== "00:00" && <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{managementTimeFrom}</span>}
                      <input type="time" value={managementTimeFrom}
                        onChange={e => { if (e.target.value) setManagementTimeFrom(e.target.value); }}
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", minWidth: 32, minHeight: 16, height: "100%" }}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 700 }}>→</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 8, fontWeight: 900, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.14em" }}>To</span>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }}>{formatDateShort(managementDateTo)}</span>
                      <input type="date" value={managementDateTo} min={managementDateFrom} max={todayStr}
                        onChange={e => { if (e.target.value) setManagementDateTo(e.target.value); }}
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                      />
                    </div>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      {managementTimeTo !== "23:59" && <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{managementTimeTo}</span>}
                      <input type="time" value={managementTimeTo}
                        onChange={e => { if (e.target.value) setManagementTimeTo(e.target.value); }}
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", minWidth: 32, minHeight: 16, height: "100%" }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {managementLoading && (
                <div style={{ textAlign: "center", padding: 16, fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>Loading…</div>
              )}

              {/* ── Always-visible order summary ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Revenue + orders row */}
                <div style={{ background: "rgba(15,23,42,0.88)", borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 900, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: 2 }}>Total Revenue</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.04em", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{formatCurrency(displayTotals.gross)}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{totalOrders} orders · {mgmtDateLabel}</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>💳 {formatCurrency(displayTotals.card)}</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>💵 {formatCurrency(displayTotals.cash)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 700 }}>🪄 {newPipeOrders.length} pipes</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 700 }}>🔄 {refillOrders.length} refills</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* ── KPIs ── */}
              <button onClick={() => setKpisCollapsed(c => !c)} style={styles.collapsibleHeader}>
                <span>📊 KPIs</span>
                <span style={styles.collapseChevron}>{kpisCollapsed ? "▶" : "▼"}</span>
              </button>

              {!kpisCollapsed && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                {/* ── Row: Avg Value + Refill Rate ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={styles.kpiCard}>
                    <span style={styles.kpiLabel}>Avg Order Value</span>
                    <span style={styles.kpiValue}>{totalOrders > 0 ? formatCurrency(Math.round(avgOrderValue)) : "—"}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: avgStatus.color, background: avgStatus.bg, padding: "2px 7px", borderRadius: 99, alignSelf: "flex-start", marginTop: 2 }}>{avgStatus.label}</span>
                    <span style={styles.kpiSub}>{avgStatus.tip}</span>
                  </div>
                  <div style={styles.kpiCard}>
                    <span style={styles.kpiLabel}>Refill Rate</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={styles.kpiValue}>{refillRate}%</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: "rgba(0,0,0,0.07)", overflow: "hidden", marginTop: 4 }}>
                      <div style={{ height: "100%", width: `${refillRate}%`, background: refillStatus.color, borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: refillStatus.color, background: refillStatus.bg, padding: "2px 7px", borderRadius: 99, alignSelf: "flex-start", marginTop: 4 }}>{refillStatus.label}</span>
                    <span style={styles.kpiSub}>{refillStatus.tip}</span>
                  </div>
                </div>

                {/* ── Row: Pace + Active ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={styles.kpiCard}>
                    <span style={styles.kpiLabel}>Session Pace</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={styles.kpiValue}>{ordersPerHour ?? "—"}</span>
                      {ordersPerHour && <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>/ hr</span>}
                    </div>
                    {ordersPerHour && <span style={{ fontSize: 10, fontWeight: 800, color: paceStatus.color, background: paceStatus.bg, padding: "2px 7px", borderRadius: 99, alignSelf: "flex-start", marginTop: 2 }}>{paceStatus.label}</span>}
                    <span style={styles.kpiSub}>{sessionMins ? `${sessionMins} min session · ${totalOrders} orders` : "Not enough data yet"}</span>
                  </div>
                  <div style={{ ...styles.kpiCard, background: displayCurrentOrders.length > 0 ? "rgba(22,163,74,0.08)" : undefined, border: displayCurrentOrders.length > 0 ? "1px solid rgba(22,163,74,0.25)" : undefined }}>
                    <span style={styles.kpiLabel}>{isViewingToday ? "Active Now" : "Active"}</span>
                    <span style={{ ...styles.kpiValue, color: displayCurrentOrders.length > 0 ? "#16a34a" : "#94a3b8" }}>{displayCurrentOrders.length}</span>
                    <span style={styles.kpiSub}>{deliveryRate}% delivered · {displayDeliveredOrders.length} done</span>
                  </div>
                </div>

                {/* ── Flavour performance (full width) ── */}
                <div style={styles.kpiCard}>
                  <span style={styles.kpiLabel}>Flavour Performance</span>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 4 }}>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>🏆 Best seller</span>
                      {topFlavour && topFlavourCount > 0 ? (
                        <div style={{ fontSize: 14, fontWeight: 900, color: topFlavour.color, marginTop: 2 }}>{topFlavour.icon} {topFlavour.name} · {topFlavourCount}×</div>
                      ) : <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>No orders yet</div>}
                    </div>
                    {leastFlavour && leastFlavourCount === 0 && totalOrders > 0 && (
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>💡 Push this</span>
                        <div style={{ fontSize: 14, fontWeight: 900, color: leastFlavour.color, marginTop: 2 }}>{leastFlavour.icon} {leastFlavour.name}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                    {sortedFlavours.map(f => {
                      const count = displayFlavourCounts[f.id] || 0;
                      const pct = totalOrders > 0 ? (count / totalOrders) * 100 : 0;
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11, width: 16 }}>{f.icon}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#334155", width: 72, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                          <div style={{ flex: 1, height: 6, borderRadius: 99, background: "rgba(0,0,0,0.06)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: f.color, borderRadius: 99, transition: "width 0.4s ease" }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 800, color: count > 0 ? f.color : "#cbd5e1", minWidth: 18, textAlign: "right" }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                  <span style={{ ...styles.kpiSub, marginTop: 6 }}>{activeFlavours} of {FLAVOURS.length} flavours ordered this session</span>
                </div>

                {/* ── Row: Expected Revenue + Hubbly Capacity ── */}
                {(() => {
                  const coalItem      = stock.find(i => i.name === "Coal");
                  const mouthItem     = stock.find(i => i.name === "Mouth Pieces");
                  const flavourItem   = stock.find(i => i.subItems);
                  const COAL_PER_ORDER = 2;
                  const capCoal  = coalItem  ? Math.floor(coalItem.quantity / COAL_PER_ORDER) : Infinity;
                  const capMouth = mouthItem ? Math.floor(mouthItem.quantity)                 : Infinity;
                  const capFlavour = flavourItem
                    ? Math.floor(flavourItem.subItems.reduce((sum, s) => sum + s.quantity / (FLAVOUR_PER_SALE[s.id] ?? (1/4)), 0))
                    : Infinity;
                  const remaining = Math.min(capCoal, capMouth, capFlavour === Infinity ? 0 : capFlavour);
                  const limitedBy = capCoal <= capMouth && capCoal <= capFlavour ? "coal"
                    : capMouth <= capCoal && capMouth <= capFlavour ? "mouth pieces" : "flavour";
                  const progressPct = avgDailyRevenue ? Math.min((displayTotals.gross / avgDailyRevenue) * 100, 100) : 0;
                  const onTrack = avgDailyRevenue && displayTotals.gross >= avgDailyRevenue * 0.75;
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={styles.kpiCard}>
                        <span style={styles.kpiLabel}>Expected Today</span>
                        <span style={styles.kpiValue}>{avgDailyRevenue ? formatCurrency(Math.round(avgDailyRevenue)) : "—"}</span>
                        {avgDailyRevenue ? <>
                          <div style={{ height: 4, borderRadius: 99, background: "rgba(0,0,0,0.07)", overflow: "hidden", marginTop: 6 }}>
                            <div style={{ height: "100%", width: `${progressPct}%`, background: onTrack ? "#16a34a" : "#f59e0b", borderRadius: 99, transition: "width 0.4s ease" }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 800, color: onTrack ? "#16a34a" : "#b45309", background: onTrack ? "rgba(22,163,74,0.08)" : "#fffbeb", padding: "2px 7px", borderRadius: 99, alignSelf: "flex-start", marginTop: 4 }}>{Math.round(progressPct)}% of avg</span>
                          <span style={styles.kpiSub}>Based on past session history</span>
                        </> : <span style={styles.kpiSub}>No history yet — run a few sessions first</span>}
                      </div>
                      <div style={styles.kpiCard}>
                        <span style={styles.kpiLabel}>Hubblys</span>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                          <span style={styles.kpiValue}>{totalOrders}</span>
                          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>served</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 18, fontWeight: 900, color: remaining > 10 ? "#16a34a" : remaining > 3 ? "#f59e0b" : "#dc2626", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{remaining}</span>
                          <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, lineHeight: 1.2 }}>left in<br/>stock</span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 800, color: remaining > 10 ? "#16a34a" : remaining > 3 ? "#b45309" : "#dc2626", background: remaining > 10 ? "rgba(22,163,74,0.08)" : remaining > 3 ? "#fffbeb" : "#fef2f2", padding: "2px 7px", borderRadius: 99, alignSelf: "flex-start", marginTop: 2 }}>
                          {remaining > 10 ? "Well stocked" : remaining > 3 ? `Low — restock soon` : remaining === 0 ? "Out of stock" : "Critical — restock now"}
                        </span>
                        <span style={styles.kpiSub}>Limited by {limitedBy}</span>
                      </div>
                    </div>
                  );
                })()}

              </div>}


              {/* ── Accounting ── */}
              <button onClick={() => setAccountingCollapsed(c => !c)} style={styles.collapsibleHeader}>
                <span>💰 Accounting</span>
                <span style={styles.collapseChevron}>{accountingCollapsed ? "▶" : "▼"}</span>
              </button>
              {!accountingCollapsed && (() => {
                // Single source of truth: mirrors stock tab order exactly
                const stockExpenseOptions = stock.flatMap(i => {
                  if (i.subItems) {
                    return i.subItems.map(s => {
                      const fl = FLAVOURS.find(f => f.id === s.id);
                      return { key: `Flavour-${s.id}`, label: fl?.name ?? s.name, icon: fl?.icon ?? "🌿", color: fl?.color ?? "#64748b", bg: fl?.bg ?? "#f8fafc", group: "flavour" };
                    });
                  }
                  return [{ key: i.name, label: i.name, icon: i.category === "equipment" ? "🛠️" : "📦", color: i.category === "equipment" ? "#334155" : "#0369a1", bg: i.category === "equipment" ? "#f1f5f9" : "#eff6ff", group: i.category }];
                });
                const EXTRA_EXPENSE_OPTS = {
                  Wages:     { icon: "👥", label: "Wages",     color: "#7c3aed", bg: "#f5f3ff" },
                  Transport: { icon: "🚗", label: "Transport", color: "#0f766e", bg: "#f0fdfa" },
                };
                const totalExpenses = displayExpenses.reduce((s, e) => s + e.amount, 0);
                const profit = displayTotals.gross - totalExpenses;
                const margin = displayTotals.gross > 0 ? Math.round((profit / displayTotals.gross) * 100) : 0;
                const profitColor = profit >= 0 ? "#16a34a" : "#dc2626";

                const buildAccountingReport = () => {
                  const lines = [`Accounting Report · ${mgmtDateLabel}`, ""];
                  lines.push(`REVENUE`);
                  lines.push(`  Card:  R${displayTotals.card}`);
                  lines.push(`  Cash:  R${displayTotals.cash}`);
                  lines.push(`  Total: R${displayTotals.gross}`);
                  lines.push("");
                  lines.push(`EXPENSES`);
                  displayExpenses.forEach(e => {
                    const opt = stockExpenseOptions.find(o => o.key === e.category) ?? EXTRA_EXPENSE_OPTS[e.category];
                    lines.push(`  ${opt?.icon ?? "📦"} ${opt?.label ?? e.category}${e.qty ? ` ×${e.qty}` : ""}: R${e.amount}`);
                  });
                  lines.push(`  Total: R${totalExpenses}`);
                  lines.push("");
                  lines.push(`NET ${profit >= 0 ? "PROFIT" : "LOSS"}: R${Math.abs(profit)} (${margin}% margin)`);
                  return lines.join("\n");
                };

                const commitExpense = () => {
                  const amt = Number(newExpenseAmt);
                  const qty = Number(newExpenseDesc) || 0;
                  if (amt <= 0) return;
                  setExpenses(prev => [...prev, { id: Date.now(), category: newExpenseCat, qty: qty || null, amount: amt, time: new Date().toISOString() }]);
                  if (qty > 0) {
                    const selectedOpt = stockExpenseOptions.find(o => o.key === newExpenseCat);
                    if (newExpenseCat.startsWith("Flavour-")) {
                      const subId = newExpenseCat.replace("Flavour-", "");
                      setStock(prev => prev.map(i => i.name === "Flavour" && i.subItems
                        ? { ...i, subItems: i.subItems.map(s => s.id === subId ? { ...s, quantity: s.quantity + qty } : s) }
                        : i
                      ));
                    } else if (selectedOpt?.group === "equipment") {
                      setStock(prev => prev.map(i => i.category === "equipment" && i.name === newExpenseCat
                        ? { ...i, quantity: i.quantity + qty }
                        : i
                      ));
                    } else {
                      const packDef = RESTOCK_PACK[newExpenseCat];
                      setStock(prev => prev.map(i => i.name === newExpenseCat
                        ? { ...i, quantity: i.quantity + (packDef ? qty * packDef.size : qty) }
                        : i
                      ));
                    }
                  }
                  setNewExpenseDesc(""); setNewExpenseAmt("");
                };

                return (
                  <>
                    <div style={styles.summaryDivider}>
                      <div style={styles.summaryDividerLine} />
                      <span style={styles.summaryDividerLabel}>Accounting</span>
                      <div style={styles.summaryDividerLine} />
                    </div>

                    {/* P&L Card */}
                    <div style={{ ...styles.kpiCard, gap: 0 }}>
                      <span style={styles.kpiLabel}>Profit & Loss</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>Revenue</span>
                          <span style={{ fontSize: 15, fontWeight: 900, color: "#16a34a" }}>+ {formatCurrency(displayTotals.gross)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>Expenses</span>
                          <span style={{ fontSize: 15, fontWeight: 900, color: "#dc2626" }}>− {formatCurrency(totalExpenses)}</span>
                        </div>
                        <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "4px 0" }} />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>Net {profit >= 0 ? "Profit" : "Loss"}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: profitColor, background: profit >= 0 ? "#dcfce7" : "#fee2e2", padding: "2px 8px", borderRadius: 99 }}>{margin}%</span>
                            <span style={{ fontSize: 18, fontWeight: 900, color: profitColor }}>{profit >= 0 ? "" : "−"}{formatCurrency(Math.abs(profit))}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expense entries */}
                    <button onClick={() => setExpensesCollapsed(c => !c)} style={{ ...styles.collapsibleHeader, marginTop: 4 }}>
                      <span>Expenses {displayExpenses.length > 0 ? `(${displayExpenses.length})` : ""}</span>
                      <span style={styles.collapseChevron}>{expensesCollapsed ? "▶" : "▼"}</span>
                    </button>
                    {!expensesCollapsed && displayExpenses.length > 0 && (() => {
                      const groups = [];
                      const seen = new Map();
                      [...displayExpenses].reverse().forEach(exp => {
                        const key = exp.category;
                        if (seen.has(key)) {
                          const g = seen.get(key);
                          g.totalQty = (g.totalQty || 0) + (exp.qty || 0);
                          g.totalAmount += exp.amount;
                          g.ids.push(exp.id);
                        } else {
                          const g = { key, category: exp.category, time: exp.time, totalQty: exp.qty || 0, totalAmount: exp.amount, ids: [exp.id] };
                          seen.set(key, g);
                          groups.push(g);
                        }
                      });
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>{groups.length} {groups.length === 1 ? "entry" : "entries"}</span>
                            <button onClick={() => { const ids = new Set(displayExpenses.map(e => e.id)); setExpenses(prev => prev.filter(e => !ids.has(e.id))); }} style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>Clear all</button>
                          </div>
                          {groups.map(g => {
                            const opt = stockExpenseOptions.find(o => o.key === g.category) ?? EXTRA_EXPENSE_OPTS[g.category] ?? { icon: "📦", label: g.category, color: "#64748b", bg: "#f8fafc" };
                            return (
                              <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.65)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.8)", borderRadius: 10, padding: "10px 12px" }}>
                                <span style={{ fontSize: 11, fontWeight: 800, color: opt.color, background: opt.bg, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>{opt.icon} {opt.label}</span>
                                {g.totalQty > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>×{g.totalQty}</span>}
                                <span style={{ fontSize: 13, fontWeight: 900, color: "#dc2626", marginLeft: "auto", whiteSpace: "nowrap" }}>−{formatCurrency(g.totalAmount)}</span>
                                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>{new Date(g.time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                                <button onClick={() => setExpenses(prev => prev.filter(e => !g.ids.includes(e.id)))} style={{ fontSize: 14, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Add expense */}
                    {!expensesCollapsed && (() => {
                      const isNonStock = ["Wages", "Transport"].includes(newExpenseCat);
                      const expPack = RESTOCK_PACK[newExpenseCat];
                      const expOpt = stockExpenseOptions.find(o => o.key === newExpenseCat) ?? EXTRA_EXPENSE_OPTS[newExpenseCat];
                      const qtyNum = Number(newExpenseDesc) || 0;
                      const qtyUnit = expPack ? expPack.plural : newExpenseCat.startsWith("Flavour-") ? "boxes" : "units";
                      const stockPreview = (() => {
                        if (isNonStock || !qtyNum) return null;
                        if (expPack) return `+${qtyNum * expPack.size} ${expPack.unit === "box" ? "pieces" : "pieces"} to stock`;
                        if (newExpenseCat.startsWith("Flavour-")) return `+${qtyNum} box${qtyNum !== 1 ? "es" : ""} to stock`;
                        return `+${qtyNum} ${qtyUnit} to stock`;
                      })();
                      return (
                        <div style={{ background: "rgba(255,255,255,0.65)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.85)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                          <select
                            value={newExpenseCat}
                            onChange={e => { setNewExpenseCat(e.target.value); setNewExpenseDesc(""); }}
                            style={{ ...styles.stockSelectInput, margin: 0 }}
                          >
                            <optgroup label="──────────">
                              <option value="Wages">👥 Wages</option>
                              <option value="Transport">🚗 Transport</option>
                            </optgroup>
                            <optgroup label="🔥 Consumables">
                              {stockExpenseOptions.filter(o => o.group === "consumable").map(o =>
                                <option key={o.key} value={o.key}>{o.icon} {o.label}</option>
                              )}
                            </optgroup>
                            <optgroup label="🌿 Flavour">
                              {stockExpenseOptions.filter(o => o.group === "flavour").map(o =>
                                <option key={o.key} value={o.key}>{o.icon} {o.label}</option>
                              )}
                            </optgroup>
                            <optgroup label="🛠️ Equipment">
                              {stockExpenseOptions.filter(o => o.group === "equipment").map(o =>
                                <option key={o.key} value={o.key}>{o.icon} {o.label}</option>
                              )}
                            </optgroup>
                          </select>

                          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                            {!isNonStock && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "capitalize" }}>{qtyUnit}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid rgba(203,213,225,0.6)", borderRadius: 8, overflow: "hidden", background: "#fff", minHeight: 44 }}>
                                  <button
                                    onClick={() => setNewExpenseDesc(v => String(Math.max(0, (Number(v) || 0) - 1)))}
                                    style={{ padding: "0 12px", height: 44, background: "none", border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b" }}
                                  >−</button>
                                  <input
                                    type="number"
                                    min="0"
                                    value={newExpenseDesc}
                                    onChange={e => setNewExpenseDesc(e.target.value)}
                                    style={{ width: 40, textAlign: "center", border: "none", outline: "none", fontSize: 15, fontWeight: 800, color: "#0f172a", background: "transparent", padding: 0, height: 44 }}
                                    placeholder="0"
                                  />
                                  <button
                                    onClick={() => setNewExpenseDesc(v => String((Number(v) || 0) + 1))}
                                    style={{ padding: "0 12px", height: 44, background: "none", border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#64748b" }}
                                  >+</button>
                                </div>
                              </div>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, maxWidth: 120 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>Cost (R)</span>
                              <input
                                type="number"
                                min="0"
                                placeholder="0"
                                value={newExpenseAmt}
                                onChange={e => setNewExpenseAmt(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") commitExpense(); }}
                                style={{ ...styles.userNameInput, margin: 0 }}
                              />
                            </div>
                            <button onClick={commitExpense} style={styles.addUserBtn}>Add</button>
                          </div>

                          {stockPreview && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}>✓ {stockPreview}</span>
                          )}
                        </div>
                      );
                    })()}

                    <button
                      onClick={async () => {
                        const text = buildAccountingReport();
                        if (navigator.share) { try { await navigator.share({ title: "Accounting Report", text }); return; } catch {} }
                        navigator.clipboard?.writeText(text);
                      }}
                      style={styles.copyBtn}
                    >
                      Share Accounting Report
                    </button>
                  </>
                );
              })()}
            </div>
            );

          })()}
          {visibleTab === "stock" && (() => {
            const consumables = stock.filter(i => i.category === "consumable");
            const equipment   = stock.filter(i => i.category === "equipment");

            // Flatten all trackable items (including flavour sub-items) for summary
            const allFlatItems = stock.flatMap(i => {
              if (i.subItems) return i.subItems.map(s => ({ ...s, lowThreshold: i.lowThreshold, unit: "boxes", parentName: i.name }));
              return [i];
            });
            const outItems = allFlatItems.filter(i => i.quantity === 0);
            const lowItems = allFlatItems.filter(i => i.quantity > 0 && i.quantity <= i.lowThreshold);
            const lowCount = outItems.length + lowItems.length;

            const buildStockReport = () => {
              const lines = [`Stock Report · ${todayLabel}`, ""];
              stock.forEach(item => {
                if (item.subItems) {
                  lines.push(`${item.name}:`);
                  item.subItems.forEach(s => {
                    const perSale = FLAVOUR_PER_SALE[s.id];
                    const denom = perSale ? Math.round((1 / perSale) * 10) / 10 : null;
                    const qty = Math.round(s.quantity * 1000) / 1000;
                    const whole = Math.floor(qty);
                    const openSales = denom ? Math.round((qty - whole) * denom * 10) / 10 : null;
                    const openLabel = openSales !== null && openSales > 0
                      ? ` + ${Number.isInteger(openSales) ? openSales : openSales.toFixed(1)}/${denom} open`
                      : "";
                    const flag = s.quantity === 0 ? " ❌ OUT" : s.quantity <= item.lowThreshold ? " ⚠ LOW" : "";
                    lines.push(`  ${s.icon} ${s.name}: ${whole > 0 ? `${whole} box${whole !== 1 ? "es" : ""}` : ""}${openLabel}${flag}`);
                  });
                } else {
                  const pack = RESTOCK_PACK[item.name];
                  const packInfo = pack ? ` (${Math.floor(item.quantity / pack.size)} ${pack.plural} + ${item.quantity % pack.size} pcs)` : "";
                  const flag = item.quantity === 0 ? " ❌ OUT" : item.quantity <= item.lowThreshold ? " ⚠ LOW" : "";
                  lines.push(`${item.name}: ${item.quantity} ${item.unit}${packInfo}${flag}`);
                }
              });
              return lines.join("\n");
            };

            const setSubQtyAbsolute = (stockId, subId, value) =>
              setStock(prev => prev.map(i => i.id === stockId
                ? { ...i, subItems: i.subItems.map(s => s.id === subId ? { ...s, quantity: Math.max(0, value) } : s) }
                : i));

            const toggleStockExpand = (id) => setExpandedStockIds(prev => {
              const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
            });


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
                          {anyOut && <span style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Out of stock</span>}
                          {anyLow && <span style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}>Low</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, marginRight: 4 }}>{isOpen ? "▲ Hide" : "▼ Show"}</span>
                    </div>
                    {isOpen && (
                      <div style={styles.subItemList}>
                        {item.subItems.map(f => {
                          const fOut = f.quantity === 0;
                          const fLow = !fOut && f.quantity <= item.lowThreshold;
                          return (
                            <div key={f.id} style={styles.subItemRow}>
                              <span style={{ ...styles.subItemTag, background: f.bg, color: f.color }}>{f.icon} {f.name}</span>
                              {fOut && <span style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: 9 }}>Out</span>}
                              {fLow && <span style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", fontSize: 9 }}>Low</span>}

                              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                                    {(() => {
                                      const perSale = FLAVOUR_PER_SALE[f.id];
                                      if (!perSale) return <span style={{ fontSize: 12, color: "#94a3b8" }}>{f.quantity.toFixed(2)} bx</span>;
                                      const denom = Math.round((1 / perSale) * 10) / 10;
                                      const qty = Math.round(f.quantity * 1000) / 1000;
                                      const wholeBoxes = Math.floor(qty);
                                      const fraction = qty - wholeBoxes;
                                      const servingsInOpen = Math.round(fraction * denom * 10) / 10;
                                      const openLabel = Number.isInteger(servingsInOpen) ? String(servingsInOpen) : servingsInOpen.toFixed(1);
                                      const isEditing = editSubId?.stockId === item.id && editSubId?.subId === f.id;
                                      if (qty === 0 && !isEditing) return (
                                        <span
                                          onClick={() => { setEditSubId({ stockId: item.id, subId: f.id }); setEditSubQty("0"); }}
                                          style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, cursor: "pointer" }}
                                        >–</span>
                                      );
                                      return <>
                                        {isEditing ? (
                                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                              <input
                                                type="number"
                                                autoFocus
                                                min="0"
                                                value={editSubQty}
                                                onChange={e => setEditSubQty(e.target.value)}
                                                onKeyDown={e => {
                                                  if (e.key === "Enter") {
                                                    const n = Number(editSubQty); const cost = Number(editSubCost);
                                                    if (n >= 0) { setSubQtyAbsolute(item.id, f.id, n + fraction);
                                                      if (cost > 0 && n > 0) setExpenses(prev => [...prev, { id: Date.now(), category: `Flavour-${f.id}`, qty: n, amount: cost, time: new Date().toISOString() }]);
                                                    }
                                                    setEditSubId(null); setEditSubQty(""); setEditSubCost("");
                                                  }
                                                  if (e.key === "Escape") { setEditSubId(null); setEditSubQty(""); setEditSubCost(""); }
                                                }}
                                                style={styles.restockInput}
                                                placeholder="boxes"
                                              />
                                              <input
                                                type="number"
                                                min="0"
                                                value={editSubCost}
                                                onChange={e => setEditSubCost(e.target.value)}
                                                style={{ ...styles.restockInput, width: 80 }}
                                                placeholder="R cost"
                                              />
                                              <button
                                                onClick={() => {
                                                  const n = Number(editSubQty); const cost = Number(editSubCost);
                                                  if (n >= 0) { setSubQtyAbsolute(item.id, f.id, n + fraction);
                                                    if (cost > 0 && n > 0) setExpenses(prev => [...prev, { id: Date.now(), category: `Flavour-${f.id}`, qty: n, amount: cost, time: new Date().toISOString() }]);
                                                  }
                                                  setEditSubId(null); setEditSubQty(""); setEditSubCost("");
                                                }}
                                                style={styles.restockConfirmBtn}
                                              >✓</button>
                                              <button onClick={() => { setEditSubId(null); setEditSubQty(""); setEditSubCost(""); }} style={styles.restockCancelBtn}>✕</button>
                                          </div>
                                        ) : (
                                          <span
                                            onClick={() => { setEditSubId({ stockId: item.id, subId: f.id }); setEditSubQty(String(wholeBoxes)); }}
                                            style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", background: "rgba(15,23,42,0.07)", padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap", cursor: "pointer" }}
                                            title="Tap to edit"
                                          >
                                            📦 {wholeBoxes} {wholeBoxes === 1 ? "box" : "boxes"}
                                          </span>
                                        )}
                                        {servingsInOpen > 0 && !isEditing && (
                                          <span style={{ fontSize: 11, fontWeight: 800, color: f.color, background: f.bg, padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                            {openLabel}/{denom} open
                                          </span>
                                        )}
                                      </>;
                                    })()}
                                  </div>
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
                      {isOut && <span style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Out of stock</span>}
                      {isLow && <span style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}>Low</span>}
                    </div>
                  </div>

                  {editStockId === item.id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <input
                          type="number"
                          autoFocus
                          min="0"
                          value={editStockQty}
                          onChange={e => setEditStockQty(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") document.getElementById(`cost-${item.id}`)?.focus();
                            if (e.key === "Escape") { setEditStockId(null); setEditStockQty(""); setEditStockCost(""); }
                          }}
                          style={styles.restockInput}
                          placeholder={pack ? pack.unit : "qty"}
                        />
                        <input
                          id={`cost-${item.id}`}
                          type="number"
                          min="0"
                          value={editStockCost}
                          onChange={e => setEditStockCost(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              const n = Number(editStockQty); const cost = Number(editStockCost);
                              if (n >= 0) {
                                setStock(prev => prev.map(i => i.id === item.id ? { ...i, quantity: pack ? i.quantity + n * pack.size : n } : i));
                                if (cost > 0 && n > 0) setExpenses(prev => [...prev, { id: Date.now(), category: item.name, qty: n, amount: cost, time: new Date().toISOString() }]);
                              }
                              setEditStockId(null); setEditStockQty(""); setEditStockCost("");
                            }
                            if (e.key === "Escape") { setEditStockId(null); setEditStockQty(""); setEditStockCost(""); }
                          }}
                          style={{ ...styles.restockInput, width: 80 }}
                          placeholder="R cost"
                        />
                        <button
                          onClick={() => {
                            const n = Number(editStockQty); const cost = Number(editStockCost);
                            if (n >= 0) {
                              setStock(prev => prev.map(i => i.id === item.id ? { ...i, quantity: pack ? i.quantity + n * pack.size : n } : i));
                              if (cost > 0 && n > 0) setExpenses(prev => [...prev, { id: Date.now(), category: item.name, qty: n, amount: cost, time: new Date().toISOString() }]);
                            }
                            setEditStockId(null); setEditStockQty(""); setEditStockCost("");
                          }}
                          style={styles.restockConfirmBtn}
                        >✓</button>
                        <button onClick={() => { setEditStockId(null); setEditStockQty(""); setEditStockCost(""); }} style={styles.restockCancelBtn}>✕</button>
                    </div>
                  ) : (
                    <span
                      onClick={() => { setEditStockId(item.id); setEditStockQty(""); setEditStockCost(""); }}
                      style={{ ...styles.stockQty, cursor: "pointer" }}
                    >
                      {item.quantity}
                    </span>
                  )}

                </div>
              );
            };

            return (
              <div key="stock" className="tab-enter" style={styles.stockPanel}>
                <div style={styles.settingsBar}>
                  <div style={styles.totalLeft}>
                    <span style={styles.totalLabel}>Stock</span>
                    <span style={styles.totalSub}>
                      {lowCount > 0 ? `⚠ ${lowCount} item${lowCount > 1 ? "s" : ""} need attention` : "All items stocked"} · {todayLabel}
                    </span>
                  </div>
                </div>

                {consumables.length > 0 && (
                  <>
                    <button onClick={() => setConsumablesCollapsed(c => !c)} style={styles.collapsibleHeader}>
                      <span>🔥 Consumables <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>({consumables.length})</span></span>
                      <span style={styles.collapseChevron}>{consumablesCollapsed ? "▶" : "▼"}</span>
                    </button>
                    {!consumablesCollapsed && <div style={styles.stockList}>{consumables.map(renderItem)}</div>}
                  </>
                )}

                {equipment.length > 0 && (
                  <>
                    <button onClick={() => setEquipmentCollapsed(c => !c)} style={styles.collapsibleHeader}>
                      <span>🛠️ Equipment <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>({equipment.length})</span></span>
                      <span style={styles.collapseChevron}>{equipmentCollapsed ? "▶" : "▼"}</span>
                    </button>
                    {!equipmentCollapsed && <div style={styles.stockList}>{equipment.map(renderItem)}</div>}
                  </>
                )}


                {/* ── Stock Summary ── */}
                <button onClick={() => setStockSummaryCollapsed(c => !c)} style={styles.collapsibleHeader}>
                  <span>📊 Summary</span>
                  <span style={styles.collapseChevron}>{stockSummaryCollapsed ? "▶" : "▼"}</span>
                </button>

                {!stockSummaryCollapsed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 2px" }}>

                    {(outItems.length > 0 || lowItems.length > 0) && (
                      <div style={{ background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.8)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Needs Attention</span>
                        {outItems.map(i => (
                          <div key={i.id ?? i.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{i.icon ? `${i.icon} ` : ""}{i.name}{i.parentName ? ` (${i.parentName})` : ""}</span>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 20 }}>Out of stock</span>
                          </div>
                        ))}
                        {lowItems.map(i => (
                          <div key={i.id ?? i.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{i.icon ? `${i.icon} ` : ""}{i.name}{i.parentName ? ` (${i.parentName})` : ""}</span>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", background: "#fffbeb", padding: "2px 8px", borderRadius: 20 }}>Low</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {outItems.length === 0 && lowItems.length === 0 && (
                      <div style={{ textAlign: "center", padding: "10px 0", fontSize: 13, fontWeight: 700, color: "#16a34a" }}>
                        ✓ All items are well stocked
                      </div>
                    )}

                    {(() => {
                      const stockExpenses = expenses.filter(e => !["Wages", "Transport"].includes(e.category));
                      if (!stockExpenses.length) return null;
                      const RESTOCK_OPT_MAP = Object.fromEntries(
                        stock.flatMap(i => i.subItems
                          ? i.subItems.map(s => { const fl = FLAVOURS.find(f => f.id === s.id); return [`Flavour-${s.id}`, { label: fl?.name ?? s.name, icon: fl?.icon ?? "🌿", color: fl?.color ?? "#64748b", bg: fl?.bg ?? "#f8fafc" }]; })
                          : [[i.name, { label: i.name, icon: i.category === "equipment" ? "🛠️" : "📦", color: i.category === "equipment" ? "#334155" : "#0369a1", bg: i.category === "equipment" ? "#f1f5f9" : "#eff6ff" }]]
                        )
                      );
                      return (
                        <div style={{ background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.8)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Restock History</span>
                          {[...stockExpenses].reverse().map(e => {
                            const opt = RESTOCK_OPT_MAP[e.category] ?? { label: e.category, icon: "📦", color: "#334155", bg: "#f1f5f9" };
                            const pack = RESTOCK_PACK[e.category];
                            return (
                              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 800, color: opt.color, background: opt.bg, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                  {opt.icon} {opt.label}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>
                                  +{e.qty ?? "?"} {pack ? pack.plural : "units"}{pack && e.qty ? ` (${e.qty * pack.size} pcs)` : ""}
                                </span>
                                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginLeft: "auto", whiteSpace: "nowrap" }}>
                                  {new Date(e.time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    <div style={{ position: "relative" }}>
                      <button
                        onClick={async () => {
                          const text = buildStockReport();
                          if (navigator.share) {
                            try { await navigator.share({ title: "Stock Report", text }); return; } catch {}
                          }
                          setShowShareMenu(s => !s);
                        }}
                        style={styles.copyBtn}
                      >
                        Share Stock Report
                      </button>
                      {showShareMenu && (
                        <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 12, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", overflow: "hidden", zIndex: 10 }}>
                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(buildStockReport())}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setShowShareMenu(false)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", textDecoration: "none", color: "#0f172a", fontWeight: 700, fontSize: 14, borderBottom: "1px solid rgba(0,0,0,0.06)" }}
                          >
                            <span style={{ fontSize: 20 }}>💬</span> WhatsApp
                          </a>
                          <a
                            href={`mailto:?subject=Stock Report · ${todayLabel}&body=${encodeURIComponent(buildStockReport())}`}
                            onClick={() => setShowShareMenu(false)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", textDecoration: "none", color: "#0f172a", fontWeight: 700, fontSize: 14, borderBottom: "1px solid rgba(0,0,0,0.06)" }}
                          >
                            <span style={{ fontSize: 20 }}>✉️</span> Email
                          </a>
                          <button
                            onClick={() => { navigator.clipboard?.writeText(buildStockReport()); setShowShareMenu(false); }}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", width: "100%", background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, color: "#0f172a", fontFamily: "inherit" }}
                          >
                            <span style={{ fontSize: 20 }}>📋</span> Copy to clipboard
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {visibleTab === "settings" && (
            <div key="settings" className="tab-enter" style={styles.settingsPanel}>
              <div style={styles.settingsBar}>
                <div style={styles.totalLeft}>
                  <span style={styles.totalLabel}>Settings</span>
                  <span style={styles.totalSub}>{currentTime} · {todayLabel}</span>
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
                <div style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.85)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>Add User</span>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && document.getElementById("new-user-pin")?.focus()}
                    style={{ ...styles.userNameInput, flex: "none", width: "100%" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value)}
                      style={{ ...styles.userRoleSelect, flex: 1 }}
                    >
                      <option value="Staff">Staff</option>
                      <option value="Manager">Manager</option>
                      <option value="Admin">Admin</option>
                    </select>
                    <input
                      id="new-user-pin"
                      type="password"
                      placeholder="Password"
                      value={newUserPin}
                      onChange={(e) => setNewUserPin(e.target.value)}
                      style={{ ...styles.userNameInput, flex: 1 }}
                    />
                    <button
                      onClick={async () => {
                        if (!newUserName.trim() || !newUserPin) return;
                        const hashedPin = await hashPin(newUserPin);
                        const defaultPerms = newUserRole === "Admin"
                          ? { delivered: true, stock: true, management: true, settings: true }
                          : newUserRole === "Manager"
                          ? { delivered: true, stock: true, management: true, settings: false }
                          : { delivered: true, stock: false, management: false, settings: false };
                        setUsers((prev) => [...prev, { id: Date.now(), name: newUserName.trim(), role: newUserRole, pin: hashedPin, permissions: defaultPerms }]);
                        setNewUserName("");
                        setNewUserPin("");
                        setNewUserRole("Staff");
                      }}
                      style={styles.addUserBtn}
                    >
                      Add
                    </button>
                  </div>
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
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#0f172a", borderRadius: 20, padding: "5px 5px", width: "100%", boxSizing: "border-box" }}>
          {[
            { key: "pos",        label: "POS",      badge: currentOrders.length,   access: true },
            { key: "delivered",  label: "Orders",   badge: deliveredOrders.length, access: canAccess("delivered") },
            { key: "stock",      label: "Stock",    badge: 0,                      access: canAccess("stock") },
            { key: "management", label: "Manage",   badge: 0,                      access: canAccess("management") },
            { key: "settings",   label: "Settings", badge: 0,                      access: canAccess("settings") },
          ].filter(t => t.access).map(t => {
            const active = visibleTab === t.key;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ ...styles.footerTab, background: active ? "#fff" : "transparent", borderRadius: 14, padding: "7px 10px", flex: active ? "1.6" : "1", transition: "all 0.2s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: active ? "#0f172a" : "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{t.label}</span>
                  {t.badge > 0 && (
                    <span style={{ minWidth: 16, height: 16, borderRadius: 999, background: active ? "#0f172a" : "rgba(255,255,255,0.15)", color: active ? "#fff" : "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{t.badge}</span>
                  )}
                </div>
              </button>
            );
          })}
          </div>
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
    minHeight: "100dvh",
    padding: 0,
    background: "transparent",
    color: "#111827",
  },
  appChrome: {
    maxWidth: 560,
    minHeight: "100dvh",
    margin: "0 auto",
    padding: "72px 12px 80px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "transparent",
  },
  topBar: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    background: "rgba(255,255,255,0.85)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderBottom: "1px solid rgba(255,255,255,0.9)",
    borderRadius: "0 0 14px 14px",
    boxShadow: "0 4px 24px rgba(15,23,42,0.08)",
  },
  mainContent: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 8,
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
    padding: 14,
    background: "rgba(255,255,255,0.65)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 14,
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
    border: "1px solid #0f172a",
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
    gap: 10,
    padding: 14,
    background: "rgba(255,255,255,0.55)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 14,
  },
  deliveredPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "rgba(255,255,255,0.55)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 14,
  },
  settingsPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "rgba(255,255,255,0.55)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 14,
  },
  totalBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "rgba(15,23,42,0.88)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 10,
  },
  deliveredBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "rgba(15,23,42,0.88)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 10,
  },
  settingsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "rgba(15,23,42,0.88)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 10,
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
    borderRadius: 12,
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
    border: "1px solid #0f172a",
    color: "#ffffff",
  },
  permissionPillAlwaysOn: {
    background: "rgba(15,23,42,0.08)",
    border: "1px solid rgba(15,23,42,0.15)",
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
    minHeight: 44,
    background: "none",
    border: "none",
    outline: "none",
    padding: "8px 4px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
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
    gap: 10,
    padding: 14,
    background: "rgba(255,255,255,0.55)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.8)",
    borderRadius: 14,
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
    padding: "12px 14px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
  },
  stockRowLow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    background: "rgba(255,251,235,0.88)",
    border: "1px solid rgba(253,230,138,0.7)",
    borderRadius: 10,
  },
  stockRowCritical: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    background: "rgba(254,242,242,0.88)",
    border: "1px solid rgba(254,202,202,0.7)",
    borderRadius: 10,
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
    width: 56,
    height: 32,
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    background: "#fff",
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    textAlign: "center",
    outline: "none",
    padding: "0 6px",
  },
  restockConfirmBtn: {
    height: 32,
    padding: "0 14px",
    border: "none",
    borderRadius: 8,
    background: "linear-gradient(135deg,#22c55e,#16a34a)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 4px rgba(22,163,74,0.3)",
    letterSpacing: "0.02em",
  },
  restockCancelBtn: {
    height: 32,
    padding: "0 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    background: "#f8fafc",
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
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
    padding: "12px 0",
    fontSize: 16,
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
    minHeight: 44,
    padding: "10px 12px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0f172a",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
  },
  userRoleSelect: {
    minHeight: 44,
    padding: "10px 12px",
    border: "1px solid rgba(203,213,225,0.6)",
    borderRadius: 8,
    background: "rgba(255,255,255,0.6)",
    color: "#0f172a",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
  },
  addUserBtn: {
    minHeight: 44,
    padding: "0 18px",
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
  kpiCard: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: "12px 14px",
    background: "rgba(255,255,255,0.7)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 12,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: 900,
    color: "#0f172a",
    lineHeight: 1.1,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  kpiSub: {
    fontSize: 10,
    fontWeight: 600,
    color: "#94a3b8",
    marginTop: 1,
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
    border: "1px solid #f59e0b",
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
    padding: "12px 12px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
    fontSize: 13,
  },
  deliveredRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 12px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 10,
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
    minWidth: 44,
    minHeight: 44,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    borderRadius: 8,
    color: "#e11d48",
    fontSize: 18,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  deliverBtn: {
    minHeight: 44,
    background: "#dcfce7",
    border: "1px solid #86efac",
    borderRadius: 8,
    color: "#166534",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
    padding: "0 12px",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
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
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    padding: "8px 12px",
    paddingBottom: "max(14px, env(safe-area-inset-bottom))",
    background: "transparent",
  },
  footerTab: {
    flex: 1,
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    touchAction: "manipulation",
  },
  footerTabActive: {},
  footerBadge: {},
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
