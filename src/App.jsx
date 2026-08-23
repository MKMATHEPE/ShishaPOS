import { useState, useCallback, useRef, useEffect } from "react";
import chillPipeLogo from "./assets/The_Chill_Pipe.png";
import { supabase } from "./supabase";
import { changeOwnPassword, getCurrentProfile, manageStaff, onAuthChange, signIn, signOut, signOutEverywhere } from "./auth";
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

function normalizeFlavour(f) {
  if (f && typeof f === 'object') return f;
  return FLAVOURS.find(fl => fl.name === f) ?? { id: 'unknown', name: f ?? 'Unknown', short: '?', icon: '🌿', bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' };
}

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

function dateInputValue(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
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

function TabIcon({ name, active }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: active ? "#ffffff" : "rgba(255,255,255,0.58)",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (name === "pos") return <svg {...common}><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /><path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H7" /></svg>;
  if (name === "orders") return <svg {...common}><path d="M9 5h6" /><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z" /><path d="M6 5h12a2 2 0 0 1 2 2v13H4V7a2 2 0 0 1 2-2Z" /><path d="M8 11h8M8 15h5" /></svg>;
  if (name === "stock") return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.4 7.7 7.6 4.4 7.6-4.4M12 12.1V21" /></svg>;
  return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 21v-2.2a6.5 6.5 0 0 1 13 0V21M4 21h16" /></svg>;
}

export default function App() {
  const [orders, setOrders] = useState([]);
  const [unreturnedPipes, setUnreturnedPipes] = useState([]);
  const [prices, setPrices] = useState(DEFAULT_PRICES);
  const [draftPrices, setDraftPrices] = useState({ full: String(DEFAULT_PRICES.full), refill: String(DEFAULT_PRICES.refill) });
  const [dbReady, setDbReady] = useState(false);
  const [avgDailyRevenue, setAvgDailyRevenue] = useState(null);
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newUserRole, setNewUserRole] = useState("Staff");
  const [newUserPin, setNewUserPin] = useState("");
  const [staffMessage, setStaffMessage] = useState("");
  const [staffMessageType, setStaffMessageType] = useState("error");
  const [addingUser, setAddingUser] = useState(false);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [settingsSection, setSettingsSection] = useState("overview");
  const [ordersView, setOrdersView] = useState("Preparing");
  const [stockSearch, setStockSearch] = useState("");
  const [stockCategory, setStockCategory] = useState("All");
  const [editingEquipmentId, setEditingEquipmentId] = useState(null);
  const [equipmentDraft, setEquipmentDraft] = useState({ name: "", quantity: "", lowThreshold: "" });
  const [teamSearch, setTeamSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("All");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [securityMessage, setSecurityMessage] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [resetPinId, setResetPinId] = useState(null);
  const [resetPinValue, setResetPinValue] = useState("");
  const [expandedUsers, setExpandedUsers] = useState(new Set());
  const toggleUserExpanded = (id) => setExpandedUsers(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
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
    return defaults;
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
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [newExpenseCat, setNewExpenseCat] = useState("Coal");
  const [newExpenseDesc, setNewExpenseDesc] = useState("");
  const [newExpenseAmt, setNewExpenseAmt] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => formatTime(new Date()));
  const [currentMinute, setCurrentMinute] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setCurrentTime(formatTime(now));
      setCurrentMinute(now.getTime());
    }, 60000);
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

  useEffect(() => {
    let alive = true;
    const refreshAuth = async () => {
      try {
        const profile = await getCurrentProfile();
        if (alive) { setActiveUser(profile); setLoginError(""); }
      } catch (error) {
        if (alive) { setActiveUser(null); setLoginError(error.message); }
      } finally {
        if (alive) setAuthLoading(false);
      }
    };
    refreshAuth();
    const subscription = onAuthChange(refreshAuth);
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  // ── Load business data only after a verified session exists ──
  useEffect(() => {
    if (!activeUser || !supabase) return;
    async function load() {
      const [remoteUsers, remoteStock, remoteOrders, remoteExpenses, histRevenue, remoteUnreturned] = await Promise.all([
        fetchUsers(), fetchStock(), fetchOrders(), fetchExpenses(), fetchHistoricalRevenue(), fetchUnreturnedPipes(),
      ]);
      if (histRevenue !== null) setAvgDailyRevenue(histRevenue);
      if (remoteUsers && remoteUsers.length > 0) {
        setUsers(remoteUsers);
      }
      if (remoteStock && remoteStock.length > 0) setStock(remoteStock);
      if (remoteOrders && remoteOrders.length > 0)  { setOrders(remoteOrders.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) }))); }
      if (remoteUnreturned) setUnreturnedPipes(remoteUnreturned.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })));
      if (remoteExpenses && remoteExpenses.length > 0) setExpenses(remoteExpenses);
      setDbReady(true);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser?.id]);

  // ── Sync authenticated changes to Supabase ──
  useEffect(() => {
    if (dbReady) syncUsers(users);
  }, [users]); // eslint-disable-line

  useEffect(() => {
    if (dbReady) syncStock(stock);
  }, [stock]); // eslint-disable-line

  useEffect(() => {
    if (dbReady) syncExpenses(expenses);
  }, [expenses]); // eslint-disable-line

  // Re-fetch from Supabase whenever the user switches tabs
  useEffect(() => {
    if (!dbReady || !supabase) return;
    async function refresh() {
      const [remoteOrders, remoteStock, remoteExpenses, remoteUnreturned] = await Promise.all([
        fetchOrders(), fetchStock(), fetchExpenses(), fetchUnreturnedPipes(),
      ]);
      if (remoteOrders) setOrders(remoteOrders.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })));
      if (remoteUnreturned) setUnreturnedPipes(remoteUnreturned.map(o => ({ ...o, flavour: normalizeFlavour(o.flavour) })));
      if (remoteStock && remoteStock.length > 0) {
        setStock(remoteStock);
      }
      if (remoteExpenses) {
        setExpenses(remoteExpenses);
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
      return; // today is filtered client-side from live orders
    }
    if (!supabase) return;
    const loadingTimer = setTimeout(() => setManagementLoading(true), 0);
    const from = new Date(`${managementDateFrom}T${managementTimeFrom}:00`).toISOString();
    const to   = new Date(`${managementDateTo}T${managementTimeTo}:59`).toISOString();
    fetchOrdersByDateRange(from, to).then(o => {
      setManagementOrders((o ?? []).map(ord => ({ ...ord, flavour: normalizeFlavour(ord.flavour) })));
      setManagementLoading(false);
    });
    return () => clearTimeout(loadingTimer);
  }, [managementDateFrom, managementDateTo, managementTimeFrom, managementTimeTo]);

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
  }, [selectedFlavour, orderType, payMethod, prices, hookahPipeQty, rotasQty, rotaTopsQty, kopsQty, activeUser?.name]);

  const updatePrice = useCallback((type, value) => {
    const nextPrice = Number(value);
    setPrices((prev) => ({
      ...prev,
      [type]: Number.isFinite(nextPrice) && nextPrice >= 0 ? nextPrice : 0,
    }));
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      setLoginError("");
      await signIn(loginUsername, loginPassword);
      setLoginUsername("");
      setLoginPassword("");
    } catch {
      setLoginError("Invalid username or password.");
      setLoginPassword("");
    }
  }, [loginUsername, loginPassword]);

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
  const queueOrders = ordersView === "Preparing"
    ? currentOrders
    : ordersView === "Return Pipes"
      ? [...unreturnedPipes, ...deliveredOrders.filter((o) => o.type === "full" && !o.pipeReturned)]
      : deliveredOrders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const isAdmin = activeUser?.role === "Admin";
  const usernameIsValid = /^[a-z0-9._-]{3,32}$/.test(newUsername);
  const passwordIsValid = newUserPin.length >= 10;
  const addUserFormIsValid = newUserName.trim().length >= 2 && usernameIsValid && passwordIsValid;
  const visibleUsers = users.filter((user) => {
    const matchesSearch = !teamSearch.trim() || `${user.name} ${user.username ?? ""}`.toLowerCase().includes(teamSearch.trim().toLowerCase());
    const matchesFilter = teamFilter === "All" || (teamFilter === "Suspended" ? user.paused : user.role === teamFilter && !user.paused);
    return matchesSearch && matchesFilter;
  });
  const currentUserPerms = users.find((u) => u.id === activeUser?.id)?.permissions ?? {};
  const canAccess = (tab) => {
    if (!activeUser) return false;
    if (tab === "pos") return true;
    if (isAdmin) return true;
    return currentUserPerms[tab] ?? false;
  };
  const visibleTab = canAccess(activeTab) ? activeTab : "pos";
  const screenTitle = visibleTab === "pos" ? "The Chill Pipe POS"
    : visibleTab === "delivered" ? "Orders"
      : visibleTab === "management" ? "Management"
        : visibleTab.charAt(0).toUpperCase() + visibleTab.slice(1);

  return (
    <div style={styles.container}>
      <div style={styles.appChrome}>
        {authLoading ? (
          <div style={styles.loginScreen}><div style={styles.loginCard}>Checking secure session…</div></div>
        ) : !activeUser ? (
          <div style={styles.loginScreen}>
            <div className="float-1" style={styles.loginOrb1} />
            <div className="float-2" style={styles.loginOrb2} />
            <div className="float-3" style={styles.loginOrb3} />

            <div className="pop-enter" style={styles.loginCard}>
              <div style={styles.loginLogoWrap}>
                <img src={LOGO_SRC} alt="The Chill Pipe logo" style={styles.loginLogo} />
              </div>

              <div style={styles.loginBrandTag}>The Chill Pipe · POS</div>
              <h1 style={styles.loginAppName}>Welcome back</h1>
              <p style={styles.loginMeta}>Sign in to start your shift.</p>

              <div style={styles.loginField}>
                <label style={styles.loginLabel}>Username or email</label>
                <input
                  value={loginUsername}
                  onChange={(e) => { setLoginUsername(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  autoComplete="username"
                  placeholder="Enter your username"
                  style={styles.loginInput}
                />
              </div>

              <div style={styles.loginField}>
                <label style={styles.loginLabel}>Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
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
          <div style={{ width: 38 }} />
          <h1 style={styles.screenTitle}>{screenTitle}</h1>
          {confirmLogout ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.85)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Switch user?</span>
              <button
                onClick={async () => { await signOut(); setActiveUser(null); setUsers([]); setDbReady(false); setConfirmLogout(false); }}
                style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#0f172a", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >Yes</button>
              <button
                onClick={() => setConfirmLogout(false)}
                style={{ fontSize: 12, fontWeight: 800, color: "#64748b", background: "rgba(0,0,0,0.06)", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >No</button>
            </div>
          ) : (
            <button
              aria-label={visibleTab === "management" ? "Open settings" : "Switch user"}
              onClick={() => visibleTab === "management" ? setActiveTab("settings") : visibleTab === "settings" ? setActiveTab("management") : setConfirmLogout(true)}
              style={styles.headerIconBtn}
            >
              {visibleTab === "management" ? "⚙" : visibleTab === "settings" ? "←" : activeUser.name.charAt(0).toUpperCase()}
            </button>
          )}
        </div>

        <main style={styles.mainContent}>
          {visibleTab === "pos" && (
            <div key="pos" className="tab-enter">
        <div style={styles.availabilityCard}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 800, color: "#64748b" }}>Available pipes</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}><strong style={{ fontSize: 26, color: hookahPipeQty <= 2 ? "#dc2626" : "#0f172a" }}>{hookahPipeQty}</strong><span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>of {hookahPipeQty + pipesOut}</span></div>
          <div style={{ height: 5, borderRadius: 99, background: "#e2e8f0", overflow: "hidden", marginTop: 6 }}><div style={{ width: `${hookahPipeQty + pipesOut ? (hookahPipeQty / (hookahPipeQty + pipesOut)) * 100 : 0}%`, height: "100%", borderRadius: 99, background: "#22c55e" }} /></div>
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
            {FLAVOURS.map((f, fi) => (
              <button
                key={f.id}
                onClick={() => setSelectedFlavour(f)}
                className={`flavour-pop d-${fi}`}
                style={{
                  ...styles.flavourBtn,
                  background: flash === f.id ? f.color : selectedFlavour?.id === f.id ? f.color : f.bg,
                  color: flash === f.id ? "#fff" : selectedFlavour?.id === f.id ? "#fff" : "#111827",
                  border: `1px solid ${selectedFlavour?.id === f.id ? f.color : f.border}`,
                  transform: selectedFlavour?.id === f.id ? "translateY(-3px) scale(1.03)" : "translateY(0)",
                  boxShadow: selectedFlavour?.id === f.id ? `0 6px 18px ${f.color}44` : undefined,
                  transition: "all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                <span style={styles.flavourIcon}>{f.icon}</span>
                <span style={styles.flavourName}>{f.name}</span>
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
                className={!blocked ? "glow-active" : ""}
                style={{ ...styles.confirmBtn, ...(blocked ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}
              >
                <span>{blocked
                  ? `No ${blockedItem} available · ${selectedFlavour.name}`
                  : `Confirm order · ${selectedFlavour.name}`
                }</span>
                {!blocked && <strong>{formatCurrency(prices[orderType])} ›</strong>}
              </button>
            );
          })()}

          {undoTarget && (
            <div className="slide-up" style={styles.undoBar}>
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

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: 6, borderRadius: 13, background: "rgba(255,255,255,0.62)" }}>
                {[{ label: "Preparing", count: currentOrders.length }, { label: "Delivered", count: deliveredOrders.length }, { label: "Return Pipes", count: pipesOut }].map((tab) => (
                  <button key={tab.label} onClick={() => setOrdersView(tab.label)} style={{ border: 0, borderRadius: 10, padding: "9px 5px", background: ordersView === tab.label ? "#0f172a" : "transparent", color: ordersView === tab.label ? "#fff" : "#64748b", fontWeight: 800, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                    {tab.label} <span style={{ opacity: 0.7 }}>{tab.count}</span>
                  </button>
                ))}
              </div>

              <div style={styles.deliveredList}>
                {queueOrders.length === 0 && <div style={styles.emptyState}>Nothing in {ordersView.toLowerCase()}</div>}
                {queueOrders.map((o, i) => {
                  const orderedAt = o.time instanceof Date ? o.time : new Date(o.time);
                  const elapsed = Math.max(0, Math.floor((currentMinute - orderedAt.getTime()) / 60000));
                  const overdue = ordersView === "Preparing" && elapsed >= 12;
                  return (
                    <div key={`${o.id}-${ordersView}`} className="card-enter" style={{ ...styles.deliveredRow, animationDelay: `${i * 0.04}s`, border: overdue ? "1px solid #f59e0b" : undefined, background: overdue ? "#fffbeb" : undefined }}>
                      <span style={styles.orderIndex}>#{String(o.id).slice(-4)}</span>
                      <span style={{ ...styles.tag, background: o.flavour.bg, color: o.flavour.color }}>{o.flavour.icon} {o.flavour.short}</span>
                      <span style={styles.orderMeta}><strong>{o.flavour.name}</strong><small>{o.type === "refill" ? "Refill" : "New Pipe"} · {o.payment === "card" ? "Card" : "Cash"} · {o.soldBy ?? "Unknown"}</small></span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: overdue ? "#b45309" : "#64748b" }}>{ordersView === "Preparing" ? `${elapsed}m` : formatTime(o.deliveredAt ?? orderedAt)}</span>
                      {ordersView === "Preparing" ? <button onClick={() => markDelivered(o)} style={{ ...styles.deliverBtn, flexBasis: "100%" }}>{overdue ? "✓ Mark ready (overdue)" : "✓ Mark ready"}</button> : o.type === "full" && !o.pipeReturned ? <button onClick={() => returnPipe(o.id)} style={{ ...styles.deliverBtn, flexBasis: "100%", background: "#fff7ed", borderColor: "#fed7aa", color: "#c2410c" }}>Return pipe</button> : <span style={{ marginLeft: "auto", fontSize: 10, color: "#16a34a", fontWeight: 800 }}>✓ Complete</span>}
                    </div>
                  );
                })}
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
            const displayExpenseTotal = displayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
            const displayNetProfit = displayTotals.gross - displayExpenseTotal;
            const staffPerformance = Object.entries(displayOrders.reduce((staff, order) => {
              const name = order.soldBy || "Unknown";
              staff[name] = staff[name] || { orders: 0, revenue: 0 };
              staff[name].orders += 1;
              staff[name].revenue += order.price;
              return staff;
            }, {})).sort(([, a], [, b]) => b.revenue - a.revenue);
            const hourlySales = Array.from({ length: 12 }, (_, index) => {
              const hour = index + 10;
              return {
                hour,
                total: displayOrders.reduce((sum, order) => {
                  const orderTime = order.time instanceof Date ? order.time : new Date(order.time);
                  return orderTime.getHours() === hour ? sum + order.price : sum;
                }, 0),
              };
            });
            const hourlyMax = Math.max(1, ...hourlySales.map((item) => item.total));

            const newPipeOrders = displayOrders.filter((o) => o.type === "full");
            const refillOrders  = displayOrders.filter((o) => o.type === "refill");

            // KPIs
            const totalOrders = displayOrders.length;
            const avgOrderValue = totalOrders > 0 ? displayTotals.gross / totalOrders : 0;
            const refillRate = totalOrders > 0 ? Math.round((refillOrders.length / totalOrders) * 100) : 0;

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

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {["Today", "Yesterday", "7 Days", "Month"].map((preset) => (
                  <button key={preset} onClick={() => {
                    const end = new Date();
                    const start = new Date();
                    if (preset === "Yesterday") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
                    if (preset === "7 Days") start.setDate(start.getDate() - 6);
                    if (preset === "Month") start.setDate(1);
                    setManagementDateFrom(dateInputValue(start)); setManagementDateTo(dateInputValue(end)); setManagementTimeFrom("00:00"); setManagementTimeTo("23:59");
                  }} style={{ border: "1px solid rgba(15,23,42,0.08)", background: (preset === "Today" && isViewingToday) ? "#0f172a" : "rgba(255,255,255,0.7)", color: (preset === "Today" && isViewingToday) ? "#fff" : "#475569", borderRadius: 10, padding: "9px 4px", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{preset}</button>
                ))}
              </div>

              {managementLoading && (
                <div style={{ textAlign: "center", padding: 16, fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>Loading…</div>
              )}

              {/* ── Always-visible order summary ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Revenue + orders row */}
                <div className="pop-enter" style={{ background: "rgba(15,23,42,0.88)", borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {[
                    { label: "Net profit", value: formatCurrency(displayNetProfit), note: `${formatCurrency(displayExpenseTotal)} expenses`, color: displayNetProfit >= 0 ? "#16a34a" : "#dc2626" },
                    { label: "Top flavour", value: topFlavour ? `${topFlavour.icon} ${topFlavour.short}` : "—", note: `${topFlavourCount} orders`, color: topFlavour?.color || "#0f172a" },
                  ].map((metric) => (
                    <div key={metric.label} style={{ ...styles.kpiCard, minHeight: 92 }}>
                      <span style={styles.kpiLabel}>{metric.label}</span>
                      <span style={{ ...styles.kpiValue, color: metric.color }}>{metric.value}</span>
                      <span style={styles.kpiSub}>{metric.note}</span>
                    </div>
                  ))}
                </div>

                <div style={{ ...styles.kpiCard, minHeight: 150 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={styles.kpiLabel}>Sales by hour</span>
                    <span style={{ fontSize: 9, color: "#64748b", fontWeight: 800 }}>Rands (R)</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 88, paddingTop: 10, borderBottom: "1px solid #cbd5e1" }}>
                    {hourlySales.map((item) => (
                      <div key={item.hour} title={`${item.hour}:00 · ${formatCurrency(item.total)}`} style={{ flex: 1, height: `${Math.max(4, (item.total / hourlyMax) * 100)}%`, minWidth: 3, borderRadius: "3px 3px 0 0", background: item.total ? "#60a5fa" : "#e2e8f0" }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 8, fontWeight: 700 }}><span>10</span><span>12</span><span>14</span><span>16</span><span>18</span><span>20</span></div>
                </div>

                <div style={{ ...styles.kpiCard, gap: 8 }}>
                  <span style={styles.kpiLabel}>Staff performance</span>
                  {staffPerformance.length === 0 && <span style={styles.kpiSub}>No orders in this period</span>}
                  {staffPerformance.slice(0, 4).map(([name, result], index) => (
                    <div key={name} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", alignItems: "center", gap: 8, paddingTop: index ? 8 : 2, borderTop: index ? "1px solid rgba(15,23,42,0.07)" : 0 }}>
                      <span style={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 99, background: index === 0 ? "#fef3c7" : "#f1f5f9", color: index === 0 ? "#b45309" : "#64748b", fontSize: 10, fontWeight: 900 }}>{index + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>{name}<small style={{ display: "block", fontSize: 9, fontWeight: 700, color: "#94a3b8" }}>{result.orders} order{result.orders === 1 ? "" : "s"}</small></span>
                      <strong style={{ fontSize: 12, color: "#0f172a" }}>{formatCurrency(result.revenue)}</strong>
                    </div>
                  ))}
                </div>

              </div>

              {/* ── KPIs ── */}
              <button onClick={() => setKpisCollapsed(c => !c)} style={styles.collapsibleHeader}>
                <span>📊 KPIs</span>
                <span style={styles.collapseChevron}>{kpisCollapsed ? "▶" : "▼"}</span>
              </button>

              {!kpisCollapsed && <div className="expand-down" style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                {/* ── Row: Avg Value + Refill Rate ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div className="card-enter d-0" style={styles.kpiCard}>
                    <span style={styles.kpiLabel}>Avg Order Value</span>
                    <span style={styles.kpiValue}>{totalOrders > 0 ? formatCurrency(Math.round(avgOrderValue)) : "—"}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: avgStatus.color, background: avgStatus.bg, padding: "2px 7px", borderRadius: 99, alignSelf: "flex-start", marginTop: 2 }}>{avgStatus.label}</span>
                    <span style={styles.kpiSub}>{avgStatus.tip}</span>
                  </div>
                  <div className="card-enter d-1" style={styles.kpiCard}>
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
                  <div className="card-enter d-2" style={styles.kpiCard}>
                    <span style={styles.kpiLabel}>Session Pace</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={styles.kpiValue}>{ordersPerHour ?? "—"}</span>
                      {ordersPerHour && <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>/ hr</span>}
                    </div>
                    {ordersPerHour && <span style={{ fontSize: 10, fontWeight: 800, color: paceStatus.color, background: paceStatus.bg, padding: "2px 7px", borderRadius: 99, alignSelf: "flex-start", marginTop: 2 }}>{paceStatus.label}</span>}
                    <span style={styles.kpiSub}>{sessionMins ? `${sessionMins} min session · ${totalOrders} orders` : "Not enough data yet"}</span>
                  </div>
                  <div className="card-enter d-3" style={{ ...styles.kpiCard, background: displayCurrentOrders.length > 0 ? "rgba(22,163,74,0.08)" : undefined, border: displayCurrentOrders.length > 0 ? "1px solid rgba(22,163,74,0.25)" : undefined }}>
                    <span style={styles.kpiLabel}>{isViewingToday ? "Active Now" : "Active"}</span>
                    <span style={{ ...styles.kpiValue, color: displayCurrentOrders.length > 0 ? "#16a34a" : "#94a3b8" }}>{displayCurrentOrders.length}</span>
                    <span style={styles.kpiSub}>{deliveryRate}% delivered · {displayDeliveredOrders.length} done</span>
                  </div>
                </div>

                {/* ── Flavour performance (full width) ── */}
                <div className="card-enter d-4" style={styles.kpiCard}>
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

                const buildOrdersReport = () => {
                  const lines = [`Orders Report · ${mgmtDateLabel}`, ""];
                  lines.push(`SUMMARY`);
                  lines.push(`  Orders:  ${totalOrders} (${newPipeOrders.length} new pipe · ${refillOrders.length} refill)`);
                  lines.push(`  Revenue: R${displayTotals.gross} (💳 R${displayTotals.card} · 💵 R${displayTotals.cash})`);
                  lines.push("");
                  lines.push(`FLAVOURS`);
                  [...FLAVOURS]
                    .filter(f => (displayFlavourCounts[f.id] || 0) > 0)
                    .sort((a, b) => (displayFlavourCounts[b.id] || 0) - (displayFlavourCounts[a.id] || 0))
                    .forEach(f => lines.push(`  ${f.icon} ${f.name}: ${displayFlavourCounts[f.id]}`));
                  lines.push("");
                  lines.push(`ORDERS (${totalOrders})`);
                  displayOrders.forEach((o, i) => {
                    const fl = normalizeFlavour(o.flavour);
                    const time = formatTime(new Date(o.time));
                    const type = o.type === "full" ? "New Pipe" : "Refill";
                    const pay = o.payment === "card" ? "💳" : "💵";
                    const status = o.status === "delivered" ? "✓" : "·";
                    lines.push(`  ${i + 1}. ${time} ${status} ${fl.icon} ${fl.name} — ${type} ${pay} R${o.price}${o.soldBy ? ` (${o.soldBy})` : ""}`);
                  });
                  return lines.join("\n");
                };

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
                  <div className="expand-down">
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
                        <div className="expand-down" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>{groups.length} {groups.length === 1 ? "entry" : "entries"}</span>
                            <button onClick={() => { const ids = new Set(displayExpenses.map(e => e.id)); setExpenses(prev => prev.filter(e => !ids.has(e.id))); }} style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>Clear all</button>
                          </div>
                          {groups.map((g, gi) => {
                            const opt = stockExpenseOptions.find(o => o.key === g.category) ?? EXTRA_EXPENSE_OPTS[g.category] ?? { icon: "📦", label: g.category, color: "#64748b", bg: "#f8fafc" };
                            return (
                              <div key={g.key} className={`card-enter d-${Math.min(gi, 6)}`} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.65)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.8)", borderRadius: 10, padding: "10px 12px" }}>
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
                      const qtyNum = Number(newExpenseDesc) || 0;
                      const qtyUnit = expPack ? expPack.plural : newExpenseCat.startsWith("Flavour-") ? "boxes" : "units";
                      const stockPreview = (() => {
                        if (isNonStock || !qtyNum) return null;
                        if (expPack) return `+${qtyNum * expPack.size} ${expPack.unit === "box" ? "pieces" : "pieces"} to stock`;
                        if (newExpenseCat.startsWith("Flavour-")) return `+${qtyNum} box${qtyNum !== 1 ? "es" : ""} to stock`;
                        return `+${qtyNum} ${qtyUnit} to stock`;
                      })();
                      return (
                        <div className="expand-down" style={{ background: "rgba(255,255,255,0.65)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.85)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
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

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={async () => {
                          const text = buildOrdersReport();
                          if (navigator.share) { try { await navigator.share({ title: "Orders Report", text }); return; } catch { navigator.clipboard?.writeText(text); } } else { navigator.clipboard?.writeText(text); }
                        }}
                        style={{ ...styles.copyBtn, flex: 1 }}
                      >
                        Share Orders
                      </button>
                      <button
                        onClick={async () => {
                          const text = buildAccountingReport();
                          if (navigator.share) { try { await navigator.share({ title: "Accounting Report", text }); return; } catch { navigator.clipboard?.writeText(text); } } else { navigator.clipboard?.writeText(text); }
                        }}
                        style={{ ...styles.copyBtn, flex: 1 }}
                      >
                        Share P&L
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
            );

          })()}
          {visibleTab === "stock" && (() => {
            const matchesStockSearch = (item) => !stockSearch.trim() || item.name.toLowerCase().includes(stockSearch.toLowerCase()) || item.subItems?.some((sub) => sub.name.toLowerCase().includes(stockSearch.toLowerCase()));
            const categoryMatches = (item) => stockCategory === "All" || (stockCategory === "Equipment" ? item.category === "equipment" : stockCategory === "Flavours" ? item.name === "Flavour" : item.category === "consumable" && item.name !== "Flavour");
            const consumables = stock.filter(i => i.category === "consumable" && matchesStockSearch(i) && categoryMatches(i));
            const equipment   = stock.filter(i => i.category === "equipment" && matchesStockSearch(i) && categoryMatches(i));

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
                          {anyOut && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Out of stock</span>}
                          {anyLow && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}>Low</span>}
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
                              {fOut && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: 9 }}>Out</span>}
                              {fLow && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", fontSize: 9 }}>Low</span>}

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
                                      if (qty === 0) return (
                                        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>–</span>
                                      );
                                      return <>
                                        <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", background: "rgba(15,23,42,0.07)", padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                          📦 {wholeBoxes} {wholeBoxes === 1 ? "box" : "boxes"}
                                        </span>
                                        {servingsInOpen > 0 && (
                                          <span style={{ fontSize: 11, fontWeight: 800, color: f.color, background: f.bg, padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                            {openLabel} orders left
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

              if (item.category === "equipment" && editingEquipmentId === item.id) {
                const saveEquipment = () => {
                  const name = equipmentDraft.name.trim();
                  const quantity = Math.max(0, Number(equipmentDraft.quantity));
                  const lowThreshold = Math.max(0, Number(equipmentDraft.lowThreshold));
                  if (!name || !Number.isFinite(quantity) || !Number.isFinite(lowThreshold)) return;
                  setStock(prev => prev.map(stockItem => stockItem.id === item.id
                    ? { ...stockItem, name, quantity, lowThreshold }
                    : stockItem
                  ));
                  setEditingEquipmentId(null);
                };

                return (
                  <div key={item.id} style={{ ...rowStyle, alignItems: "stretch", flexDirection: "column" }}>
                    <label style={styles.equipmentEditField}>
                      <span>Name</span>
                      <input value={equipmentDraft.name} onChange={(event) => setEquipmentDraft(draft => ({ ...draft, name: event.target.value }))} style={styles.equipmentEditInput} />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <label style={styles.equipmentEditField}>
                        <span>Quantity</span>
                        <input type="number" min="0" value={equipmentDraft.quantity} onChange={(event) => setEquipmentDraft(draft => ({ ...draft, quantity: event.target.value }))} style={styles.equipmentEditInput} />
                      </label>
                      <label style={styles.equipmentEditField}>
                        <span>Low-stock alert</span>
                        <input type="number" min="0" value={equipmentDraft.lowThreshold} onChange={(event) => setEquipmentDraft(draft => ({ ...draft, lowThreshold: event.target.value }))} style={styles.equipmentEditInput} />
                      </label>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button onClick={() => setEditingEquipmentId(null)} style={styles.equipmentCancelBtn}>Cancel</button>
                      <button onClick={saveEquipment} style={styles.equipmentSaveBtn}>Save changes</button>
                    </div>
                  </div>
                );
              }

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
                      {isOut && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>Out of stock</span>}
                      {isLow && <span className="pulse-badge" style={{ ...styles.stockBadge, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}>Low</span>}
                    </div>
                  </div>

                  <span style={styles.stockQty}>{item.quantity}</span>
                  {item.category === "equipment" && (
                    <button
                      onClick={() => {
                        setEditingEquipmentId(item.id);
                        setEquipmentDraft({ name: item.name, quantity: String(item.quantity), lowThreshold: String(item.lowThreshold) });
                      }}
                      style={styles.equipmentEditBtn}
                      aria-label={`Edit ${item.name}`}
                    >
                      Edit
                    </button>
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

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {[{ label: "Out of stock", value: outItems.length, color: "#dc2626", bg: "#fef2f2" }, { label: "Low stock", value: lowItems.length, color: "#b45309", bg: "#fffbeb" }, { label: "Equipment", value: equipment.length, color: "#2563eb", bg: "#eff6ff" }].map((summary) => (
                    <div key={summary.label} style={{ border: `1px solid ${summary.color}22`, background: summary.bg, borderRadius: 13, padding: 12, textAlign: "center" }}><span style={{ display: "block", fontSize: 9, color: summary.color, fontWeight: 800 }}>{summary.label}</span><strong style={{ display: "block", marginTop: 4, color: "#0f172a", fontSize: 21 }}>{summary.value}</strong></div>
                  ))}
                </div>
                <input type="search" value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="Search stock items" style={{ ...styles.userNameInput, width: "100%" }} />
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                  {["All", "Flavours", "Consumables", "Equipment"].map((category) => <button key={category} onClick={() => setStockCategory(category)} style={{ border: "1px solid rgba(15,23,42,0.08)", background: stockCategory === category ? "#0f172a" : "rgba(255,255,255,0.7)", color: stockCategory === category ? "#fff" : "#475569", borderRadius: 20, padding: "7px 11px", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{category}</button>)}
                </div>

                {consumables.length > 0 && (
                  <>
                    <button onClick={() => setConsumablesCollapsed(c => !c)} style={styles.collapsibleHeader}>
                      <span>🔥 Consumables <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>({consumables.length})</span></span>
                      <span style={styles.collapseChevron}>{consumablesCollapsed ? "▶" : "▼"}</span>
                    </button>
                    {!consumablesCollapsed && <div className="expand-down" style={styles.stockList}>{consumables.map((item, i) => <div key={item.id} className={`card-enter d-${Math.min(i, 6)}`}>{renderItem(item)}</div>)}</div>}
                  </>
                )}

                {equipment.length > 0 && (
                  <>
                    <button onClick={() => setEquipmentCollapsed(c => !c)} style={styles.collapsibleHeader}>
                      <span>🛠️ Equipment <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>({equipment.length})</span></span>
                      <span style={styles.collapseChevron}>{equipmentCollapsed ? "▶" : "▼"}</span>
                    </button>
                    {!equipmentCollapsed && <div className="expand-down" style={styles.stockList}>{equipment.map((item, i) => <div key={item.id} className={`card-enter d-${Math.min(i, 6)}`}>{renderItem(item)}</div>)}</div>}
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
                            try { await navigator.share({ title: "Stock Report", text }); return; } catch { navigator.clipboard?.writeText(text); }
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

              {settingsSection === "overview" ? (
                <>
                  <div style={styles.settingsSectionLabel}>Choose a section</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    {[
                      { key: "pricing", icon: "R", title: "Pricing", text: "Pipe and refill prices", tone: "#2563eb", bg: "#eff6ff" },
                      { key: "team", icon: "👥", title: "Team & access", text: `${users.length} users and permissions`, tone: "#7c3aed", bg: "#f5f3ff" },
                      { key: "security", icon: "🔐", title: "Security", text: "Passwords and sessions", tone: "#dc2626", bg: "#fef2f2" },
                      { key: "business", icon: "⚙", title: "Business", text: "Payments and stock rules", tone: "#047857", bg: "#ecfdf5" },
                    ].map((section) => (
                      <button key={section.key} onClick={() => setSettingsSection(section.key)} style={{ border: "1px solid rgba(15,23,42,0.07)", background: section.bg, borderRadius: 16, padding: 16, minHeight: 132, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "space-between", fontFamily: "inherit" }}>
                        <span style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", background: "#fff", color: section.tone, fontSize: section.icon === "R" ? 16 : 18, fontWeight: 900, boxShadow: "0 4px 12px rgba(15,23,42,0.06)" }}>{section.icon}</span>
                        <span><strong style={{ display: "block", color: "#0f172a", fontSize: 14 }}>{section.title}</strong><span style={{ display: "block", color: "#64748b", fontSize: 10, marginTop: 3, lineHeight: 1.4 }}>{section.text}</span></span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button onClick={() => setSettingsSection("overview")} style={{ alignSelf: "flex-start", border: 0, background: "rgba(255,255,255,0.65)", borderRadius: 10, padding: "8px 12px", color: "#334155", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>← All settings</button>
              )}

              {settingsSection === "pricing" && <>
              <div style={styles.settingsSectionLabel}>Pricing</div>

              <div style={styles.settingsGrid}>
                <div className="card-enter d-0" style={styles.settingCard}>
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
                <div className="card-enter d-1" style={styles.settingCard}>
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
              </>}

              {/* Users section — collapsible */}
              {settingsSection === "team" && <>
              <div style={styles.settingsSectionLabel}>Team & access</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {["Staff", "Manager", "Admin"].map((role) => (
                  <div key={role} style={{ background: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 12, padding: 11 }}>
                    <strong style={{ display: "block", fontSize: 20, color: "#0f172a" }}>{users.filter((u) => u.role === role && !u.paused).length}</strong>
                    <span style={{ fontSize: 9, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>{role}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="search" value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="Search name or username" style={{ ...styles.userNameInput, flex: 1 }} />
                <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ ...styles.userRoleSelect, width: 124 }}>
                  {['All', 'Staff', 'Manager', 'Admin', 'Suspended'].map((filter) => <option key={filter}>{filter}</option>)}
                </select>
              </div>
              <button
                onClick={() => setUsersCollapsed((c) => !c)}
                style={styles.collapsibleHeader}
              >
                <span>Users</span>
                <span style={styles.collapseChevron}>{usersCollapsed ? "▶" : "▼"}</span>
              </button>

              {!usersCollapsed && (
                <div className="expand-down" style={styles.userList}>
                  {visibleUsers.map((u, ui) => {
                    const isExpanded = expandedUsers.has(u.id);
                    return (
                    <div key={u.id} className={`card-enter d-${Math.min(ui, 6)}`} style={{ ...styles.userCard, opacity: u.paused ? 0.55 : 1 }}>
                      <div style={{ ...styles.userRow, cursor: "pointer" }} onClick={() => toggleUserExpanded(u.id)}>
                        <div style={{ ...styles.userAvatar, background: u.paused ? "#94a3b8" : undefined }}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={styles.userMeta}>
                          <strong style={styles.userName}>{u.name}</strong>
                          <span style={styles.userRole}>{u.username ? `@${u.username} · ` : ""}{u.role}{u.paused ? " · Suspended" : ""}</span>
                        </div>
                        {isAdmin && (
                          deleteConfirmId === u.id ? (
                            <div style={styles.deleteConfirmRow}>
                              <span style={styles.deleteConfirmLabel}>Delete?</span>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try { await manageStaff("delete", { userId: u.id }); setUsers((prev) => prev.filter((x) => x.id !== u.id)); setStaffMessageType("success"); setStaffMessage("User deleted."); }
                                  catch (error) { setStaffMessageType("error"); setStaffMessage(error.message); }
                                  setDeleteConfirmId(null);
                                }}
                                style={styles.deleteConfirmYes}
                              >Yes</button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                style={styles.deleteConfirmNo}
                              >No</button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => { setResetPinId(resetPinId === u.id ? null : u.id); setResetPinValue(""); }}
                                style={{ ...styles.userDeleteBtn, fontSize: 14, padding: "2px 9px", borderRadius: 8 }}
                                title="Change password"
                              >🔑</button>
                              {u.id !== activeUser?.id && (
                                <button
                                  onClick={() => setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, paused: !x.paused } : x))}
                                  style={{ ...styles.userDeleteBtn, background: u.paused ? "rgba(22,163,74,0.1)" : "rgba(234,179,8,0.12)", color: u.paused ? "#16a34a" : "#b45309", borderColor: u.paused ? "rgba(22,163,74,0.25)" : "rgba(234,179,8,0.3)", fontSize: 15, padding: "2px 9px", borderRadius: 8 }}
                                  title={u.paused ? "Unpause" : "Pause"}
                                >
                                  {u.paused ? "▶" : "⏸"}
                                </button>
                              )}
                              <button
                                onClick={() => setDeleteConfirmId(u.id)}
                                style={styles.userDeleteBtn}
                              >
                                ×
                              </button>
                            </div>
                          )
                        )}
                      </div>
                      {isExpanded && (
                        <div className="expand-down">
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
                          {resetPinId === u.id && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(15,23,42,0.07)" }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }}>New password</span>
                              <input
                                type="password"
                                autoFocus
                                placeholder="Enter new password"
                                value={resetPinValue}
                                onChange={e => setResetPinValue(e.target.value)}
                                onKeyDown={async e => {
                                  if (e.key === "Enter" && resetPinValue) {
                                    await manageStaff("password", { userId: u.id, password: resetPinValue });
                                    setStaffMessageType("success"); setStaffMessage("Password updated.");
                                    setResetPinId(null); setResetPinValue("");
                                  }
                                  if (e.key === "Escape") { setResetPinId(null); setResetPinValue(""); }
                                }}
                                style={{ ...styles.restockInput, flex: 1 }}
                              />
                              <button
                                onClick={async () => {
                                  if (!resetPinValue) return;
                                  try { await manageStaff("password", { userId: u.id, password: resetPinValue }); setStaffMessageType("success"); setStaffMessage("Password updated."); }
                                  catch (error) { setStaffMessageType("error"); setStaffMessage(error.message); }
                                  setResetPinId(null); setResetPinValue("");
                                }}
                                style={styles.restockConfirmBtn}
                              >✓</button>
                              <button onClick={() => { setResetPinId(null); setResetPinValue(""); }} style={styles.restockCancelBtn}>✕</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ); })}
                  {visibleUsers.length === 0 && (
                    <div style={styles.emptyState}>No users match this search</div>
                  )}
                </div>
              )}

              {isAdmin && (
                <div className="card-enter" style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 10px 30px rgba(15,23,42,0.06)" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>Add a new user</div>
                    <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.5, color: "#64748b" }}>Create secure login details and choose what this person can access.</div>
                  </div>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Full name</span>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="e.g. Thabo Mokoena"
                      value={newUserName}
                      onChange={(e) => { setNewUserName(e.target.value); setStaffMessage(""); }}
                      style={{ ...styles.userNameInput, flex: "none", width: "100%" }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Username</span>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontWeight: 800 }}>@</span>
                      <input
                        type="text"
                        autoComplete="off"
                        maxLength={32}
                        placeholder="thabo"
                        value={newUsername}
                        onChange={(e) => { setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "")); setStaffMessage(""); }}
                        style={{ ...styles.userNameInput, flex: "none", width: "100%", paddingLeft: 30 }}
                      />
                    </div>
                    <span style={{ fontSize: 10, color: newUsername && !usernameIsValid ? "#dc2626" : "#64748b" }}>
                      3–32 characters · letters, numbers, dots, dashes or underscores
                    </span>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Access level</span>
                    <select
                      value={newUserRole}
                      onChange={(e) => { setNewUserRole(e.target.value); setStaffMessage(""); }}
                      style={{ ...styles.userRoleSelect, width: "100%" }}
                    >
                      <option value="Staff">Staff · POS and orders</option>
                      <option value="Manager">Manager · Stock and management</option>
                      <option value="Admin">Admin · Full access</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={styles.loginLabel}>Temporary password</span>
                    <div style={{ position: "relative" }}>
                      <input
                        id="new-user-pin"
                        type={showNewUserPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="At least 10 characters"
                        value={newUserPin}
                        onChange={(e) => { setNewUserPin(e.target.value); setStaffMessage(""); }}
                        style={{ ...styles.userNameInput, width: "100%", paddingRight: 64 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewUserPassword((show) => !show)}
                        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: "#475569", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                      >{showNewUserPassword ? "Hide" : "Show"}</button>
                    </div>
                    <span style={{ fontSize: 10, color: newUserPin && !passwordIsValid ? "#dc2626" : "#64748b" }}>
                      Minimum 10 characters. Share it privately with the new user.
                    </span>
                  </label>

                  {staffMessage && (
                    <div style={{ ...styles.loginErrorMsg, background: staffMessageType === "success" ? "rgba(22,163,74,0.1)" : undefined, color: staffMessageType === "success" ? "#15803d" : undefined, borderColor: staffMessageType === "success" ? "rgba(22,163,74,0.2)" : undefined }}>
                      {staffMessage}
                    </div>
                  )}

                  <button
                    disabled={!addUserFormIsValid || addingUser}
                    onClick={async () => {
                      if (!addUserFormIsValid || addingUser) return;
                      setAddingUser(true); setStaffMessage("");
                      try {
                        await manageStaff("create", { name: newUserName.trim(), username: newUsername, password: newUserPin, role: newUserRole });
                        const refreshed = await fetchUsers();
                        if (refreshed) setUsers(refreshed);
                        setNewUserName(""); setNewUsername(""); setNewUserPin(""); setNewUserRole("Staff"); setShowNewUserPassword(false);
                        setStaffMessageType("success"); setStaffMessage("User created. They can now sign in with their username.");
                      } catch (error) {
                        setStaffMessageType("error"); setStaffMessage(error.message);
                      } finally { setAddingUser(false); }
                    }}
                    style={{ ...styles.addUserBtn, width: "100%", minHeight: 44, opacity: !addUserFormIsValid || addingUser ? 0.5 : 1, cursor: !addUserFormIsValid || addingUser ? "not-allowed" : "pointer" }}
                  >
                    {addingUser ? "Creating secure account…" : `Create ${newUserRole} account`}
                  </button>
                </div>
              )}
              </>}

              {settingsSection === "security" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={styles.settingsSectionLabel}>Security</div>
                  <div style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div><strong style={{ color: "#0f172a", fontSize: 14 }}>Change my password</strong><p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 10, lineHeight: 1.5 }}>Use at least 10 characters. Your current password is required.</p></div>
                    <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setSecurityMessage(""); }} placeholder="Current password" style={{ ...styles.userNameInput, width: "100%" }} />
                    <input type="password" autoComplete="new-password" value={nextPassword} onChange={(e) => { setNextPassword(e.target.value); setSecurityMessage(""); }} placeholder="New password" style={{ ...styles.userNameInput, width: "100%" }} />
                    <button disabled={securityBusy || !currentPassword || nextPassword.length < 10} onClick={async () => {
                      setSecurityBusy(true); setSecurityMessage("");
                      try { await changeOwnPassword(currentPassword, nextPassword); setCurrentPassword(""); setNextPassword(""); setSecurityMessage("Password updated securely."); }
                      catch (error) { setSecurityMessage(error.message); }
                      finally { setSecurityBusy(false); }
                    }} style={{ ...styles.addUserBtn, minHeight: 42, opacity: securityBusy || !currentPassword || nextPassword.length < 10 ? 0.5 : 1 }}>
                      {securityBusy ? "Updating…" : "Update password"}
                    </button>
                    {securityMessage && <div style={styles.loginErrorMsg}>{securityMessage}</div>}
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 16, padding: 16 }}>
                    <strong style={{ color: "#0f172a", fontSize: 14 }}>Active sessions</strong>
                    <p style={{ color: "#64748b", fontSize: 10, lineHeight: 1.5 }}>Sign out this account on every device. You will need to sign in again.</p>
                    <button onClick={async () => { await signOutEverywhere(); setActiveUser(null); setUsers([]); setDbReady(false); }} style={{ width: "100%", minHeight: 42, border: "1px solid rgba(220,38,38,0.2)", background: "#fef2f2", color: "#b91c1c", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Sign out all devices</button>
                  </div>
                </div>
              )}

              {settingsSection === "business" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={styles.settingsSectionLabel}>Business settings</div>
                  {[
                    { title: "Payment methods", value: "Cash and card", note: "Available on every POS order" },
                    { title: "Coal per sale", value: `${COAL_PER_SALE} pieces`, note: "Automatically deducted from stock" },
                    { title: "Mouth pieces per sale", value: `${MOUTHPIECES_PER_SALE} pieces`, note: "Automatically deducted from stock" },
                    { title: "Data sync", value: supabase ? "Supabase connected" : "Not configured", note: "Protected by authenticated database policies" },
                  ].map((item) => (
                    <div key={item.title} style={{ background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", borderRadius: 14, padding: 15, display: "flex", justifyContent: "space-between", gap: 14 }}>
                      <span><strong style={{ display: "block", color: "#0f172a", fontSize: 13 }}>{item.title}</strong><span style={{ display: "block", color: "#64748b", fontSize: 9, marginTop: 4 }}>{item.note}</span></span>
                      <strong style={{ color: "#047857", fontSize: 11, textAlign: "right", whiteSpace: "nowrap" }}>{item.value}</strong>
                    </div>
                  ))}
                </div>
              )}
              </>}
            </div>
          )}
        </main>

        {visibleTab === "delivered" && ordersView === "Delivered" && totalDeliveredPages > 1 && (
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
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "linear-gradient(135deg, #071a3d 0%, #0f274f 100%)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 12px 30px rgba(7,26,61,0.28)", borderRadius: 18, padding: "6px 5px", width: "100%", boxSizing: "border-box" }}>
          {[
            { key: "pos",        label: "POS",        icon: "pos",        badge: currentOrders.length,   access: true },
            { key: "delivered",  label: "Orders",     icon: "orders",     badge: deliveredOrders.length, access: canAccess("delivered") },
            { key: "stock",      label: "Stock",      icon: "stock",      badge: 0,                      access: canAccess("stock") },
            { key: "management", label: "Management", icon: "management", badge: 0,                      access: canAccess("management") },
          ].filter(t => t.access).map(t => {
            const active = visibleTab === t.key;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ ...styles.footerTab, background: "transparent", borderRadius: 14, padding: "6px 3px", flex: 1, transition: "all 0.2s ease" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <TabIcon name={t.icon} active={active} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: active ? "#fff" : "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{t.label}</span>
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
    maxWidth: 430,
    minHeight: "100dvh",
    margin: "0 auto",
    padding: "66px 10px 82px",
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
    maxWidth: 430,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "11px 12px",
    minHeight: 56,
    background: "rgba(248,250,252,0.94)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderBottom: "1px solid rgba(255,255,255,0.9)",
    borderRadius: 0,
    boxShadow: "0 1px 0 rgba(15,23,42,0.06)",
  },
  screenTitle: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    margin: 0,
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 1,
    fontWeight: 900,
    whiteSpace: "nowrap",
    letterSpacing: "-0.02em",
  },
  headerIconBtn: {
    marginLeft: "auto",
    width: 36,
    height: 36,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "rgba(255,255,255,0.8)",
    color: "#0f172a",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 15,
    fontFamily: "inherit",
  },
  availabilityCard: {
    marginBottom: 9,
    padding: "12px 14px",
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 12,
    boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
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
    background: "rgba(255,255,255,0.88)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(15,23,42,0.07)",
    borderRadius: 12,
    boxShadow: "0 4px 14px rgba(15,23,42,0.04)",
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
    background: "#071a3d",
    color: "#fff",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 10px 22px rgba(7,26,61,0.18)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
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
    background: "rgba(255,255,255,0.9)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(15,23,42,0.07)",
    borderRadius: 16,
    boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
  },
  deliveredPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "rgba(255,255,255,0.9)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(15,23,42,0.07)",
    borderRadius: 16,
    boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
  },
  settingsPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: "rgba(255,255,255,0.9)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(15,23,42,0.07)",
    borderRadius: 16,
    boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
  },
  totalBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "linear-gradient(135deg, #071a3d 0%, #102a56 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 13,
    boxShadow: "0 8px 20px rgba(7,26,61,0.16)",
  },
  deliveredBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "linear-gradient(135deg, #071a3d 0%, #102a56 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 13,
    boxShadow: "0 8px 20px rgba(7,26,61,0.16)",
  },
  settingsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "linear-gradient(135deg, #071a3d 0%, #102a56 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    color: "#fff",
    padding: "14px 16px",
    borderRadius: 13,
    boxShadow: "0 8px 20px rgba(7,26,61,0.16)",
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
    background: "rgba(255,255,255,0.45)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(255,255,255,0.75)",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,0.8)",
  },
  userPermissions: {
    display: "flex",
    gap: 6,
    padding: "8px 12px 12px",
    borderTop: "1px solid rgba(255,255,255,0.6)",
    flexWrap: "wrap",
    background: "rgba(255,255,255,0.25)",
  },
  permissionPill: {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(203,213,225,0.5)",
    background: "rgba(255,255,255,0.5)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s ease",
  },
  permissionPillOn: {
    background: "rgba(15,23,42,0.85)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid rgba(15,23,42,0.7)",
    color: "#ffffff",
  },
  permissionPillAlwaysOn: {
    background: "rgba(15,23,42,0.07)",
    border: "1px solid rgba(15,23,42,0.1)",
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
    padding: "12px 14px",
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 2px 8px rgba(15,23,42,0.25)",
    border: "1px solid rgba(255,255,255,0.15)",
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
    background: "rgba(255,255,255,0.9)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(15,23,42,0.07)",
    borderRadius: 16,
    boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
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
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(15,23,42,0.04)",
  },
  stockRowLow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    background: "rgba(255,251,235,0.88)",
    border: "1px solid rgba(253,230,138,0.7)",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(180,83,9,0.06)",
  },
  stockRowCritical: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    background: "rgba(254,242,242,0.88)",
    border: "1px solid rgba(254,202,202,0.7)",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(220,38,38,0.06)",
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
  equipmentEditBtn: {
    minHeight: 34,
    padding: "0 11px",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: 11,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  equipmentEditField: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: "#64748b",
    fontSize: 10,
    fontWeight: 800,
  },
  equipmentEditInput: {
    width: "100%",
    minHeight: 42,
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 16,
    fontWeight: 800,
    fontFamily: "inherit",
  },
  equipmentCancelBtn: {
    minHeight: 40,
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
    fontFamily: "inherit",
  },
  equipmentSaveBtn: {
    minHeight: 40,
    border: "1px solid #071a3d",
    borderRadius: 9,
    background: "#071a3d",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 900,
    fontFamily: "inherit",
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
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    background: "#ffffff",
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
    background: "#ffffff",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid #e2e8f0",
    borderRadius: 13,
    boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
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
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    borderRadius: 12,
  },
  orderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 12px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    boxShadow: "0 3px 10px rgba(15,23,42,0.04)",
    fontSize: 13,
  },
  deliveredRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    padding: "12px 12px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
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
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    color: "#1d4ed8",
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
    maxWidth: 430,
    margin: "0 auto",
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
