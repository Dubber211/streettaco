import { useEffect, useMemo, useState, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useFocusTrap } from "../hooks";
import { supabase } from "../supabase";
import { DEFAULT_CENTER, TILE_LIGHT, MAX_NAME_LENGTH, MAX_FOOD_LENGTH, STORAGE_KEYS } from "../constants";
import { getFoodEmoji, makeTruckIcon, adminPinIcon, formatSchedule, timeAgo, isOpenBySchedule, isTruckExpired, reverseGeocode, nominatimFetch } from "../utils";
import { FocusTruck } from "./MapHelpers";
import { ScheduleInput } from "./MapHelpers";

export function AdminMapClick({ onPick }) {
  useMapEvents({ click(e) { onPick([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

export function AdminMapCenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, 16, { animate: true }); }, [center, map]);
  return null;
}

export function FitBoundsToTrucks({ trucks }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || trucks.length === 0) return;
    fittedRef.current = true;
    const bounds = L.latLngBounds(trucks.map(t => t.position));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }, [trucks, map]);
  return null;
}

export function AdminMap({ trucks, focusRequest, addMode, editMode, addPin, onPickLocation }) {
  const markerRefs = useRef({});

  // Clean up refs for trucks that have been removed
  useEffect(() => {
    const truckIds = new Set(trucks.map(t => t.id));
    for (const id of Object.keys(markerRefs.current)) {
      if (!truckIds.has(Number(id))) delete markerRefs.current[id];
    }
  }, [trucks]);

  return (
    <div className="admin-map-wrapper">
      {(addMode || editMode) && <div className="admin-map-hint">📍 Click the map to {editMode ? "move the pin" : "drop a pin"}</div>}
      <MapContainer center={DEFAULT_CENTER} zoom={5} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer url={TILE_LIGHT} attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
        <FitBoundsToTrucks trucks={trucks} />
        <FocusTruck trucks={trucks} focusRequest={focusRequest} markerRefs={markerRefs} zoom={16} />
        {(addMode || editMode) && <AdminMapClick onPick={onPickLocation} />}
        {addPin && <AdminMapCenter center={addPin} />}
        {addPin && <Marker position={addPin} icon={adminPinIcon} />}
        {trucks.map(truck => {
          const icon = makeTruckIcon(truck.foodType, truck.open);
          return (
            <Marker key={truck.id} ref={el => { if (el) markerRefs.current[truck.id] = el; }} position={truck.position} icon={icon} opacity={truck.isHidden ? 0.4 : 1}>
              <Popup autoPan={false}>
                <div className="popup-card">
                  <div className="popup-header">
                    <div className="popup-emoji">{getFoodEmoji(truck.foodType)}</div>
                    <div>
                      <div className="popup-name">
                        {truck.name}
                        {truck.isVerified && <span> ✅</span>}
                        {truck.isHidden && <span style={{ color: "#ef4444" }}> [Hidden]</span>}
                      </div>
                      <div className="popup-type">{truck.street ? `${truck.foodType} on ${truck.street}` : truck.foodType}</div>
                    </div>
                  </div>
                  <div className="popup-badges">
                    <span className={`badge ${truck.open ? "badge-open" : "badge-closed"}`} role="status" aria-label={truck.open ? "Currently open" : "Currently closed"}>{truck.open ? "● Open" : "○ Closed"}</span>
                    <span className={`badge ${truck.isPermanent ? "badge-perm" : "badge-mobile"}`}>{truck.isPermanent ? "📌 Permanent" : "🚚 Mobile"}</span>
                  </div>
                  <div className="popup-meta">
                    <span>⭐ {truck.votes} votes</span>
                    {truck.hours && <span>⏰ {formatSchedule(truck.hours)}</span>}
                    {truck.city && truck.state && <span>📍 {truck.city}, {truck.state}</span>}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}


/* ─── Admin Login Modal ─────────────────────────────────────────────────────── */
export function AdminLoginModal({ onLogin, onClose }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError("");
    const result = await onLogin(email.trim(), password);
    if (result.error) { setError(result.error); setSubmitting(false); }
  }

  const trapRef = useFocusTrap();

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card admin-login-card" ref={trapRef}>
        <div className="onboarding-icon">🔐</div>
        <div className="onboarding-title">Admin Login</div>
        <form onSubmit={handleSubmit} className="admin-login-form">
          <input type="email" className="add-input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
          <input type="password" className="add-input" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <div className="admin-login-error">{error}</div>}
          <button type="submit" className="btn-onboarding-next" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <button className="btn-onboarding-skip" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ─── Admin Panel ──────────────────────────────────────────────────────────── */
export function AdminPanel({ trucks, onToggleHide, onToggleVerify, onHideComment, onUnhideComment, onDeleteComment, onDeleteTruck, onEditTruck, onReconfirm, onApprove, onReject, onAddTruck, onLogout, showToast }) {
  const [filter, setFilter] = useState("all");
  const [expandedTruck, setExpandedTruck] = useState(null);
  const [adminFocusRequest, setAdminFocusRequest] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addFood, setAddFood] = useState("");
  const [addOpen, setAddOpen] = useState(true);
  const [addPermanent, setAddPermanent] = useState(false);
  const [addHours, setAddHours] = useState("");
  const [addPin, setAddPin] = useState(null);
  const [addSaving, setAddSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editFood, setEditFood] = useState("");
  const [editOpen, setEditOpen] = useState(true);
  const [editHours, setEditHours] = useState("");
  const [editPermanent, setEditPermanent] = useState(false);
  const [editPin, setEditPin] = useState(null);

  // Close edit/expand if the truck is removed
  useEffect(() => {
    if (editingId && !trucks.some(t => t.id === editingId)) {
      setEditingId(null);
      showToast("That truck was removed.");
    }
    if (expandedTruck && !trucks.some(t => t.id === expandedTruck)) {
      setExpandedTruck(null);
    }
  }, [trucks, editingId, expandedTruck, showToast]);

  function startEdit(truck) {
    setEditingId(truck.id);
    setEditName(truck.name);
    setEditFood(truck.foodType);
    setEditOpen(truck.open);
    setEditHours(truck.hours || "");
    setEditPermanent(truck.isPermanent);
    setEditPin(truck.position);
  }

  function saveEdit() {
    const name = editName.trim(), foodType = editFood.trim();
    if (!name || !foodType) return;
    if (!editPin) return;
    const scheduleOpen = isOpenBySchedule(editHours);
    onEditTruck(editingId, {
      name, foodType, open: scheduleOpen !== null ? scheduleOpen : editOpen,
      hours: editHours, isPermanent: editPermanent,
      lat: editPin[0], lng: editPin[1],
    });
    setEditingId(null);
  }
  const [addLocLoading, setAddLocLoading] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addSearching, setAddSearching] = useState(false);

  async function handleAdminSearch(e) {
    e.preventDefault();
    const q = addSearch.trim();
    if (!q) return;
    setAddSearching(true);
    try {
      const params = new URLSearchParams({ format: "jsonv2", limit: "1" });
      /^\d{5}$/.test(q) ? (params.set("postalcode", q), params.set("countrycodes", "us")) : params.set("q", q);
      const res = await nominatimFetch(`https://nominatim.openstreetmap.org/search?${params}`);
      const data = await res.json();
      if (data.length) {
        setAddPin([Number(data[0].lat), Number(data[0].lon)]);
        showToast(`Centered on ${q}.`);
      } else { showToast("Location not found."); }
    } catch { showToast("Search failed."); }
    setAddSearching(false);
  }

  function handleAdminUseLocation() {
    if (!navigator.geolocation) { showToast("Geolocation not supported."); return; }
    setAddLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setAddPin([pos.coords.latitude, pos.coords.longitude]); setAddLocLoading(false); showToast("Location set!"); },
      err => {
        setAddLocLoading(false);
        const msgs = {
          [err.PERMISSION_DENIED]: "Location permission denied. Check browser settings.",
          [err.POSITION_UNAVAILABLE]: "Location unavailable.",
          [err.TIMEOUT]: "Location request timed out.",
        };
        showToast(msgs[err.code] || "Couldn't get location.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function handleAdminAdd() {
    const name = addName.trim(), food = addFood.trim();
    if (!name || !food) { showToast("Enter truck name and food type."); return; }
    if (!addPin) { showToast("Set a location first (drop a pin or use your location)."); return; }
    setAddSaving(true);
    const scheduleOpen = isOpenBySchedule(addHours);
    await onAddTruck({ name, food, open: scheduleOpen !== null ? scheduleOpen : true, isPermanent: addPermanent, hours: addHours, lat: addPin[0], lng: addPin[1] });
    setAddName(""); setAddFood(""); setAddPermanent(false); setAddHours(""); setAddPin(null);
    setAddSaving(false);
    setShowAddForm(false);
  }

  const [backfilling, setBackfilling] = useState(false);

  async function handleBackfill() {
    const missing = trucks.filter(t => !t.city || !t.state);
    if (missing.length === 0) { showToast("All trucks already have city/state."); return; }
    setBackfilling(true);
    let count = 0;
    for (const t of missing) {
      const geo = await reverseGeocode(t.position[0], t.position[1]);
      if (geo.city || geo.state) {
        await supabase.from("trucks").update({
          ...(geo.street ? { street: geo.street } : {}),
          ...(geo.city ? { city: geo.city } : {}),
          ...(geo.state ? { state: geo.state } : {}),
        }).eq("id", t.id);
        count++;
      }
      await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
    }
    showToast(`Backfilled ${count} of ${missing.length} trucks. Reload to see updates.`);
    setBackfilling(false);
  }

  const filtered = useMemo(() => {
    if (filter === "pending") return trucks.filter(t => !t.isApproved);
    if (filter === "hidden") return trucks.filter(t => t.isHidden);
    if (filter === "unverified") return trucks.filter(t => !t.isVerified && !t.isHidden);
    if (filter === "expired") return trucks.filter(t => isTruckExpired(t));
    return trucks;
  }, [trucks, filter]);

  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach(t => {
      const key = t.city && t.state ? `${t.city}, ${t.state}` : t.state || "Unknown Location";
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const missingCount = useMemo(() => trucks.filter(t => !t.city || !t.state).length, [trucks]);

  const filterCounts = useMemo(() => ({
    pending: trucks.filter(t => !t.isApproved).length,
    hidden: trucks.filter(t => t.isHidden).length,
    unverified: trucks.filter(t => !t.isVerified && !t.isHidden).length,
    expired: trucks.filter(t => isTruckExpired(t)).length,
  }), [trucks]);

  const [tab, setTab] = useState("trucks"); // "trucks" | "feedback" | "add"
  const [feedbackCount, setFeedbackCount] = useState(0);
  useEffect(() => {
    supabase.from("feedback").select("id", { count: "exact", head: true }).eq("is_read", false)
      .then(({ count }) => { if (count != null) setFeedbackCount(count); });
  }, [tab]);

  return (
    <div className="admin-panel">
      {/* ── Header ── */}
      <div className="admin-header">
        <div className="admin-header-top">
          <div className="admin-header-brand">
            <img src="/logo.png" alt="" className="admin-logo-img" /><span className="admin-header-title">StreetTaco</span>
            <span className="admin-header-sub">Admin</span>
          </div>
          <div className="admin-header-actions">
            {missingCount > 0 && (
              <button className="admin-pill-btn" onClick={handleBackfill} disabled={backfilling}>
                {backfilling ? "Backfilling…" : `📍 Backfill (${missingCount})`}
              </button>
            )}
            <button className="admin-pill-btn admin-pill-logout" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="admin-stats">
          <div className="admin-stat"><span className="admin-stat-num">{trucks.length}</span><span className="admin-stat-label">Total</span></div>
          <div className={`admin-stat ${filterCounts.pending > 0 ? "admin-stat-alert" : ""}`}><span className="admin-stat-num">{filterCounts.pending}</span><span className="admin-stat-label">Pending</span></div>
          <div className="admin-stat"><span className="admin-stat-num">{filterCounts.hidden}</span><span className="admin-stat-label">Hidden</span></div>
          <div className="admin-stat"><span className="admin-stat-num">{filterCounts.expired}</span><span className="admin-stat-label">Expired</span></div>
        </div>

        {/* ── Tabs ── */}
        <div className="admin-tabs">
          <button className={`admin-tab ${tab === "trucks" ? "active" : ""}`} onClick={() => setTab("trucks")}>🚚 Trucks</button>
          <button className={`admin-tab ${tab === "feedback" ? "active" : ""}`} onClick={() => setTab("feedback")}>💬 Feedback{feedbackCount > 0 && <span className="admin-badge pending" style={{ marginLeft: 6 }}>{feedbackCount}</span>}</button>
          <button className={`admin-tab ${tab === "analytics" ? "active" : ""}`} onClick={() => setTab("analytics")}>📊 Analytics</button>
          <button className={`admin-tab ${tab === "add" ? "active" : ""}`} onClick={() => { setTab("add"); setShowAddForm(true); }}>+ Add</button>
        </div>

        {/* ── Filters (inside sticky header) ── */}
        {tab === "trucks" && (
          <div className="admin-filters">
            <button className={`filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All</button>
            <button className={`filter-btn ${filter === "pending" ? "active" : ""}`} onClick={() => setFilter("pending")}>Pending</button>
            <button className={`filter-btn ${filter === "hidden" ? "active" : ""}`} onClick={() => setFilter("hidden")}>Hidden</button>
            <button className={`filter-btn ${filter === "unverified" ? "active" : ""}`} onClick={() => setFilter("unverified")}>Unverified</button>
            <button className={`filter-btn ${filter === "expired" ? "active" : ""}`} onClick={() => setFilter("expired")}>Expired</button>
          </div>
        )}
      </div>

      {/* ── Map (hidden on feedback tab) ── */}
      {tab !== "feedback" && tab !== "analytics" && <AdminMap
        trucks={filtered}
        focusRequest={adminFocusRequest}
        addMode={showAddForm && tab === "add"}
        editMode={editingId !== null}
        addPin={editingId ? editPin : addPin}
        onPickLocation={pos => {
          if (editingId) { setEditPin(pos); showToast("Pin moved!"); }
          else { setAddPin(pos); showToast("Pin dropped!"); }
        }}
      />}

      {/* ── Add Truck Tab ── */}
      {tab === "add" && (
        <div className="admin-add-form">
          <div className="admin-add-title">Add Truck (no limits)</div>
          <div className="admin-add-grid">
            <input className="add-input" placeholder="Truck name" value={addName} maxLength={MAX_NAME_LENGTH} onChange={e => setAddName(e.target.value)} />
            <input className="add-input" placeholder="Food type" value={addFood} maxLength={MAX_FOOD_LENGTH} onChange={e => setAddFood(e.target.value)} />
          </div>
          <div className="admin-add-location">
            <div className="admin-add-location-label">Location:</div>
            <form onSubmit={handleAdminSearch} className="admin-search-row">
              <input className="add-input" placeholder="Search city, address, or ZIP…" value={addSearch} onChange={e => setAddSearch(e.target.value)} style={{ flex: 1 }} />
              <button type="submit" className="btn-admin-action verify" disabled={addSearching} aria-label="Search location">{addSearching ? "…" : "🔍"}</button>
            </form>
            <div className="admin-btn-row">
              <button className="btn-admin-action verify" onClick={handleAdminUseLocation} disabled={addLocLoading}>
                {addLocLoading ? "Getting location…" : "📍 Use my location"}
              </button>
            </div>
            {addPin && <div className="admin-pin-status">✅ Pin at {addPin[0].toFixed(4)}, {addPin[1].toFixed(4)}</div>}
          </div>
          <label className="checkbox-row" style={{ margin: "10px 0" }}>
            <input type="checkbox" checked={addPermanent} onChange={e => setAddPermanent(e.target.checked)} />
            <span className="checkbox-label">📌 Permanent spot</span>
          </label>
          <div className="admin-add-location-label">Operating Hours:</div>
          <ScheduleInput value={addHours} onChange={setAddHours} />
          <div className="admin-btn-row" style={{ marginTop: 12 }}>
            <button className="btn-admin-action verify" onClick={handleAdminAdd} disabled={addSaving}>{addSaving ? "Saving…" : "Add Truck"}</button>
            <button className="btn-admin-action" onClick={() => { setTab("trucks"); setShowAddForm(false); setAddPin(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Trucks Tab ── */}
      {tab === "trucks" && (
        <>
          <div className="admin-truck-list">
            {filtered.length === 0 && <div className="comments-empty" style={{ padding: 32 }}>No trucks match this filter.</div>}
            {grouped.map(([location, locationTrucks]) => (
              <div key={location} className="admin-group">
                <div className="admin-group-header">{location} <span className="admin-group-count">{locationTrucks.length}</span></div>
                {locationTrucks.map(truck => (
                  <div key={truck.id} className={`admin-truck-row ${truck.isHidden ? "admin-hidden" : ""} ${!truck.isApproved ? "admin-pending-row" : ""}`}>
                    <div className="admin-truck-main" onClick={() => { setExpandedTruck(e => e === truck.id ? null : truck.id); setAdminFocusRequest(prev => ({ id: truck.id, seq: (prev?.seq ?? 0) + 1 })); }}>
                      <span className="admin-truck-emoji">{getFoodEmoji(truck.foodType)}</span>
                      <div className="admin-truck-info">
                        <div className="admin-truck-name">
                          {truck.name}
                          {truck.isVerified && <span className="admin-badge verified">Verified</span>}
                          {!truck.isApproved && <span className="admin-badge pending">Pending</span>}
                          {truck.isHidden && <span className="admin-badge hidden">Hidden</span>}
                        </div>
                        <div className="admin-truck-meta">
                          {truck.foodType} · {truck.open ? "Open" : "Closed"} · {truck.votes} votes · {timeAgo(truck.createdAt)}
                        </div>
                      </div>
                      <span className="admin-expand-icon">{expandedTruck === truck.id ? "▲" : "▼"}</span>
                    </div>

                    {expandedTruck === truck.id && (
                      <div className="admin-truck-actions">
                        {editingId === truck.id ? (
                          <div className="admin-edit-form">
                            <div className="admin-add-grid">
                              <input className="add-input" value={editName} maxLength={MAX_NAME_LENGTH} onChange={e => setEditName(e.target.value)} placeholder="Truck name" />
                              <input className="add-input" value={editFood} maxLength={MAX_FOOD_LENGTH} onChange={e => setEditFood(e.target.value)} placeholder="Food type" />
                            </div>
                            <label className="checkbox-row" style={{ margin: "8px 0" }}>
                              <input type="checkbox" checked={editPermanent} onChange={e => setEditPermanent(e.target.checked)} />
                              <span className="checkbox-label">📌 Permanent spot</span>
                            </label>
                            <div className="admin-add-location-label">Operating Hours:</div>
                            <ScheduleInput value={editHours} onChange={setEditHours} />
                            <div className="admin-add-location-label" style={{ marginTop: 10 }}>Location:</div>
                            <div className="admin-pin-status">
                              📍 {editPin[0].toFixed(4)}, {editPin[1].toFixed(4)}
                              <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginLeft: 8 }}>Click the map above to move</span>
                            </div>
                            <div className="admin-btn-row" style={{ marginTop: 10 }}>
                              <button className="btn-admin-action verify" onClick={saveEdit}>Save</button>
                              <button className="btn-admin-action" onClick={() => setEditingId(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="admin-btn-row">
                            {!truck.isApproved && <button className="btn-admin-action verify" onClick={() => onApprove(truck.id)}>✅ Approve</button>}
                            {!truck.isApproved && <button className="btn-admin-action delete" onClick={() => onReject(truck.id)}>❌ Reject</button>}
                            <button className={`btn-admin-action ${truck.isVerified ? "unverify" : "verify"}`} onClick={() => onToggleVerify(truck.id, truck.isVerified)}>
                              {truck.isVerified ? "✖ Unverify" : "✅ Verify"}
                            </button>
                            <button className="btn-admin-action" onClick={() => startEdit(truck)}>✏️ Edit</button>
                            <button className={`btn-admin-action ${truck.isHidden ? "restore" : "hide"}`} onClick={() => onToggleHide(truck.id, truck.isHidden)}>
                              {truck.isHidden ? "👁 Restore" : "🚫 Hide"}
                            </button>
                            <button className="btn-admin-action delete" onClick={() => { if (window.confirm(`Permanently delete "${truck.name}"? This cannot be undone.`)) onDeleteTruck(truck.id); }}>
                              🗑 Delete
                            </button>
                            {!truck.isPermanent && <button className="btn-admin-action restore" onClick={() => onReconfirm(truck.id)}>🔄 Re-confirm</button>}
                          </div>
                        )}
                        <div className="admin-truck-detail">
                          <span>ID: {truck.id}</span>
                          <span>User: {truck.userId?.slice(0, 8)}…</span>
                          <span>Coords: {truck.position[0].toFixed(4)}, {truck.position[1].toFixed(4)}</span>
                        </div>
                        <AdminComments truckId={truck.id} onHide={onHideComment} onUnhide={onUnhideComment} onDelete={onDeleteComment} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Feedback Tab ── */}
      {tab === "feedback" && <AdminFeedback showToast={showToast} />}

      {/* ── Analytics Tab ── */}
      {tab === "analytics" && <AdminAnalytics />}
    </div>
  );
}

export function AdminComments({ truckId, onHide, onUnhide, onDelete }) {
  const [comments, setComments] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.from("comments").select("id, body, created_at, user_id, votes, is_hidden").eq("truck_id", truckId).limit(50)
      .then(({ data }) => { if (data) setComments(data); setLoaded(true); });
  }, [truckId]);

  if (!loaded) return <div className="comments-empty">Loading comments…</div>;
  if (comments.length === 0) return <div className="comments-empty">No comments.</div>;

  return (
    <div className="admin-comments">
      <div className="admin-comments-title">Comments ({comments.length})</div>
      {comments.map(c => (
        <div key={c.id} className={`admin-comment-row ${c.is_hidden ? "admin-hidden" : ""}`}>
          <div className="admin-comment-body">
            {c.is_hidden && <span className="admin-badge hidden">Hidden</span>}
            {c.body}
          </div>
          <div className="admin-comment-meta">
            {c.votes} votes · {timeAgo(c.created_at)} · {c.user_id?.slice(0, 8)}…
          </div>
          <div className="admin-btn-row">
            {c.is_hidden ? (
              <button className="btn-admin-action restore" onClick={async () => {
                const ok = await onUnhide(c.id);
                if (ok) setComments(cur => cur.map(x => x.id === c.id ? { ...x, is_hidden: false } : x));
              }}>👁 Unhide</button>
            ) : (
              <button className="btn-admin-action hide" onClick={async () => {
                const ok = await onHide(c.id);
                if (ok) setComments(cur => cur.map(x => x.id === c.id ? { ...x, is_hidden: true } : x));
              }}>🚫 Hide</button>
            )}
            <button className="btn-admin-action delete" onClick={async () => {
              const ok = await onDelete(c.id);
              if (ok) setComments(cur => cur.filter(x => x.id !== c.id));
            }}>🗑 Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Admin Analytics ──────────────────────────────────────────────────────── */
const PERIODS = { daily: 1, weekly: 7, monthly: 30 };

function bucketEvents(events, period, numBuckets) {
  const now = new Date();
  const buckets = [];
  for (let i = numBuckets - 1; i >= 0; i--) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - i * period);
    const end = new Date(start);
    end.setDate(end.getDate() + period);
    const bucket = events.filter(e => e.created_at >= start.toISOString() && e.created_at < end.toISOString());
    let label;
    if (period === 1) label = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    else if (period === 7) label = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    else label = start.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    buckets.push({
      label,
      opens: bucket.filter(e => e.event === "app_open").length,
      navs: bucket.filter(e => e.event === "navigate_click").length,
      users: new Set(bucket.map(e => e.user_id)).size,
    });
  }
  return buckets;
}

function AdminAnalytics() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("daily");

  useEffect(() => {
    async function load() {
      const now = new Date();
      const d1 = new Date(now); d1.setHours(0, 0, 0, 0);
      const d7 = new Date(now - 7 * 86400000).toISOString();
      const d30 = new Date(now - 30 * 86400000).toISOString();

      const { data: events } = await supabase.from("analytics_events").select("event, user_id, truck_id, created_at");
      if (!events) { setLoading(false); return; }

      const allUsers = new Set(events.map(e => e.user_id));
      const [{ data: commentUsers }, { data: voteUsers }, { data: pushUsers }] = await Promise.all([
        supabase.from("comments").select("user_id"),
        supabase.from("user_votes").select("user_id"),
        supabase.from("push_subscriptions").select("user_id"),
      ]);
      (commentUsers || []).forEach(r => allUsers.add(r.user_id));
      (voteUsers || []).forEach(r => allUsers.add(r.user_id));
      (pushUsers || []).forEach(r => allUsers.add(r.user_id));

      const opens = events.filter(e => e.event === "app_open");
      const navs = events.filter(e => e.event === "navigate_click");

      // Period counts
      const todayStr = d1.toISOString();
      const todayEvents = events.filter(e => e.created_at >= todayStr);
      const week7Events = events.filter(e => e.created_at >= d7);
      const month30Events = events.filter(e => e.created_at >= d30);

      const periodCounts = {
        daily: {
          users: new Set(todayEvents.map(e => e.user_id)).size,
          opens: todayEvents.filter(e => e.event === "app_open").length,
          navs: todayEvents.filter(e => e.event === "navigate_click").length,
        },
        weekly: {
          users: new Set(week7Events.map(e => e.user_id)).size,
          opens: week7Events.filter(e => e.event === "app_open").length,
          navs: week7Events.filter(e => e.event === "navigate_click").length,
        },
        monthly: {
          users: new Set(month30Events.map(e => e.user_id)).size,
          opens: month30Events.filter(e => e.event === "app_open").length,
          navs: month30Events.filter(e => e.event === "navigate_click").length,
        },
      };

      // Top navigated trucks
      const truckNavCounts = {};
      navs.forEach(e => { if (e.truck_id) truckNavCounts[e.truck_id] = (truckNavCounts[e.truck_id] || 0) + 1; });
      const topNavTruckIds = Object.entries(truckNavCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      let topNavTrucks = [];
      if (topNavTruckIds.length) {
        const { data: truckData } = await supabase.from("trucks").select("id, name, food_type").in("id", topNavTruckIds.map(([id]) => Number(id)));
        const nameMap = {};
        (truckData || []).forEach(t => { nameMap[t.id] = t; });
        topNavTrucks = topNavTruckIds.map(([id, count]) => ({ id, count, truck: nameMap[id] || null }));
      }

      setStats({
        totalUsers: allUsers.size,
        totalOpens: opens.length,
        totalNavs: navs.length,
        periodCounts,
        topNavTrucks,
        events,
      });
      setLoading(false);
    }
    load();
  }, []);

  const chart = useMemo(() => {
    if (!stats) return [];
    const p = PERIODS[period];
    const numBuckets = period === "daily" ? 14 : period === "weekly" ? 8 : 6;
    return bucketEvents(stats.events, p, numBuckets);
  }, [stats, period]);

  if (loading) return <div className="comments-empty" style={{ padding: 32 }}>Loading analytics…</div>;
  if (!stats) return <div className="comments-empty" style={{ padding: 32 }}>No analytics data yet.</div>;

  const pc = stats.periodCounts[period];
  const periodLabel = period === "daily" ? "Today" : period === "weekly" ? "Last 7 days" : "Last 30 days";
  const maxBar = Math.max(...chart.map(d => Math.max(d.opens, d.navs, d.users, 1)));

  return (
    <div className="admin-analytics">
      <div className="analytics-period-toggle">
        {["daily", "weekly", "monthly"].map(p => (
          <button key={p} className={`filter-btn ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>
            {p === "daily" ? "Daily" : p === "weekly" ? "Weekly" : "Monthly"}
          </button>
        ))}
      </div>

      <div className="analytics-cards">
        <div className="analytics-card">
          <div className="analytics-card-title">Active Users</div>
          <div className="analytics-card-num">{pc.users}</div>
          <div className="analytics-card-sub">
            <span>{periodLabel}</span>
            <span>{stats.totalUsers} all time</span>
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-card-title">App Opens</div>
          <div className="analytics-card-num">{pc.opens}</div>
          <div className="analytics-card-sub">
            <span>{periodLabel}</span>
            <span>{stats.totalOpens} all time</span>
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-card-title">Navigation Clicks</div>
          <div className="analytics-card-num">{pc.navs}</div>
          <div className="analytics-card-sub">
            <span>{periodLabel}</span>
            <span>{stats.totalNavs} all time</span>
          </div>
        </div>
      </div>

      <div className="analytics-section">
        <div className="analytics-section-title">
          {period === "daily" ? "Daily Activity (14 days)" : period === "weekly" ? "Weekly Activity (8 weeks)" : "Monthly Activity (6 months)"}
        </div>
        <div className="analytics-chart">
          {chart.map((d, i) => (
            <div key={i} className="analytics-chart-col">
              <div className="analytics-bars">
                <div className="analytics-bar bar-opens" style={{ height: `${(d.opens / maxBar) * 100}%` }} title={`${d.opens} opens`} />
                <div className="analytics-bar bar-navs" style={{ height: `${(d.navs / maxBar) * 100}%` }} title={`${d.navs} navigations`} />
                <div className="analytics-bar bar-users" style={{ height: `${(d.users / maxBar) * 100}%` }} title={`${d.users} unique users`} />
              </div>
              <div className="analytics-chart-label">{d.label}</div>
            </div>
          ))}
        </div>
        <div className="analytics-legend">
          <span><span className="analytics-legend-dot bar-opens" /> Opens</span>
          <span><span className="analytics-legend-dot bar-navs" /> Navigations</span>
          <span><span className="analytics-legend-dot bar-users" /> Users</span>
        </div>
      </div>

      {stats.topNavTrucks.length > 0 && (
        <div className="analytics-section">
          <div className="analytics-section-title">Top Navigated Trucks</div>
          {stats.topNavTrucks.map((t, i) => (
            <div key={t.id} className="analytics-top-row">
              <span className="analytics-top-rank">#{i + 1}</span>
              <span className="analytics-top-name">{t.truck ? `${getFoodEmoji(t.truck.food_type)} ${t.truck.name}` : `Truck #${t.id}`}</span>
              <span className="analytics-top-count">{t.count} clicks</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Admin Feedback Viewer ────────────────────────────────────────────────── */
export function AdminFeedback({ showToast }) {
  const [feedback, setFeedback] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.from("feedback").select("*").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setFeedback(data); setLoaded(true); });
  }, []);

  async function markRead(id) {
    await supabase.from("feedback").update({ is_read: true }).eq("id", id);
    setFeedback(cur => cur.map(f => f.id === id ? { ...f, is_read: true } : f));
  }

  async function deleteFeedback(id) {
    const { error } = await supabase.from("feedback").delete().eq("id", id);
    if (error) showToast("Failed to delete feedback.");
    else setFeedback(cur => cur.filter(f => f.id !== id));
  }

  return (
    <div className="admin-feedback-tab">
      {!loaded && <div className="comments-empty" style={{ padding: 32 }}>Loading feedback…</div>}
      {loaded && feedback.length === 0 && (
        <div className="list-empty" style={{ margin: 20 }}>
          <div className="empty-icon">💬</div>
          <p>No feedback yet. Users can send feedback from Settings.</p>
        </div>
      )}
      {loaded && feedback.map(f => (
        <div key={f.id} className={`admin-feedback-card ${f.is_read ? "" : "unread"}`}>
          <div className="admin-feedback-body">
            {!f.is_read && <span className="admin-badge pending">New</span>}
            {f.body}
          </div>
          <div className="admin-feedback-meta">
            {timeAgo(f.created_at)} · User {f.user_id?.slice(0, 8)}…
          </div>
          <div className="admin-btn-row">
            {!f.is_read && <button className="btn-admin-action verify" onClick={() => markRead(f.id)}>✓ Read</button>}
            <button className="btn-admin-action delete" onClick={() => deleteFeedback(f.id)}>🗑 Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
