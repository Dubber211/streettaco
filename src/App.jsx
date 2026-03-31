import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

import {
  DEFAULT_CENTER, DEFAULT_RADIUS_MILES, MOBILE_TRUCK_EXPIRATION_HOURS,
  MAX_TRUCKS_PER_DAY, RADIUS_OPTIONS, STORAGE_KEYS, MAX_NAME_LENGTH,
  MAX_FOOD_LENGTH, CONFIRM_COOLDOWN_MINUTES, REPORT_COOLDOWN_MINUTES,
  ADD_COOLDOWN_MINUTES, PROXIMITY_KEY, PROXIMITY_RADIUS_MILES,
  DAY_LABELS, TILE_DARK, TILE_LIGHT, ONBOARDING_STEPS,
} from "./constants";

import {
  nowIso, containsProfanity, parseSchedule, isOpenBySchedule,
  formatSchedule, reverseGeocode, getFoodEmoji, toAppTruck,
  userLocationIcon, makeTruckIcon, makePendingIcon, adminPinIcon,
  haversineMiles, milesToMeters, hoursSince, timeAgo,
  isTruckExpired, normalizeTruck,
} from "./utils";

import { useLocalStorageState } from "./hooks";


/* ─── Map Sub-Components ────────────────────────────────────────────────────── */

function FitBoundsToRadius({ center, radiusMiles, skipRef }) {
  const map = useMap();
  const initialRef = useRef(true);
  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; return; }
    const [lat, lng] = center;
    const R = 3958.8;
    const latDelta = (radiusMiles / R) * (180 / Math.PI);
    const lngDelta = (radiusMiles / (R * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI);
    const bounds = [[lat - latDelta, lng - lngDelta], [lat + latDelta, lng + lngDelta]];
    if (initialRef.current) {
      initialRef.current = false;
      // Safari/iOS PWA: container may have 0 height on first render
      setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { animate: false }); }, 150);
      setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { animate: false }); }, 500);
    } else {
      map.fitBounds(bounds, { animate: true });
    }
  }, [center, radiusMiles, map, skipRef]);
  return null;
}

function MapZoomRadiusSync({ radiusMiles, onRadiusChange, skipRef }) {
  const map = useMapEvents({
    zoomend() {
      const bounds = map.getBounds();
      const center = map.getCenter();
      const northMiles = haversineMiles([center.lat, center.lng], [bounds.getNorth(), center.lng]);
      const eastMiles = haversineMiles([center.lat, center.lng], [center.lat, bounds.getEast()]);
      const visibleMiles = Math.min(northMiles, eastMiles);
      const nearest = RADIUS_OPTIONS.reduce((prev, curr) =>
        Math.abs(curr - visibleMiles) < Math.abs(prev - visibleMiles) ? curr : prev
      );
      if (nearest !== radiusMiles) {
        skipRef.current = true;
        onRadiusChange(nearest);
      }
    },
  });
  return null;
}

function ClosePopupOnDrag() {
  const map = useMap();
  useEffect(() => {
    const close = () => map.closePopup();
    map.on("dragstart zoomstart", close);
    return () => map.off("dragstart zoomstart", close);
  }, [map]);
  return null;
}

function MapBoundsTracker({ onBoundsChange }) {
  const map = useMap();
  useEffect(() => {
    const update = () => { const b = map.getBounds(); onBoundsChange({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }); };
    update();
    map.on("moveend zoomend", update);
    return () => map.off("moveend zoomend", update);
  }, [map, onBoundsChange]);
  return null;
}

function FocusTruck({ trucks, focusRequest, markerRefs, zoom = 15 }) {
  const map = useMap();
  const lastSeqRef = useRef(null);
  useEffect(() => {
    if (!focusRequest || focusRequest.seq === lastSeqRef.current) return;
    lastSeqRef.current = focusRequest.seq;
    const truck = trucks.find(t => t.id === focusRequest.id);
    if (!truck) return;
    map.stop();
    map.setView(truck.position, zoom, { animate: true, duration: 0.3 });
    const timer = setTimeout(() => { markerRefs.current[focusRequest.id]?.openPopup(); }, 350);
    return () => clearTimeout(timer);
  }, [focusRequest, trucks, map, markerRefs, zoom]);
  return null;
}

function MapClickHandler({ addMode, onPickLocation }) {
  useMapEvents({ click(e) { if (addMode) onPickLocation([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

function ScheduleInput({ value, onChange }) {
  const blocks = parseSchedule(value) || [{ open: "09:00", close: "17:00", days: [1, 2, 3, 4, 5] }];

  function emit(updated) { onChange(JSON.stringify(updated)); }

  function updateBlock(idx, patch) {
    const updated = blocks.map((b, i) => i === idx ? { ...b, ...patch } : b);
    emit(updated);
  }

  function toggleDay(idx, d) {
    const block = blocks[idx];
    const days = block.days.includes(d) ? block.days.filter(x => x !== d) : [...block.days, d].sort();
    updateBlock(idx, { days });
  }

  function addBlock() {
    const used = blocks.flatMap(b => b.days);
    const available = [0,1,2,3,4,5,6].filter(d => !used.includes(d));
    emit([...blocks, { open: "09:00", close: "17:00", days: available.length ? [available[0]] : [] }]);
  }

  function removeBlock(idx) {
    if (blocks.length <= 1) return;
    emit(blocks.filter((_, i) => i !== idx));
  }

  const usedDays = (idx) => blocks.flatMap((b, i) => i === idx ? [] : b.days);

  return (
    <div className="schedule-input">
      {blocks.map((block, idx) => (
        <div key={idx} className="schedule-block">
          {blocks.length > 1 && <div className="schedule-block-header"><span className="schedule-block-label">Block {idx + 1}</span><button type="button" className="schedule-block-remove" onClick={() => removeBlock(idx)}>✕</button></div>}
          <div className="schedule-days">
            {DAY_LABELS.map((label, i) => {
              const taken = usedDays(idx).includes(i);
              return <button key={i} type="button" className={`schedule-day ${block.days.includes(i) ? "active" : ""}`} disabled={taken} onClick={() => toggleDay(idx, i)}>{label}</button>;
            })}
          </div>
          <div className="schedule-times">
            <label className="schedule-time-label">Open <input type="time" value={block.open} onChange={e => updateBlock(idx, { open: e.target.value })} /></label>
            <label className="schedule-time-label">Close <input type="time" value={block.close} onChange={e => updateBlock(idx, { close: e.target.value })} /></label>
          </div>
        </div>
      ))}
      <button type="button" className="schedule-add-block" onClick={addBlock}>+ Different hours for other days</button>
    </div>
  );
}

function AdminMapClick({ onPick }) {
  useMapEvents({ click(e) { onPick([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

function AdminMapCenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, 16, { animate: true }); }, [center, map]);
  return null;
}

function FitBoundsToTrucks({ trucks }) {
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

function AdminMap({ trucks, focusRequest, addMode, editMode, addPin, onPickLocation }) {
  const markerRefs = useRef({});

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
                    <span className={`badge ${truck.open ? "badge-open" : "badge-closed"}`}>{truck.open ? "● Open" : "○ Closed"}</span>
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
function AdminLoginModal({ onLogin, onClose }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError("");
    const result = await onLogin(email.trim(), password);
    if (result.error) { setError(result.error); setSubmitting(false); }
  }

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card admin-login-card">
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
function AdminPanel({ trucks, onToggleHide, onToggleVerify, onHideComment, onUnhideComment, onDeleteComment, onDeleteTruck, onEditTruck, onReconfirm, onApprove, onReject, onAddTruck, onLogout, showToast }) {
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
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
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

  const missingCount = trucks.filter(t => !t.city || !t.state).length;

  return (
    <div className="admin-panel">
      <div className="admin-bar">
        <span className="admin-bar-title">🔐 Admin Mode</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-admin-logout" style={{ background: "var(--cyan)", color: "#fff", borderColor: "var(--cyan)" }} onClick={() => setShowAddForm(f => !f)}>+ Add Truck</button>
          {missingCount > 0 && (
            <button className="btn-admin-logout" onClick={handleBackfill} disabled={backfilling}>
              {backfilling ? "Backfilling…" : `Backfill (${missingCount})`}
            </button>
          )}
          <button className="btn-admin-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <AdminMap
        trucks={filtered}
        focusRequest={adminFocusRequest}
        addMode={showAddForm}
        editMode={editingId !== null}
        addPin={editingId ? editPin : addPin}
        onPickLocation={pos => {
          if (editingId) { setEditPin(pos); showToast("Pin moved!"); }
          else { setAddPin(pos); showToast("Pin dropped!"); }
        }}
      />

      {showAddForm && (
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
              <button type="submit" className="btn-admin-action verify" disabled={addSearching}>{addSearching ? "…" : "🔍"}</button>
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
            <button className="btn-admin-action" onClick={() => { setShowAddForm(false); setAddPin(null); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="admin-filters">
        <button className={`filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All ({trucks.length})</button>
        <button className={`filter-btn ${filter === "pending" ? "active" : ""}`} onClick={() => setFilter("pending")}>Pending ({trucks.filter(t => !t.isApproved).length})</button>
        <button className={`filter-btn ${filter === "hidden" ? "active" : ""}`} onClick={() => setFilter("hidden")}>Hidden ({trucks.filter(t => t.isHidden).length})</button>
        <button className={`filter-btn ${filter === "unverified" ? "active" : ""}`} onClick={() => setFilter("unverified")}>Unverified ({trucks.filter(t => !t.isVerified && !t.isHidden).length})</button>
        <button className={`filter-btn ${filter === "expired" ? "active" : ""}`} onClick={() => setFilter("expired")}>Expired ({trucks.filter(t => isTruckExpired(t)).length})</button>
      </div>

      <div className="admin-truck-list">
        {filtered.length === 0 && <div className="comments-empty">No trucks match this filter.</div>}
        {grouped.map(([location, locationTrucks]) => (
          <div key={location} className="admin-group">
            <div className="admin-group-header">{location} ({locationTrucks.length})</div>
            {locationTrucks.map(truck => (
          <div key={truck.id} className={`admin-truck-row ${truck.isHidden ? "admin-hidden" : ""}`}>
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
    </div>
  );
}

function AdminComments({ truckId, onHide, onUnhide, onDelete }) {
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

/* ─── Proximity Prompt ─────────────────────────────────────────────────────── */
function getStoredDismissals() {
  try { return JSON.parse(localStorage.getItem(PROXIMITY_KEY) || "{}"); } catch { return {}; }
}

function ProximityPrompt({ userLocation, trucks, onConfirm }) {
  const [prompt, setPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(getStoredDismissals);

  const nearbyTruck = useMemo(() => {
    if (!userLocation || trucks.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const mobileTrucks = trucks.filter(t => !t.isPermanent);
    for (const truck of mobileTrucks) {
      const dist = haversineMiles(userLocation, truck.position);
      if (dist <= PROXIMITY_RADIUS_MILES && !dismissed[`${truck.id}_${today}`]) return truck;
    }
    return null;
  }, [userLocation, trucks, dismissed]);

  useEffect(() => { setPrompt(nearbyTruck); }, [nearbyTruck]);

  function markDone(truckId) {
    const today = new Date().toISOString().slice(0, 10);
    const key = `${truckId}_${today}`;
    const updated = { ...dismissed, [key]: true };
    // Clean old entries
    Object.keys(updated).forEach(k => { if (!k.endsWith(today)) delete updated[k]; });
    setDismissed(updated);
    localStorage.setItem(PROXIMITY_KEY, JSON.stringify(updated));
    setPrompt(null);
  }

  if (!prompt) return null;

  return (
    <div className="proximity-overlay">
      <div className="proximity-prompt">
        <div className="proximity-icon">📍</div>
        <div className="proximity-title">Truck Nearby!</div>
        <div className="proximity-text">Are you near <strong>{prompt.name}</strong>?<br />Help the community — confirm it's still here.</div>
        <div className="proximity-actions">
          <button className="proximity-btn confirm" onClick={() => { onConfirm(prompt.id); markDone(prompt.id); }}>Still here</button>
          <button className="proximity-btn dismiss" onClick={() => markDone(prompt.id)}>Not anymore</button>
        </div>
      </div>
    </div>
  );
}

function OnboardingOverlay({ onDismiss }) {
  const [step, setStep] = useState(0);
  const current = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;
  const isFirst = step === 0;
  const totalSteps = ONBOARDING_STEPS.length;

  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    const cur = ONBOARDING_STEPS[step];
    function measure() {
      if (cur.type === "spotlight" && cur.target) {
        const el = document.querySelector(cur.target);
        if (el) {
          const rect = el.getBoundingClientRect();
          setTargetRect({ top: rect.top - 8, left: rect.left - 8, width: rect.width + 16, height: rect.height + 16 });
        } else {
          setTargetRect(null);
        }
      } else {
        setTargetRect(null);
      }
    }
    measure();
    if (cur.type === "spotlight" && cur.target) {
      const el = document.querySelector(cur.target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step]);

  const eulaStepIndex = ONBOARDING_STEPS.findIndex(s => s.type === "eula");

  function getTooltipStyle() {
    if (!targetRect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    const pad = 16;
    const maxW = Math.min(320, window.innerWidth - 40);
    const belowTop = targetRect.top + targetRect.height + pad;
    const spaceBelow = window.innerHeight - belowTop;
    const spaceAbove = targetRect.top - pad;
    // Center horizontally relative to the highlight, clamped to viewport
    let left = targetRect.left + targetRect.width / 2 - maxW / 2;
    left = Math.max(20, Math.min(left, window.innerWidth - maxW - 20));

    if (spaceBelow >= 200) {
      return { top: belowTop, left, maxWidth: maxW };
    }
    if (spaceAbove >= 200) {
      return { bottom: window.innerHeight - targetRect.top + pad, left, maxWidth: maxW };
    }
    // Fallback: center on screen
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)", maxWidth: maxW };
  }

  // EULA step
  if (current.type === "eula") {
    return (
      <div className="onboarding-backdrop">
        <div className="onboarding-card eula-card">
          <div className="onboarding-icon">{current.icon}</div>
          <div className="onboarding-title">{current.title}</div>
          <div className="eula-scroll">
            <p><strong>Last updated:</strong> March 30, 2026</p>
            <p>By using StreetTaco ("the App"), you agree to the following terms. If you do not agree, please do not use the App.</p>
            <h4>1. Acceptance of Terms</h4>
            <p>By accessing or using StreetTaco, you confirm that you have read, understood, and agree to be bound by this End User License Agreement.</p>
            <h4>2. Use of the App</h4>
            <p>StreetTaco is a community-driven platform for discovering and sharing food truck locations. You agree to use the App only for lawful purposes and in a manner that does not infringe the rights of others.</p>
            <h4>3. User-Generated Content</h4>
            <p>You are solely responsible for any content you submit, including truck listings, votes, comments, and status updates. You agree not to post false, misleading, offensive, or spam content. We reserve the right to remove any content at our discretion.</p>
            <h4>4. No Warranty</h4>
            <p>The App is provided "as is" without warranties of any kind. Food truck locations, hours, and availability are user-reported and may not be accurate. StreetTaco is not responsible for any inaccuracies.</p>
            <h4>5. Limitation of Liability</h4>
            <p>StreetTaco and its creators shall not be liable for any damages arising from your use of the App, including but not limited to inaccurate food truck information, food quality, or service issues.</p>
            <h4>6. Privacy</h4>
            <p>We collect minimal data necessary to operate the App. Location data is used only to show nearby food trucks and is not stored on our servers. Anonymous identifiers are used for voting and spam prevention.</p>
            <h4>7. Changes to Terms</h4>
            <p>We may update this agreement at any time. Continued use of the App after changes constitutes acceptance of the updated terms.</p>
          </div>
          <div className="onboarding-dots">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div key={i} className={`onboarding-dot ${i === step ? "active" : ""}`} />
            ))}
          </div>
          <div className="onboarding-btn-row">
            <button className="btn-onboarding-back" onClick={() => setStep(s => s - 1)}>Back</button>
            <button className="btn-onboarding-next" onClick={() => {
              localStorage.setItem(STORAGE_KEYS.eulaAccepted, JSON.stringify(true));
              setStep(s => s + 1);
            }}>I Accept</button>
          </div>
        </div>
      </div>
    );
  }

  // Modal steps (welcome & finish)
  if (current.type === "modal") {
    return (
      <div className="onboarding-backdrop">
        <div className="onboarding-card">
          <div className="onboarding-icon">{current.icon}</div>
          <div className="onboarding-title">{current.title}</div>
          <div className="onboarding-body">{current.body}</div>
          <div className="onboarding-dots">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div key={i} className={`onboarding-dot ${i === step ? "active" : ""}`} />
            ))}
          </div>
          <div className="onboarding-btn-row">
            {!isFirst && !isLast && <button className="btn-onboarding-back" onClick={() => setStep(s => s - 1)}>Back</button>}
            <button className="btn-onboarding-next" onClick={() => isLast ? onDismiss() : setStep(s => s + 1)}>
              {isLast ? "Let's go!" : isFirst ? "Show me around" : "Next"}
            </button>
          </div>
          {step < eulaStepIndex && <button className="btn-onboarding-skip" onClick={() => setStep(eulaStepIndex)}>Skip</button>}
        </div>
      </div>
    );
  }

  // Spotlight steps
  return (
    <div className="onboarding-spotlight">
      <div className="onboarding-spotlight-bg" onClick={() => setStep(s => s + 1)} />
      {targetRect && (
        <div className="onboarding-highlight" style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }} />
      )}
      <div className="onboarding-tooltip" style={getTooltipStyle()}>
        <div className="onboarding-icon">{current.icon}</div>
        <div className="onboarding-title">{current.title}</div>
        <div className="onboarding-body">{current.body}</div>
        <div className="onboarding-dots">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} className={`onboarding-dot ${i === step ? "active" : ""}`} />
          ))}
        </div>
        <div className="onboarding-btn-row">
          <button className="btn-onboarding-back" onClick={() => setStep(s => s - 1)}>Back</button>
          <button className="btn-onboarding-next" onClick={() => isLast ? onDismiss() : setStep(s => s + 1)}>
            {isLast ? "Let's go!" : "Next"}
          </button>
        </div>
        <button className="btn-onboarding-skip" onClick={() => setStep(eulaStepIndex)}>Skip</button>
      </div>
    </div>
  );
}


/* ─── Header ────────────────────────────────────────────────────────────────── */
function Header({ theme, onToggleTheme }) {
  return (
    <div className="header">
      <div className="header-logo">
        <img className="logo-icon-img" src="/logo.png" alt="StreetTaco" />
        <div className="logo-text">
          <h1>StreetTaco</h1>
          <p>Find food trucks near you • Community powered</p>
        </div>
      </div>
      <button className="btn-theme-toggle" onClick={onToggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    </div>
  );
}

/* ─── Controls Bar ──────────────────────────────────────────────────────────── */
function ControlsBar({ searchText, setSearchText, radiusMiles, setRadiusMiles, onUseMyLocation, onLocationSearch, locationLoading }) {
  return (
    <div className="controls-bar">
      <button className="btn-location" onClick={onUseMyLocation} disabled={locationLoading}>
        {locationLoading ? <span style={{ fontSize: "0.9em" }}>⌛</span> : <span className="location-dot" />}
        {locationLoading ? "Locating…" : "My Location"}
      </button>

      <form className="search-form" onSubmit={onLocationSearch}>
        <input className="input-field" type="text" placeholder="City or ZIP…" value={searchText} onChange={e => setSearchText(e.target.value)} />
        <button className="btn-go" type="submit">Go →</button>
      </form>

    </div>
  );
}

/* ─── Toast Notifications ───────────────────────────────────────────────────── */
function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => <div key={t.id} className="toast">{t.message}</div>)}
    </div>
  );
}

/* ─── Add Truck Panel (Waze-style) ──────────────────────────────────────────── */
function AddTruckPanel({ addMode, pendingPin, newTruckName, setNewTruckName, newTruckFood, setNewTruckFood, newTruckOpen, setNewTruckOpen, newTruckPermanent, setNewTruckPermanent, newTruckHours, setNewTruckHours, onSaveTruck, onCancelAddTruck, canAdd, addsRemaining, onUseMyLocation }) {
  if (!addMode) return null;

  const step1Done = Boolean(pendingPin);
  const step2Active = step1Done;

  return (
    <div className="add-panel">
      <div className="add-panel-title">📍 Report a Truck</div>

      {/* Step Indicator */}
      <div className="add-steps">
        <div className={`step ${step1Done ? "done" : "active"}`}>
          <div className="step-num">{step1Done ? "✓" : "1"}</div>
          <div className="step-label">{step1Done ? "Pin placed!" : "Tap map or use location"}</div>
          {!step1Done && <button className="btn-use-location" onClick={onUseMyLocation}>📍 Use my location</button>}
        </div>
        <div className={`step ${step2Active ? "active" : ""}`}>
          <div className="step-num">2</div>
          <div className="step-label">Fill in truck details</div>
        </div>
        <div className="step">
          <div className="step-num">3</div>
          <div className="step-label">Save &amp; share</div>
        </div>
      </div>

      <div className="add-form">
        <div className="form-row">
          <input className="add-input" type="text" placeholder="🚚  Truck name…" value={newTruckName} maxLength={MAX_NAME_LENGTH} onChange={e => setNewTruckName(e.target.value)} />
          <input className="add-input" type="text" placeholder="🍔  Food type…" value={newTruckFood} maxLength={MAX_FOOD_LENGTH} onChange={e => setNewTruckFood(e.target.value)} />
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={newTruckPermanent} onChange={e => setNewTruckPermanent(e.target.checked)} />
          <span className="checkbox-label">📌 Permanent spot</span>
        </label>

        <div className="schedule-section-label">⏰ Operating Hours (optional)</div>
        <ScheduleInput value={newTruckHours} onChange={setNewTruckHours} />

        <div className={`pin-status ${pendingPin ? "placed" : "waiting"}`}>
          {pendingPin
            ? `✅  Pin at ${pendingPin[0].toFixed(4)}, ${pendingPin[1].toFixed(4)}`
            : "👆  Tap the map to place your pin first"}
        </div>

        <div className="expiry-note">
          {newTruckPermanent
            ? "Permanent spots stay on the map indefinitely."
            : `Mobile trucks expire after ${MOBILE_TRUCK_EXPIRATION_HOURS}h — voting or "Still Here" resets the timer.`}
        </div>

        <div className="form-actions">
          <button className="btn-save" onClick={onSaveTruck} disabled={!canAdd}>
            {canAdd ? "Save Truck 🎉" : `Daily limit reached (${MAX_TRUCKS_PER_DAY}/day)`}
          </button>
          <button className="btn-cancel" onClick={onCancelAddTruck}>Cancel</button>
        </div>
        {canAdd && <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", textAlign: "right" }}>{addsRemaining} add{addsRemaining !== 1 ? "s" : ""} left today</div>}
      </div>
    </div>
  );
}

/* ─── Map ───────────────────────────────────────────────────────────────────── */
function TruckMap({ mapCenter, trucks, radiusMiles, onRadiusChange, addMode, pendingPin, onPickLocation, onVote, userVotes, userLocation, focusRequest, onBoundsChange, onStartAddTruck, canAdd, addsRemaining, theme }) {
  const pendingIcon = useMemo(() => makePendingIcon(), []);
  const markerRefs = useRef({});
  const skipFitRef = useRef(false);

  return (
    <div className={`map-wrapper ${addMode ? "add-mode-active" : ""}`}>
      {!addMode && (
        <div className="map-add-truck-overlay">
          <button className="btn-add-truck" onClick={onStartAddTruck} disabled={!canAdd} style={!canAdd ? { opacity: 0.5, cursor: "not-allowed", boxShadow: "none" } : {}}>
            <span style={{ fontSize: "1.1em" }}>+</span> {canAdd ? "Add Truck" : "Limit Reached"}
          </button>
          {canAdd && addsRemaining <= 2 && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>{addsRemaining} add{addsRemaining !== 1 ? "s" : ""} left today</span>
          )}
        </div>
      )}
      {addMode && <div className="add-mode-overlay">📍 Tap the map to drop a pin</div>}
      <div className="map-radius-overlay">
        <select value={radiusMiles} onChange={e => onRadiusChange(Number(e.target.value))}>
          {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} mi</option>)}
        </select>
      </div>
      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={theme === "light" ? TILE_LIGHT : TILE_DARK}
        />
        <FitBoundsToRadius center={mapCenter} radiusMiles={radiusMiles} skipRef={skipFitRef} />
        <ClosePopupOnDrag />
        <MapBoundsTracker onBoundsChange={onBoundsChange} />
        <MapZoomRadiusSync radiusMiles={radiusMiles} onRadiusChange={onRadiusChange} skipRef={skipFitRef} />
        <FocusTruck trucks={trucks} focusRequest={focusRequest} markerRefs={markerRefs} />
        <MapClickHandler addMode={addMode} onPickLocation={onPickLocation} />

        {userLocation && (
          <Marker position={userLocation} icon={userLocationIcon}>
            <Popup autoPan={false}>
              <div className="popup-card">
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "#f1f5f9" }}>You are here</div>
              </div>
            </Popup>
          </Marker>
        )}
        <Circle center={userLocation || mapCenter} radius={milesToMeters(radiusMiles)} pathOptions={{ color: "#06b6d4", fillColor: "#06b6d4", fillOpacity: 0.06, weight: 1.5, dashArray: "6 4" }} />

        {trucks.map(truck => {
          const ref = userLocation || mapCenter;
          const dist = haversineMiles(ref, truck.position);
          const isNearby = dist <= radiusMiles;
          const up = userVotes[truck.id] === 1;
          const down = userVotes[truck.id] === -1;
          const icon = makeTruckIcon(truck.foodType, truck.open);

          return (
            <Marker key={truck.id} ref={el => { if (el) markerRefs.current[truck.id] = el; }} position={truck.position} icon={icon}>
              <Popup autoPan={false}>
                <div className="popup-card">
                  <div className="popup-header">
                    <div className="popup-emoji">{getFoodEmoji(truck.foodType)}</div>
                    <div>
                      <div className="popup-name">{truck.name}{truck.isVerified && <span title="Verified"> ✅</span>}</div>
                      <div className="popup-type">{truck.street ? `${truck.foodType} on ${truck.street}` : truck.foodType}</div>
                    </div>
                  </div>
                  <div className="popup-badges">
                    <span className={`badge ${truck.open ? "badge-open" : "badge-closed"}`}>{truck.open ? "● Open" : "○ Closed"}</span>
                    <span className={`badge ${truck.isPermanent ? "badge-perm" : "badge-mobile"}`}>{truck.isPermanent ? "📌 Permanent" : "🚚 Mobile"}</span>
                    {isNearby && <span className="badge badge-nearby">📍 Nearby</span>}
                  </div>
                  <div className="popup-meta">
                    <span>⭐ {truck.votes} votes</span>
                    <span>📏 {dist.toFixed(1)} mi</span>
                    {truck.hours && <span>⏰ {formatSchedule(truck.hours)}</span>}
                    {!truck.isPermanent && <span>📍 confirmed {timeAgo(truck.lastConfirmedAt)}</span>}
                  </div>
                  <PopupTopComment truckId={truck.id} />
                  <div className="popup-actions">
                    <button className={`btn-vote btn-vote-up ${up ? "voted" : ""}`} onClick={() => onVote(truck.id, 1)} disabled={up}>
                      😊
                    </button>
                    <button className={`btn-vote btn-vote-down ${down ? "voted" : ""}`} onClick={() => onVote(truck.id, -1)} disabled={down}>
                      😞
                    </button>
                    <button className="btn-vote btn-vote-nav" onClick={() => window.open(`https://maps.google.com/maps?daddr=${truck.position[0]},${truck.position[1]}`, "_blank")}>
                      🧭
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {pendingPin && (
          <Marker position={pendingPin} icon={pendingIcon}>
            <Popup autoPan={false}>
              <div className="popup-card">
                <div style={{ color: "#06b6d4", fontWeight: 700, fontFamily: "var(--font-display)" }}>New truck pin</div>
                <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: 4 }}>Fill in details on the left</div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}

/* ─── Truck List ────────────────────────────────────────────────────────────── */
/* ─── Popup Top Comment ────────────────────────────────────────────────────── */
function PopupTopComment({ truckId }) {
  const [topComment, setTopComment] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("comments")
      .select("body, votes")
      .eq("truck_id", truckId)
      .order("votes", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data?.length) setTopComment(data[0]);
      });
    return () => { cancelled = true; };
  }, [truckId]);

  if (!topComment) return null;
  return (
    <div className="popup-top-comment">
      "{topComment.body}" &nbsp;👍 {topComment.votes}
    </div>
  );
}

/* ─── Truck Comments ────────────────────────────────────────────────────────── */
function TruckComments({ truckId, userId, isAdmin, onAdminHideComment, onAdminDeleteComment }) {
  const [comments, setComments] = useState([]);
  const [commentVotes, setCommentVotes] = useState({});
  const [loadState, setLoadState] = useState("loading");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [sortBy, setSortBy] = useState("top");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("comments").select("id, body, created_at, user_id, votes").eq("truck_id", truckId).limit(50),
      userId ? supabase.from("comment_votes").select("comment_id, vote").eq("user_id", userId) : { data: [] },
    ]).then(([commentsRes, votesRes]) => {
      if (cancelled) return;
      if (commentsRes.error) { setLoadState("error"); return; }
      setComments(commentsRes.data);
      const voteMap = {};
      (votesRes.data || []).forEach(v => { voteMap[v.comment_id] = v.vote; });
      setCommentVotes(voteMap);
      setLoadState("done");
    });
    return () => { cancelled = true; };
  }, [truckId, userId]);

  const userAlreadyCommented = comments.some(c => c.user_id === userId);

  async function handlePost() {
    const body = draft.trim();
    if (!body || !userId || posting || userAlreadyCommented) return;
    if (containsProfanity(body)) { alert("Please keep comments clean."); return; }
    setPosting(true);
    const { data, error } = await supabase
      .from("comments")
      .insert({ truck_id: truckId, user_id: userId, body })
      .select()
      .single();
    if (!error) { setComments(cur => [{ ...data, votes: 0 }, ...cur]); setDraft(""); }
    setPosting(false);
  }

  async function handleCommentVote(commentId, vote) {
    const existing = commentVotes[commentId];
    if (existing === vote) return;

    let delta = vote;
    if (existing) {
      await supabase.from("comment_votes").delete().eq("comment_id", commentId).eq("user_id", userId);
      delta = vote - existing;
    }

    await supabase.from("comment_votes").insert({ comment_id: commentId, user_id: userId, vote });
    const newVotes = (comments.find(c => c.id === commentId)?.votes || 0) + delta;
    await supabase.from("comments").update({ votes: newVotes }).eq("id", commentId);
    setCommentVotes(v => ({ ...v, [commentId]: vote }));
    setComments(cur => cur.map(c => c.id === commentId ? { ...c, votes: c.votes + delta } : c));
  }

  async function handleDelete(commentId) {
    const { error } = await supabase.from("comments").delete().eq("id", commentId).eq("user_id", userId);
    if (!error) setComments(cur => cur.filter(c => c.id !== commentId));
  }

  const sorted = useMemo(() => {
    const copy = [...comments];
    if (sortBy === "top") copy.sort((a, b) => b.votes - a.votes);
    else copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return copy;
  }, [comments, sortBy]);

  const nearLimit = draft.length > 240;

  return (
    <div className="truck-comments">
      {loadState === "loading" && <div className="comments-empty">Loading…</div>}
      {loadState === "error"   && <div className="comments-empty">Couldn't load comments.</div>}
      {loadState === "done" && (
        <>
          {comments.length > 1 && (
            <div className="comment-sort-row">
              <button className={`comment-sort-btn ${sortBy === "top" ? "active" : ""}`} onClick={() => setSortBy("top")}>Top</button>
              <button className={`comment-sort-btn ${sortBy === "new" ? "active" : ""}`} onClick={() => setSortBy("new")}>New</button>
            </div>
          )}
          {comments.length === 0
            ? <div className="comments-empty">No comments yet. Be the first!</div>
            : (
              <div className="comments-list">
                {sorted.map(c => (
                  <div className="comment-row" key={c.id}>
                    <div style={{ flex: 1 }}>
                      <div className="comment-body">{c.body}</div>
                      <div className="comment-vote-row">
                        <button className={`comment-vote-btn ${commentVotes[c.id] === 1 ? "voted-up" : ""}`} onClick={() => handleCommentVote(c.id, 1)}>▲</button>
                        <span className="comment-vote-count">{c.votes}</span>
                        <button className={`comment-vote-btn ${commentVotes[c.id] === -1 ? "voted-down" : ""}`} onClick={() => handleCommentVote(c.id, -1)}>▼</button>
                        <span className="comment-meta" style={{ marginLeft: 6 }}>{timeAgo(c.created_at)}</span>
                      </div>
                    </div>
                    {c.user_id === userId && (
                      <button className="comment-del" onClick={() => handleDelete(c.id)} title="Delete">✕</button>
                    )}
                    {isAdmin && c.user_id !== userId && (
                      <div className="admin-comment-actions">
                        <button className="comment-del" onClick={async () => { const ok = await onAdminHideComment(c.id); if (ok) setComments(cur => cur.filter(x => x.id !== c.id)); }} title="Hide">🚫</button>
                        <button className="comment-del" onClick={async () => { const ok = await onAdminDeleteComment(c.id); if (ok) setComments(cur => cur.filter(x => x.id !== c.id)); }} title="Delete">🗑</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          }
          {userAlreadyCommented
            ? <div className="comments-empty">You've already commented on this truck.</div>
            : (
              <div className="comment-input-row">
                <textarea
                  className="comment-textarea"
                  placeholder={userId ? "Add a comment…" : "Connecting…"}
                  value={draft}
                  maxLength={280}
                  disabled={!userId}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
                />
                <span className={`comment-char ${nearLimit ? "near-limit" : ""}`}>{draft.length}/280</span>
                <button className="btn-post-comment" onClick={handlePost} disabled={posting || !draft.trim() || !userId}>
                  {posting ? "…" : "Post"}
                </button>
              </div>
            )
          }
        </>
      )}
    </div>
  );
}

function TruckList({ visibleTrucks, userVotes, onVote, onConfirmStillHere, onReportClosed, myTruckIds, onDeleteTruck, onEditTruck, onFocusTruck, userId, onShareTruck, favorites, onToggleFavorite, isAdmin, onAdminHideComment, onAdminDeleteComment, onFindNearest }) {
  const [showOpenOnly, setShowOpenOnly] = useState(true);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [foodFilter, setFoodFilter] = useState("");
  const [sortBy, setSortBy] = useState("distance");
  const [editingId, setEditingId] = useState(null);
  const [openCommentsId, setOpenCommentsId] = useState(null);
  const [openVoteId, setOpenVoteId] = useState(null);
  const [openStatusId, setOpenStatusId] = useState(null);
  const [commentCounts, setCommentCounts] = useState({});

  useEffect(() => {
    const ids = visibleTrucks.map(t => t.id);
    if (ids.length === 0) return;
    supabase.from("comments").select("truck_id").in("truck_id", ids)
      .then(({ data }) => {
        if (!data) return;
        const counts = {};
        data.forEach(c => { counts[c.truck_id] = (counts[c.truck_id] || 0) + 1; });
        setCommentCounts(counts);
      });
  }, [visibleTrucks]);

  useEffect(() => {
    if (!openVoteId && !openStatusId) return;
    function handleClick() { setOpenVoteId(null); setOpenStatusId(null); }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openVoteId, openStatusId]);

  const [editName, setEditName] = useState("");
  const [editFood, setEditFood] = useState("");
  const [editOpen, setEditOpen] = useState(true);

  function startEdit(truck) {
    setEditingId(truck.id);
    setEditName(truck.name);
    setEditFood(truck.foodType);
    setEditOpen(truck.open);
  }

  function saveEdit() {
    const name = editName.trim(), foodType = editFood.trim();
    if (!name || !foodType) return;
    if (containsProfanity(name) || containsProfanity(foodType)) { alert("Please keep truck names and food types clean."); return; }
    onEditTruck(editingId, { name, foodType, open: editOpen });
    setEditingId(null);
  }

  const foodTypes = useMemo(() =>
    [...new Set(visibleTrucks.map(t => t.foodType).filter(Boolean))].sort(),
    [visibleTrucks]
  );

  const activeFoodFilter = foodTypes.includes(foodFilter) ? foodFilter : "";

  const displayed = useMemo(() => {
    let list = visibleTrucks;
    if (showFavoritesOnly) list = list.filter(t => favorites.includes(t.id));
    if (showOpenOnly) list = list.filter(t => t.open);
    if (activeFoodFilter) list = list.filter(t => t.foodType === activeFoodFilter);
    if (sortBy === "votes") list = [...list].sort((a, b) => b.votes - a.votes);
    return list;
  }, [visibleTrucks, showOpenOnly, showFavoritesOnly, favorites, activeFoodFilter, sortBy]);

  return (
    <div className="list-section">
      <div className="list-header">
        <span className="list-title">Nearby Trucks</span>
        <span className="list-count">{displayed.length} found</span>
      </div>

      <div className="list-filters">
        <button className={`filter-btn ${showFavoritesOnly ? "active" : ""}`} onClick={() => setShowFavoritesOnly(v => !v)}>
          {showFavoritesOnly ? "❤️" : "🤍"} Favorites
        </button>
        <button className={`filter-btn ${showOpenOnly ? "active" : ""}`} onClick={() => setShowOpenOnly(v => !v)}>
          Open only
        </button>
        <select className="filter-select" value={foodFilter} onChange={e => setFoodFilter(e.target.value)}>
          <option value="">All food</option>
          {foodTypes.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="distance">Nearest first</option>
          <option value="votes">Most voted</option>
        </select>
      </div>

      {displayed.length === 0 ? (
        <div className="list-empty">
          <div className="empty-icon">🔍</div>
          <p>
            {visibleTrucks.length === 0
              ? <>No trucks in this radius yet.<br />Try zooming out or adding one!</>
              : <>No trucks match your filters.<br />Try clearing them.</>}
          </p>
          {onFindNearest && <button className="btn-find-nearest" onClick={onFindNearest}>📍 Find nearest truck</button>}
        </div>
      ) : (
        displayed.map(truck => {
          const up = userVotes[truck.id] === 1;
          const down = userVotes[truck.id] === -1;
          const isMine = myTruckIds.includes(truck.id);
          const isEditing = editingId === truck.id;

          if (isEditing) return (
            <div key={truck.id}>
              <div className="truck-card-edit">
                <div className="form-row">
                  <input className="add-input" value={editName} maxLength={MAX_NAME_LENGTH} onChange={e => setEditName(e.target.value)} placeholder="Truck name…" />
                  <input className="add-input" value={editFood} maxLength={MAX_FOOD_LENGTH} onChange={e => setEditFood(e.target.value)} placeholder="Food type…" />
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={editOpen} onChange={e => setEditOpen(e.target.checked)} />
                  <span className="checkbox-label">🟢 Open right now</span>
                </label>
                <div className="edit-actions">
                  <button className="btn-edit-save" onClick={saveEdit}>Save changes</button>
                  <button className="btn-edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            </div>
          );

          const commentsOpen = openCommentsId === truck.id;

          return (
            <div key={truck.id}>
              <div className="truck-card" onClick={() => onFocusTruck(truck.id)} style={{ cursor: "pointer" }}>
                <div className={`truck-card-emoji ${truck.open ? "open" : "closed"}`}>
                  {getFoodEmoji(truck.foodType)}
                </div>
                <div className="truck-card-info">
                  <div className="truck-card-name">{truck.name}{truck.isVerified && <span className="verified-badge" title="Verified"> ✅</span>} <span className={truck.open ? "open-tag" : "closed-tag"}>{truck.open ? "Open" : "Closed"}</span></div>
                  <div className="truck-card-sub">
                    {truck.street ? `${truck.foodType} on ${truck.street}` : truck.foodType}
                    &nbsp;·&nbsp; {truck.distance.toFixed(1)} mi
                  </div>
                  <div className="truck-card-hours">
                    {truck.isPermanent
                      ? truck.hours ? `📌 ${formatSchedule(truck.hours)}` : "📌 Permanent"
                      : `🚚 confirmed ${timeAgo(truck.lastConfirmedAt)}`}
                    &nbsp;&nbsp;
                    <span className={`score-pill ${truck.votes > 0 ? "positive" : truck.votes < 0 ? "negative" : ""}`}>
                      {truck.votes > 0 ? "▲" : truck.votes < 0 ? "▼" : "–"} {Math.abs(truck.votes)}
                    </span>
                  </div>
                </div>
                <div className="truck-card-actions">
                  <button className={`icon-btn icon-btn-fav ${favorites.includes(truck.id) ? "favorited" : ""}`} onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onToggleFavorite(truck.id); }} title="Favorite">{favorites.includes(truck.id) ? "❤️" : "🤍"}</button>
                  <div style={{ position: "relative" }}>
                    <button className={`icon-btn icon-btn-vote ${up ? "voted-up" : down ? "voted-down" : ""}`} onClick={e => { e.stopPropagation(); setOpenStatusId(null); setOpenVoteId(v => v === truck.id ? null : truck.id); }} title="Vote">
                      {up ? "😊" : down ? "😞" : "🙂"}
                    </button>
                    {openVoteId === truck.id && (
                      <div className="vote-popup" onClick={e => e.stopPropagation()}>
                        <button className={`vote-popup-btn vote-popup-up`} onClick={() => { onVote(truck.id, 1); setOpenVoteId(null); }} disabled={up} title="Upvote">👍</button>
                        <button className={`vote-popup-btn vote-popup-down`} onClick={() => { onVote(truck.id, -1); setOpenVoteId(null); }} disabled={down} title="Downvote">👎</button>
                      </div>
                    )}
                  </div>
                  {isMine && (
                    <button className="icon-btn icon-btn-edit" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); startEdit(truck); }} title="Edit">✏️</button>
                  )}
                  {isMine && (
                    <button className="icon-btn icon-btn-del" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onDeleteTruck(truck.id); }} title="Delete">🗑</button>
                  )}
                  <button className={`icon-btn icon-btn-comment ${commentsOpen ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); setOpenCommentsId(v => v === truck.id ? null : truck.id); }} title="Comments">💬{commentCounts[truck.id] ? <span className="comment-count-badge">{commentCounts[truck.id]}</span> : null}</button>
                  <button className="icon-btn icon-btn-share" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onShareTruck(truck.id); }} title="Share">🔗</button>
                  <button className="icon-btn icon-btn-nav" onClick={e => { e.stopPropagation(); window.open(`https://maps.google.com/maps?daddr=${truck.position[0]},${truck.position[1]}`, "_blank"); }} title="Navigate">🧭</button>
                </div>
              </div>
              {commentsOpen && <TruckComments truckId={truck.id} userId={userId} isAdmin={isAdmin} onAdminHideComment={onAdminHideComment} onAdminDeleteComment={onAdminDeleteComment} />}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ─── Main App ──────────────────────────────────────────────────────────────── */
function App() {
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [mapBounds, setMapBounds] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((message) => {
    const id = Date.now();
    setToasts(cur => [...cur, { id, message }]);
    setTimeout(() => setToasts(cur => cur.filter(t => t.id !== id)), 3000);
  }, []);
  const [radiusMiles, setRadiusMiles] = useLocalStorageState(STORAGE_KEYS.radius, DEFAULT_RADIUS_MILES);
  const [addHistory, setAddHistory] = useLocalStorageState(STORAGE_KEYS.addHistory, []);
  const [confirmHistory, setConfirmHistory] = useLocalStorageState(STORAGE_KEYS.confirmHistory, {});
  const [reportHistory, setReportHistory] = useLocalStorageState(STORAGE_KEYS.reportHistory, {});
  const [onboardingDone, setOnboardingDone] = useLocalStorageState(STORAGE_KEYS.onboarding, false);
  const [theme, setTheme] = useLocalStorageState(STORAGE_KEYS.theme, "dark");
  const [favorites, setFavorites] = useLocalStorageState(STORAGE_KEYS.favorites, []);

  function handleToggleFavorite(id) {
    setFavorites(cur => cur.includes(id) ? cur.filter(f => f !== id) : [...cur, id]);
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }
  const [trucks, setTrucks] = useState([]);
  const [userVotes, setUserVotes] = useState({});
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [focusRequest, setFocusRequest] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const recentAdds = addHistory.filter(ts => hoursSince(ts) < 24);
  const canAdd = recentAdds.length < MAX_TRUCKS_PER_DAY;
  const addsRemaining = MAX_TRUCKS_PER_DAY - recentAdds.length;
  const [addMode, setAddMode] = useState(false);
  const [pendingPin, setPendingPin] = useState(null);
  const [newTruckName, setNewTruckName] = useState("");
  const [newTruckFood, setNewTruckFood] = useState("");
  const [newTruckOpen, setNewTruckOpen] = useState(true);
  const [newTruckPermanent, setNewTruckPermanent] = useState(false);
  const [newTruckHours, setNewTruckHours] = useState("");

  const myTruckIds = useMemo(() =>
    trucks.filter(t => t.userId === userId).map(t => t.id),
    [trucks, userId]
  );

  // Auth + initial data load + realtime
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      let uid = session?.user?.id;
      if (!uid) {
        const { data, error: authErr } = await supabase.auth.signInAnonymously();
        if (authErr) console.error("Anonymous auth failed:", authErr.message);
        uid = data?.user?.id;
      }
      setUserId(uid);

      const { data: truckRows, error: truckErr } = await supabase.from("trucks").select("*");
      if (truckErr) console.error("Failed to load trucks:", truckErr.message);
      if (truckRows) setTrucks(truckRows.map(toAppTruck));

      if (uid) {
        const { data: voteRows } = await supabase.from("user_votes").select("truck_id, vote").eq("user_id", uid);
        if (voteRows) {
          const votes = {};
          voteRows.forEach(v => { votes[v.truck_id] = v.vote; });
          setUserVotes(votes);
        }
      }
      // Check for admin trigger in URL (supports both ?admin and #admin)
      if (window.location.hash === "#admin" || new URLSearchParams(window.location.search).has("admin")) {
        setShowAdminLogin(true);
      }

      setLoading(false);
    }
    init();

    const channel = supabase.channel("trucks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "trucks" }, payload => {
        if (payload.eventType === "INSERT")
          setTrucks(cur => cur.find(t => t.id === payload.new.id) ? cur : [...cur, toAppTruck(payload.new)]);
        else if (payload.eventType === "UPDATE")
          setTrucks(cur => cur.map(t => t.id === payload.new.id ? toAppTruck(payload.new) : t));
        else if (payload.eventType === "DELETE")
          setTrucks(cur => cur.filter(t => t.id !== payload.old.id));
      })
      .subscribe();

    // Polling fallback in case realtime websocket fails
    const poll = setInterval(async () => {
      const { data } = await supabase.from("trucks").select("*");
      if (data) setTrucks(data.map(toAppTruck));
    }, 30000);

    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, []);

  function applyUserLocation(lat, lng, msg = "Centered on your location.") {
    const loc = [lat, lng];
    setUserLocation(loc);
    setMapCenter(loc);
    showToast(msg);
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) { showToast("Geolocation not supported. Using South Bend."); setMapCenter(DEFAULT_CENTER); return; }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => { applyUserLocation(pos.coords.latitude, pos.coords.longitude); setLocationLoading(false); },
      err => {
        setLocationLoading(false);
        const msgs = { [err.PERMISSION_DENIED]: "Location denied.", [err.TIMEOUT]: "Location timed out." };
        showToast((msgs[err.code] || "Couldn't get location.") + " Using South Bend.");
        setMapCenter(DEFAULT_CENTER);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  useEffect(() => { handleUseMyLocation(); }, []);

  async function handleLocationSearch(e) {
    e.preventDefault();
    const q = searchText.trim();
    if (!q) { showToast("Enter a city or ZIP first."); return; }
    try {
      const params = new URLSearchParams({ format: "jsonv2", limit: "1" });
      /^\d{5}$/.test(q) ? (params.set("postalcode", q), params.set("countrycodes", "us")) : params.set("q", q);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data.length) { showToast("No location found."); return; }
      setUserLocation(null);
      setMapCenter([Number(data[0].lat), Number(data[0].lon)]);
      showToast(`Centered on ${q}.`);
    } catch { showToast("Location lookup failed."); }
  }

  async function handleConfirmStillHere(id) {
    const lastConfirm = confirmHistory[id];
    if (lastConfirm && (Date.now() - new Date(lastConfirm).getTime()) / 60000 < CONFIRM_COOLDOWN_MINUTES) {
      showToast("You already confirmed this truck recently. Try again later.");
      return;
    }
    const { error } = await supabase.from("trucks")
      .update({ last_confirmed_at: nowIso() })
      .eq("id", id).eq("is_permanent", false);
    if (error) showToast("Couldn't confirm — try again.");
    else {
      setConfirmHistory(h => ({ ...h, [id]: nowIso() }));
      showToast("Truck confirmed as still here ✅");
    }
  }

  async function handleVote(id, vote) {
    const existing = userVotes[id];
    if (existing === vote) return;
    const delta = existing === undefined ? vote : vote - existing;
    // Optimistic update
    setTrucks(cur => cur.map(t => t.id !== id ? t : { ...t, votes: Math.max(0, t.votes + delta) }));
    setUserVotes(cv => ({ ...cv, [id]: vote }));
    const { error } = await supabase.rpc("vote_truck", { p_truck_id: id, p_vote: vote });
    if (error) {
      // Revert
      setTrucks(cur => cur.map(t => t.id !== id ? t : { ...t, votes: Math.max(0, t.votes - delta) }));
      setUserVotes(cv => ({ ...cv, [id]: existing }));
      showToast("Vote failed — try again.");
    } else {
      showToast(vote === 1 ? "Upvoted! 🙌" : "Downvoted.");
    }
  }

  async function handleEditTruck(id, updates) {
    const { error } = await supabase.from("trucks")
      .update({ name: updates.name, food_type: updates.foodType, open: updates.open })
      .eq("id", id).eq("user_id", userId);
    if (error) showToast("Couldn't update — try again.");
    else showToast("Truck updated ✅");
  }

  function handleFindNearest() {
    const ref = userLocation || mapCenter;
    const withDist = activeTrucks.map(t => ({ ...t, dist: haversineMiles(ref, t.position) }));
    if (withDist.length === 0) { showToast("No trucks found anywhere yet."); return; }
    withDist.sort((a, b) => a.dist - b.dist);
    const nearest = withDist[0];
    setFocusRequest(r => ({ id: nearest.id, seq: (r?.seq ?? 0) + 1 }));
    showToast(`Nearest truck: ${nearest.name} (${nearest.dist.toFixed(1)} mi)`);
  }

  function handleShareTruck(id) {
    const url = `${window.location.origin}${window.location.pathname}?truck=${id}`;
    navigator.clipboard.writeText(url).then(
      () => showToast("Link copied! 🔗"),
      () => showToast("Couldn't copy — share this: " + url)
    );
  }

  async function handleReportClosed(id) {
    const lastReport = reportHistory[id];
    if (lastReport && (Date.now() - new Date(lastReport).getTime()) / 60000 < REPORT_COOLDOWN_MINUTES) {
      showToast("You already reported this truck recently. Try again later.");
      return;
    }
    const { error } = await supabase.from("trucks").update({ open: false }).eq("id", id);
    if (error) showToast("Couldn't report — try again.");
    else {
      setReportHistory(h => ({ ...h, [id]: nowIso() }));
      showToast("Marked as closed. Thanks!");
    }
  }

  async function handleDeleteTruck(id) {
    const { error } = await supabase.from("trucks").delete().eq("id", id).eq("user_id", userId);
    if (error) showToast("Couldn't delete — try again.");
    else showToast("Truck removed.");
  }

  function resetForm() { setPendingPin(null); setNewTruckName(""); setNewTruckFood(""); setNewTruckOpen(true); setNewTruckPermanent(false); setNewTruckHours(""); }
  function handleStartAddTruck() { setAddMode(true); resetForm(); showToast("Tap the map to drop a pin 📍"); }
  function handleCancelAddTruck() { setAddMode(false); resetForm(); }
  function handlePickLocation(pos) { setPendingPin(pos); showToast("Pin dropped! Fill in the details below."); }
  function handleUseLocationForPin() {
    if (!navigator.geolocation) { showToast("Geolocation not supported."); return; }
    showToast("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      pos => { setPendingPin([pos.coords.latitude, pos.coords.longitude]); showToast("Location set! Fill in the details below."); },
      () => { showToast("Couldn't get location. Try tapping the map instead."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleSaveTruck(e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = newTruckName.trim(), food = newTruckFood.trim(), hours = newTruckHours.trim();
    if (!canAdd) { showToast(`Daily limit of ${MAX_TRUCKS_PER_DAY} reached. Try again tomorrow.`); return; }
    const lastAdd = addHistory.filter(ts => hoursSince(ts) < 24).sort().pop();
    if (lastAdd && (Date.now() - new Date(lastAdd).getTime()) / 60000 < ADD_COOLDOWN_MINUTES) {
      const minsLeft = Math.ceil(ADD_COOLDOWN_MINUTES - (Date.now() - new Date(lastAdd).getTime()) / 60000);
      showToast(`Please wait ${minsLeft} min before adding another truck.`);
      return;
    }
    if (!pendingPin) { showToast("Drop a pin on the map first."); return; }
    if (!name || !food) { showToast("Enter the truck name and food type."); return; }
    if (containsProfanity(name) || containsProfanity(food)) { showToast("Please keep truck names and food types clean."); return; }
    if (trucks.some(t => t.name.toLowerCase() === name.toLowerCase())) { showToast(`"${name}" already exists!`); return; }
    if (!userId) { showToast("Still connecting — try again in a moment."); return; }
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const ts = nowIso();
    const geo = await reverseGeocode(pendingPin[0], pendingPin[1]);
    const { error } = await supabase.from("trucks").insert({
      id, name, food_type: food, open: isOpenBySchedule(hours) ?? true, votes: 1,
      lat: pendingPin[0], lng: pendingPin[1],
      is_permanent: newTruckPermanent, hours: hours || "",
      user_id: userId, created_at: ts, last_confirmed_at: ts, is_approved: false,
      ...(geo.street ? { street: geo.street } : {}),
      ...(geo.city ? { city: geo.city } : {}),
      ...(geo.state ? { state: geo.state } : {}),
    });
    if (error) { console.error("Save truck error:", error); showToast("Couldn't save truck — try again."); return; }
    setUserVotes(cv => ({ ...cv, [id]: 1 }));
    setAddHistory(cur => [...cur.filter(t => hoursSince(t) < 24), ts]);
    setMapCenter(pendingPin);
    setAddMode(false);
    resetForm();
    showToast(`"${name}" submitted! It'll appear after admin review.`);
  }

  // ── Admin auth ──
  async function handleAdminLogin(email, password) {
    await supabase.auth.signOut();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      await supabase.auth.signInAnonymously();
      return { error: error.message };
    }
    const { data: adminRow } = await supabase.from("admin_users").select("id").eq("id", data.user.id).single();
    if (!adminRow) {
      await supabase.auth.signOut();
      await supabase.auth.signInAnonymously();
      return { error: "Not an admin account." };
    }
    setUserId(data.user.id);
    setIsAdmin(true);
    setShowAdminLogin(false);
    setAdminView(true);
    document.title = "StreetTaco Admin";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f59e0b");
    document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/manifest-admin.json");
    const { data: truckRows } = await supabase.from("trucks").select("*");
    if (truckRows) setTrucks(truckRows.map(toAppTruck));
    return { error: null };
  }

  async function handleAdminLogout() {
    await supabase.auth.signOut();
    const { data } = await supabase.auth.signInAnonymously();
    setUserId(data?.user?.id || null);
    setIsAdmin(false);
    setAdminView(false);
    document.title = "StreetTaco";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#06b6d4");
    document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/manifest.json");
    const { data: truckRows } = await supabase.from("trucks").select("*");
    if (truckRows) setTrucks(truckRows.map(toAppTruck));
  }

  // ── Admin actions ──
  async function handleToggleHideTruck(id, currentlyHidden) {
    const { error } = await supabase.from("trucks").update({ is_hidden: !currentlyHidden }).eq("id", id);
    if (error) showToast("Failed to update truck visibility.");
    else {
      setTrucks(cur => cur.map(t => t.id === id ? { ...t, isHidden: !currentlyHidden } : t));
      showToast(currentlyHidden ? "Truck restored." : "Truck hidden.");
    }
  }

  async function handleToggleVerifyTruck(id, currentlyVerified) {
    const { error } = await supabase.from("trucks").update({ is_verified: !currentlyVerified }).eq("id", id);
    if (error) showToast("Failed to update verification.");
    else {
      setTrucks(cur => cur.map(t => t.id === id ? { ...t, isVerified: !currentlyVerified } : t));
      showToast(currentlyVerified ? "Verification removed." : "Truck verified!");
    }
  }

  async function handleAdminHideComment(commentId) {
    const { error } = await supabase.from("comments").update({ is_hidden: true }).eq("id", commentId);
    if (error) showToast("Failed to hide comment.");
    else showToast("Comment hidden.");
    return !error;
  }

  async function handleAdminUnhideComment(commentId) {
    const { error } = await supabase.from("comments").update({ is_hidden: false }).eq("id", commentId);
    if (error) showToast("Failed to unhide comment.");
    else showToast("Comment restored.");
    return !error;
  }

  async function handleAdminDeleteComment(commentId) {
    const { error } = await supabase.from("comments").delete().eq("id", commentId);
    if (error) showToast("Failed to delete comment.");
    else showToast("Comment deleted.");
    return !error;
  }

  async function handleAdminAddTruck({ name, food, open, isPermanent, hours, lat, lng }) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const ts = nowIso();
    const geo = await reverseGeocode(lat, lng);
    const { error } = await supabase.from("trucks").insert({
      id, name, food_type: food, open, votes: 1,
      lat, lng, is_permanent: isPermanent, hours: isPermanent ? hours : "",
      user_id: userId, created_at: ts, last_confirmed_at: ts,
      ...(geo.street ? { street: geo.street } : {}),
      ...(geo.city ? { city: geo.city } : {}),
      ...(geo.state ? { state: geo.state } : {}),
    });
    if (error) { showToast("Failed to add truck."); return; }
    showToast(`"${name}" added!`);
  }

  async function handleAdminApprove(id) {
    const { error } = await supabase.from("trucks").update({ is_approved: true }).eq("id", id);
    if (error) showToast("Failed to approve.");
    else {
      setTrucks(cur => cur.map(t => t.id === id ? { ...t, isApproved: true } : t));
      showToast("Truck approved ✅");
    }
  }

  async function handleAdminReject(id) {
    if (!window.confirm("Reject and permanently delete this truck?")) return;
    const { error } = await supabase.from("trucks").delete().eq("id", id);
    if (error) showToast("Failed to reject.");
    else {
      setTrucks(cur => cur.filter(t => t.id !== id));
      showToast("Truck rejected and removed.");
    }
  }

  async function handleAdminReconfirm(id) {
    const { error } = await supabase.from("trucks").update({ last_confirmed_at: nowIso() }).eq("id", id);
    if (error) showToast("Failed to re-confirm.");
    else {
      setTrucks(cur => cur.map(t => t.id === id ? { ...t, lastConfirmedAt: nowIso() } : t));
      showToast("Truck re-confirmed ✅");
    }
  }

  async function handleAdminEditTruck(id, updates) {
    const geo = await reverseGeocode(updates.lat, updates.lng);
    const { error } = await supabase.from("trucks").update({
      name: updates.name, food_type: updates.foodType, open: updates.open,
      hours: updates.hours || "", is_permanent: updates.isPermanent,
      lat: updates.lat, lng: updates.lng,
      ...(geo.street ? { street: geo.street } : {}),
      ...(geo.city ? { city: geo.city } : {}),
      ...(geo.state ? { state: geo.state } : {}),
    }).eq("id", id);
    if (error) showToast("Failed to update truck.");
    else {
      setTrucks(cur => cur.map(t => t.id === id ? {
        ...t, name: updates.name, foodType: updates.foodType, open: updates.open,
        hours: updates.hours, isPermanent: updates.isPermanent,
        position: [updates.lat, updates.lng],
        street: geo.street || t.street, city: geo.city || t.city, state: geo.state || t.state,
      } : t));
      showToast("Truck updated ✅");
    }
  }

  async function handleAdminDeleteTruck(id) {
    const { error } = await supabase.from("trucks").delete().eq("id", id);
    if (error) showToast("Failed to delete truck.");
    else {
      setTrucks(cur => cur.filter(t => t.id !== id));
      showToast("Truck permanently deleted.");
    }
  }

  const activeTrucks = useMemo(() =>
    trucks.map(normalizeTruck).filter(t => !isTruckExpired(t) && !t.isHidden && t.isApproved).map(t => {
      const scheduleOpen = isOpenBySchedule(t.hours);
      return scheduleOpen !== null ? { ...t, open: scheduleOpen } : t;
    }),
    [trucks]
  );

  // Deep-link: ?truck=<id> focuses that truck on load
  const urlParsedRef = useRef(false);
  useEffect(() => {
    if (loading || urlParsedRef.current) return;
    urlParsedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const truckId = Number(params.get("truck"));
    if (!truckId) return;
    const match = activeTrucks.find(t => t.id === truckId);
    if (match) {
      setFocusRequest({ id: truckId, seq: 1 });
      showToast(`Jumped to ${match.name} 📍`);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [loading, activeTrucks, showToast]);

  const visibleTrucks = useMemo(() => {
    const ref = userLocation || mapCenter;
    return activeTrucks
      .map(t => ({ ...t, distance: haversineMiles(ref, t.position) }))
      .filter(t => !mapBounds || (
        t.position[0] <= mapBounds.north && t.position[0] >= mapBounds.south &&
        t.position[1] <= mapBounds.east  && t.position[1] >= mapBounds.west
      ))
      .sort((a, b) => a.distance - b.distance || b.votes - a.votes);
  }, [activeTrucks, mapBounds, mapCenter, userLocation]);

  if (loading) return (
    <>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "var(--font-display)", fontSize: "1.1rem", color: "var(--text-muted)" }}>
        Loading StreetTaco…
      </div>
    </>
  );

  return (
    <>
      {showAdminLogin && <AdminLoginModal onLogin={handleAdminLogin} onClose={() => setShowAdminLogin(false)} />}
      {!onboardingDone && !adminView && !showAdminLogin && <OnboardingOverlay onDismiss={() => setOnboardingDone(true)} />}

      <ToastContainer toasts={toasts} />
      {adminView ? (
        <AdminPanel
          trucks={trucks.map(normalizeTruck)}
          onToggleHide={handleToggleHideTruck}
          onToggleVerify={handleToggleVerifyTruck}
          onHideComment={handleAdminHideComment}
          onUnhideComment={handleAdminUnhideComment}
          onDeleteComment={handleAdminDeleteComment}
          onDeleteTruck={handleAdminDeleteTruck}
          onEditTruck={handleAdminEditTruck}
          onReconfirm={handleAdminReconfirm}
          onApprove={handleAdminApprove}
          onReject={handleAdminReject}
          onAddTruck={handleAdminAddTruck}
          onLogout={handleAdminLogout}
          showToast={showToast}
        />
      ) : (
        <div className="app-shell">
          <Header theme={theme} onToggleTheme={toggleTheme} />
          <ControlsBar searchText={searchText} setSearchText={setSearchText} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles} onUseMyLocation={handleUseMyLocation} onLocationSearch={handleLocationSearch} locationLoading={locationLoading} />
          <AddTruckPanel addMode={addMode} pendingPin={pendingPin} newTruckName={newTruckName} setNewTruckName={setNewTruckName} newTruckFood={newTruckFood} setNewTruckFood={setNewTruckFood} newTruckOpen={newTruckOpen} setNewTruckOpen={setNewTruckOpen} newTruckPermanent={newTruckPermanent} setNewTruckPermanent={setNewTruckPermanent} newTruckHours={newTruckHours} setNewTruckHours={setNewTruckHours} onSaveTruck={handleSaveTruck} onCancelAddTruck={handleCancelAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} onUseMyLocation={handleUseLocationForPin} />
          <TruckMap mapCenter={mapCenter} trucks={activeTrucks} radiusMiles={radiusMiles} onRadiusChange={setRadiusMiles} addMode={addMode} pendingPin={pendingPin} onPickLocation={handlePickLocation} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} userVotes={userVotes} userLocation={userLocation} focusRequest={focusRequest} onBoundsChange={setMapBounds} onStartAddTruck={handleStartAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} theme={theme} />
          <ProximityPrompt userLocation={userLocation} trucks={activeTrucks} onConfirm={handleConfirmStillHere} />
          <TruckList visibleTrucks={visibleTrucks} userVotes={userVotes} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} myTruckIds={myTruckIds} onDeleteTruck={handleDeleteTruck} onEditTruck={handleEditTruck} onFocusTruck={id => setFocusRequest(r => ({ id, seq: (r?.seq ?? 0) + 1 }))} userId={userId} onShareTruck={handleShareTruck} favorites={favorites} onToggleFavorite={handleToggleFavorite} isAdmin={isAdmin} onAdminHideComment={handleAdminHideComment} onAdminDeleteComment={handleAdminDeleteComment} onFindNearest={handleFindNearest} />
        </div>
      )}
    </>
  );
}

export default App;