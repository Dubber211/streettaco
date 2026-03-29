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

/* ─── App Defaults ─────────────────────────────────────────────────────────── */
const DEFAULT_CENTER = [41.6764, -86.252];
const DEFAULT_RADIUS_MILES = 1;
const MOBILE_TRUCK_EXPIRATION_HOURS = 48;
const MAX_TRUCKS_PER_DAY = 5;

const STORAGE_KEYS = {
  trucks: "street-taco-trucks",
  userVotes: "street-taco-user-votes",
  radius: "street-taco-radius",
  addHistory: "street-taco-add-history",
  myTruckIds: "street-taco-my-trucks",
  onboarding: "street-taco-onboarding-done",
};

const nowIso = () => new Date().toISOString();

async function reverseGeocodeStreet(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    return data?.address?.road || null;
  } catch { return null; }
}

const FOOD_EMOJIS = {
  tacos: "🌮", taco: "🌮",
  burger: "🍔", burgers: "🍔",
  pizza: "🍕",
  dessert: "🍦", desserts: "🍦", sweets: "🍦", ice: "🍦",
  bbq: "🔥", barbecue: "🔥",
  sushi: "🍱",
  noodle: "🍜", noodles: "🍜",
  hot: "🌭", hotdog: "🌭",
  chicken: "🍗",
  seafood: "🦞", fish: "🐟",
  default: "🚚",
};

function getFoodEmoji(foodType = "") {
  const lower = foodType.toLowerCase();
  for (const [key, emoji] of Object.entries(FOOD_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return FOOD_EMOJIS.default;
}

/* ─── Supabase row → app object ─────────────────────────────────────────────── */
function toAppTruck(row) {
  return {
    id: row.id,
    name: row.name,
    foodType: row.food_type,
    open: row.open,
    votes: row.votes,
    position: [row.lat, row.lng],
    isPermanent: row.is_permanent,
    hours: row.hours || "",
    createdAt: row.created_at,
    lastConfirmedAt: row.last_confirmed_at,
    userId: row.user_id,
    street: row.street || null,
  };
}

/* ─── Custom Icons ──────────────────────────────────────────────────────────── */
const userLocationIcon = L.divIcon({
  html: `<div style="width:16px;height:16px;background:#06b6d4;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(6,182,212,0.3),0 2px 8px rgba(0,0,0,0.4);"></div>`,
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function makeTruckIcon(foodType, isOpen) {
  const emoji = getFoodEmoji(foodType);
  const bg = isOpen ? "#06b6d4" : "#64748b";
  const glow = isOpen ? "0 4px 20px rgba(6,182,212,0.6)" : "0 2px 8px rgba(0,0,0,0.3)";
  return L.divIcon({
    html: `
      <div style="
        position:relative;
        display:flex;align-items:center;justify-content:center;
        width:42px;height:42px;
        background:${bg};
        border:3px solid #fff;
        border-radius:50% 50% 50% 4px;
        box-shadow:${glow};
        font-size:20px;
        cursor:pointer;
        transform:rotate(-5deg);
        transition:transform 0.2s;
      ">${emoji}</div>
    `,
    className: "",
    iconSize: [42, 42],
    iconAnchor: [21, 42],
    popupAnchor: [0, -44],
  });
}

function makePendingIcon() {
  return L.divIcon({
    html: `
      <div style="
        display:flex;align-items:center;justify-content:center;
        width:40px;height:40px;
        background:#06b6d4;
        border:3px solid #fff;
        border-radius:50%;
        box-shadow:0 0 0 6px rgba(6,182,212,0.25),0 4px 16px rgba(6,182,212,0.5);
        font-size:18px;
        animation:pulse-pin 1.4s ease-in-out infinite;
      ">📍</div>
      <style>
        @keyframes pulse-pin {
          0%,100%{transform:scale(1);}
          50%{transform:scale(1.15);}
        }
      </style>
    `,
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -42],
  });
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function readStoredValue(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}

function useLocalStorageState(key, fallback) {
  const [value, setValue] = useState(() => readStoredValue(key, fallback));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue];
}

function haversineMiles([lat1, lon1], [lat2, lon2]) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function milesToMeters(m) { return m * 1609.34; }
function hoursSince(ts) { const t = new Date(ts).getTime(); return isNaN(t) ? Infinity : (Date.now() - t) / 3600000; }
function timeAgo(ts) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}
function isTruckExpired(t) { return t.isPermanent ? false : hoursSince(t.lastConfirmedAt || t.createdAt) > MOBILE_TRUCK_EXPIRATION_HOURS; }
function normalizeTruck(t) { const c = t.createdAt || nowIso(); return { ...t, isPermanent: Boolean(t.isPermanent), hours: t.hours || "", createdAt: c, lastConfirmedAt: t.lastConfirmedAt || c }; }

/* ─── Map Sub-Components ────────────────────────────────────────────────────── */
const RADIUS_OPTIONS = [1, 3, 5, 10, 25];

function FitBoundsToRadius({ center, radiusMiles, skipRef }) {
  const map = useMap();
  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; return; }
    const [lat, lng] = center;
    const R = 3958.8;
    const latDelta = (radiusMiles / R) * (180 / Math.PI);
    const lngDelta = (radiusMiles / (R * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI);
    map.fitBounds(
      [[lat - latDelta, lng - lngDelta], [lat + latDelta, lng + lngDelta]],
      { animate: true }
    );
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

function FocusTruck({ trucks, focusRequest, markerRefs }) {
  const map = useMap();
  useEffect(() => {
    if (!focusRequest) return;
    const truck = trucks.find(t => t.id === focusRequest.id);
    if (!truck) return;
    map.flyTo(truck.position, 15, { animate: true, duration: 0.6 });
    const timer = setTimeout(() => { markerRefs.current[focusRequest.id]?.openPopup(); }, 700);
    return () => clearTimeout(timer);
  }, [focusRequest, trucks, map, markerRefs]);
  return null;
}

function MapClickHandler({ addMode, onPickLocation }) {
  useMapEvents({ click(e) { if (addMode) onPickLocation([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

/* ─── Styles ────────────────────────────────────────────────────────────────── */
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --cyan: #06b6d4;
    --cyan-dark: #0891b2;
    --cyan-glow: rgba(6,182,212,0.35);
    --green: #22c55e;
    --green-dark: #16a34a;
    --red: #ef4444;
    --red-dark: #dc2626;
    --blue: #3b82f6;
    --bg: #0c0d0f;
    --surface: #141618;
    --surface2: #1c1e22;
    --surface3: #242729;
    --border: rgba(255,255,255,0.07);
    --border-accent: rgba(6,182,212,0.3);
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --text-dim: #64748b;
    --radius-sm: 10px;
    --radius-md: 16px;
    --radius-lg: 22px;
    --font-display: 'Syne', sans-serif;
    --font-body: 'DM Sans', sans-serif;
  }

  body {
    background: var(--bg);
    background-image:
      radial-gradient(ellipse 80% 50% at 50% -20%, rgba(6,182,212,0.08) 0%, transparent 60%),
      radial-gradient(ellipse 60% 40% at 80% 80%, rgba(6,182,212,0.04) 0%, transparent 50%);
    min-height: 100vh;
    font-family: var(--font-body);
    color: var(--text);
  }

  .app-shell {
    max-width: 1100px;
    margin: 0 auto;
    padding: 28px 18px 48px;
  }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 28px;
    flex-wrap: wrap;
  }

  .header-logo {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .logo-icon {
    width: 54px; height: 54px;
    background: linear-gradient(135deg, #06b6d4, #0891b2);
    border-radius: 16px;
    display: flex; align-items: center; justify-content: center;
    font-size: 26px;
    box-shadow: 0 8px 24px var(--cyan-glow);
    flex-shrink: 0;
  }

  .logo-text h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
    background: linear-gradient(135deg, #fff 0%, #06b6d4 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .logo-text p {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-top: 4px;
    font-weight: 500;
  }

  .btn-add-truck {
    display: flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(135deg, #06b6d4, #0891b2);
    color: #fff;
    border: none;
    border-radius: var(--radius-md);
    padding: 13px 20px;
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    cursor: pointer;
    box-shadow: 0 6px 20px var(--cyan-glow);
    transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
    white-space: nowrap;
  }

  .btn-add-truck:hover { transform: translateY(-2px); box-shadow: 0 10px 28px var(--cyan-glow); }
  .btn-add-truck:active { transform: translateY(0); }

  /* ── Controls Bar ── */
  .controls-bar {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 16px;
    align-items: center;
  }

  .btn-location {
    display: flex; align-items: center; gap: 7px;
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 11px 16px;
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, opacity 0.15s;
    white-space: nowrap;
  }

  .btn-location:hover:not(:disabled) { background: var(--surface3); border-color: var(--cyan); }
  .btn-location:disabled { opacity: 0.55; cursor: not-allowed; }

  .location-dot {
    width: 8px; height: 8px;
    background: var(--blue);
    border-radius: 50%;
    box-shadow: 0 0 6px rgba(59,130,246,0.6);
    animation: pulse-dot 2s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%,100%{opacity:1;transform:scale(1);}
    50%{opacity:0.5;transform:scale(0.7);}
  }

  .search-form { display: flex; gap: 8px; }

  .input-field {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 11px 14px;
    font-family: var(--font-body);
    font-size: 0.875rem;
    outline: none;
    min-width: 190px;
    transition: border-color 0.15s;
  }

  .input-field::placeholder { color: var(--text-dim); }
  .input-field:focus { border-color: var(--cyan); }

  .btn-go {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 11px 16px;
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn-go:hover { background: var(--surface3); border-color: var(--cyan); }

  .radius-selector {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 11px 14px;
    font-size: 0.875rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .radius-selector select {
    background: transparent;
    color: var(--text);
    border: none;
    outline: none;
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  /* ── Status Bar ── */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.84rem;
    color: var(--text-muted);
  }

  .status-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--cyan);
    flex-shrink: 0;
    box-shadow: 0 0 6px var(--cyan);
    animation: status-blink 2.4s ease-in-out infinite;
  }

  @keyframes status-blink {
    0%,100%{opacity:1;} 50%{opacity:0.3;}
  }

  /* ── Add Truck Panel ── */
  .add-panel {
    margin-bottom: 20px;
    padding: 22px;
    background: var(--surface);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-lg);
    position: relative;
    overflow: hidden;
  }

  .add-panel::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--cyan), #22d3ee, var(--cyan));
    background-size: 200% 100%;
    animation: shimmer 2s linear infinite;
  }

  @keyframes shimmer {
    0%{background-position:200% 0;} 100%{background-position:-200% 0;}
  }

  .add-panel-title {
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 800;
    margin-bottom: 16px;
    color: var(--text);
  }

  /* Waze-style step indicator */
  .add-steps {
    display: flex;
    gap: 0;
    margin-bottom: 22px;
  }

  .step {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: var(--surface2);
    border: 1px solid var(--border);
    position: relative;
  }

  .step:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
  .step:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }

  .step.active {
    background: rgba(6,182,212,0.1);
    border-color: var(--cyan);
    z-index: 1;
  }

  .step.done {
    background: rgba(34,197,94,0.08);
    border-color: rgba(34,197,94,0.3);
  }

  .step-num {
    width: 26px; height: 26px;
    border-radius: 50%;
    background: var(--surface3);
    border: 2px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 800;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .step.active .step-num {
    background: var(--cyan);
    border-color: var(--cyan);
    color: #fff;
    box-shadow: 0 2px 10px var(--cyan-glow);
  }

  .step.done .step-num {
    background: var(--green);
    border-color: var(--green);
    color: #fff;
  }

  .step-label { font-size: 0.82rem; font-weight: 600; color: var(--text-muted); }
  .step.active .step-label { color: var(--text); }
  .step.done .step-label { color: var(--green); }

  .add-form { display: grid; gap: 12px; }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .add-input {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    font-family: var(--font-body);
    font-size: 0.9rem;
    outline: none;
    width: 100%;
    transition: border-color 0.15s;
  }

  .add-input::placeholder { color: var(--text-dim); }
  .add-input:focus { border-color: var(--cyan); }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: border-color 0.15s;
    user-select: none;
  }

  .checkbox-row:hover { border-color: rgba(6,182,212,0.4); }

  .checkbox-row input[type=checkbox] {
    width: 17px; height: 17px;
    accent-color: var(--cyan);
    cursor: pointer;
  }

  .checkbox-label { font-size: 0.875rem; font-weight: 500; }

  .pin-status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
  }

  .pin-status.placed {
    border-color: rgba(34,197,94,0.4);
    background: rgba(34,197,94,0.05);
    color: var(--green);
  }

  .pin-status.waiting { color: var(--text-muted); }

  .expiry-note {
    font-size: 0.8rem;
    color: var(--text-dim);
    padding: 8px 12px;
    background: var(--surface2);
    border-radius: var(--radius-sm);
    border-left: 3px solid var(--cyan);
  }

  .form-actions { display: flex; gap: 10px; }

  .btn-save {
    flex: 1;
    background: linear-gradient(135deg, var(--cyan), var(--cyan-dark));
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    padding: 13px 20px;
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 16px var(--cyan-glow);
    transition: transform 0.15s, box-shadow 0.15s;
  }

  .btn-save:hover { transform: translateY(-2px); box-shadow: 0 8px 24px var(--cyan-glow); }

  .btn-cancel {
    background: var(--surface2);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 13px 18px;
    font-family: var(--font-body);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .btn-cancel:hover { background: var(--surface3); color: var(--text); }

  /* ── Map ── */
  .map-wrapper {
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid var(--border);
    margin-bottom: 20px;
    height: 500px;
    position: relative;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }

  .map-wrapper.add-mode-active { border-color: var(--cyan); box-shadow: 0 0 0 3px var(--cyan-glow), 0 8px 32px rgba(0,0,0,0.4); }

  .add-mode-overlay {
    position: absolute;
    top: 14px; left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: rgba(6,182,212,0.95);
    color: #fff;
    padding: 9px 18px;
    border-radius: 999px;
    font-family: var(--font-display);
    font-size: 0.85rem;
    font-weight: 700;
    pointer-events: none;
    box-shadow: 0 4px 16px rgba(6,182,212,0.5);
    letter-spacing: 0.02em;
    animation: float-badge 2s ease-in-out infinite;
  }

  @keyframes float-badge {
    0%,100%{transform:translateX(-50%) translateY(0);}
    50%{transform:translateX(-50%) translateY(-3px);}
  }

  /* ── Leaflet popup overrides ── */
  .leaflet-popup-content-wrapper {
    background: #1c1e22 !important;
    border: 1px solid rgba(6,182,212,0.25) !important;
    border-radius: 14px !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  .leaflet-popup-content { margin: 0 !important; }
  .leaflet-popup-tip { background: #1c1e22 !important; }
  .leaflet-popup-close-button { color: #94a3b8 !important; top: 10px !important; right: 10px !important; font-size: 16px !important; }

  /* ── Popup card ── */
  .popup-card { padding: 14px 16px; min-width: 210px; font-family: var(--font-body); }

  .popup-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }

  .popup-emoji {
    width: 40px; height: 40px;
    background: rgba(6,182,212,0.15);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
  }

  .popup-name { font-family: var(--font-display); font-size: 1rem; font-weight: 800; color: #f1f5f9; }
  .popup-type { font-size: 0.8rem; color: #94a3b8; margin-top: 2px; }

  .popup-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }

  .badge {
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    display: flex; align-items: center; gap: 4px;
  }

  .badge-open { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.2); }
  .badge-closed { background: rgba(100,116,139,0.2); color: #94a3b8; border: 1px solid rgba(100,116,139,0.2); }
  .badge-perm { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.2); }
  .badge-mobile { background: rgba(6,182,212,0.12); color: #22d3ee; border: 1px solid rgba(6,182,212,0.2); }
  .badge-nearby { background: rgba(34,197,94,0.1); color: #86efac; border: 1px solid rgba(34,197,94,0.15); }

  .popup-meta { font-size: 0.8rem; color: #64748b; margin-bottom: 12px; }
  .popup-meta span { margin-right: 10px; }

  .popup-actions { display: flex; gap: 7px; flex-wrap: wrap; }
  .popup-section-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin-bottom: 5px; }

  .btn-vote {
    flex: 1;
    min-width: 64px;
    border: none;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 5px;
    transition: opacity 0.15s, transform 0.1s;
  }

  .btn-vote:hover:not(:disabled) { transform: scale(1.05); }
  .btn-vote:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-vote-up { background: rgba(34,197,94,0.18); color: #4ade80; }
  .btn-vote-up.voted { background: rgba(34,197,94,0.35); }
  .btn-vote-down { background: rgba(239,68,68,0.18); color: #f87171; }
  .btn-vote-down.voted { background: rgba(239,68,68,0.35); }

  .btn-still-here {
    width: 100%;
    margin-top: 7px;
    background: rgba(59,130,246,0.15);
    color: #93c5fd;
    border: 1px solid rgba(59,130,246,0.2);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-still-here:hover { background: rgba(59,130,246,0.25); }

  /* ── Truck List ── */
  .list-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .list-title {
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--text);
  }

  .list-count {
    background: rgba(6,182,212,0.15);
    color: var(--cyan);
    border: 1px solid rgba(6,182,212,0.2);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .list-empty {
    padding: 32px 20px;
    text-align: center;
    color: var(--text-dim);
  }

  .list-empty .empty-icon { font-size: 2.5rem; margin-bottom: 10px; }
  .list-empty p { font-size: 0.9rem; }

  .truck-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    transition: background 0.15s;
  }

  .truck-card:last-child { border-bottom: none; }
  .truck-card:hover { background: var(--surface2); }

  .truck-card-emoji {
    width: 46px; height: 46px;
    border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px;
    flex-shrink: 0;
  }

  .truck-card-emoji.open { background: rgba(6,182,212,0.15); }
  .truck-card-emoji.closed { background: var(--surface2); }

  .truck-card-info { flex: 1; min-width: 0; }
  .truck-card-name { font-family: var(--font-display); font-size: 0.95rem; font-weight: 700; color: var(--text); }

  .truck-card-sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .truck-card-sub .open-tag { color: #4ade80; }
  .truck-card-sub .closed-tag { color: var(--text-dim); }

  .truck-card-hours { font-size: 0.75rem; color: var(--text-dim); margin-top: 2px; }

  .truck-card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .score-pill {
    background: var(--surface3);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-muted);
    min-width: 48px;
    text-align: center;
  }

  .score-pill.positive { background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.2); color: #4ade80; }
  .score-pill.negative { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); color: #f87171; }

  .icon-btn {
    width: 34px; height: 34px;
    border: none;
    border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
  }

  .icon-btn:hover:not(:disabled) { transform: scale(1.1); }
  .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .icon-btn-up { background: rgba(34,197,94,0.14); color: #4ade80; }
  .icon-btn-up.voted { background: rgba(34,197,94,0.3); }
  .icon-btn-down { background: rgba(239,68,68,0.14); color: #f87171; }
  .icon-btn-down.voted { background: rgba(239,68,68,0.3); }
  .icon-btn-pin { background: rgba(59,130,246,0.14); color: #93c5fd; }
  .icon-btn-del { background: rgba(239,68,68,0.14); color: #f87171; }
  .icon-btn-del:hover:not(:disabled) { background: rgba(239,68,68,0.28); }
  .icon-btn-edit { background: rgba(6,182,212,0.14); color: #22d3ee; }
  .icon-btn-edit:hover:not(:disabled) { background: rgba(6,182,212,0.28); }
  .icon-btn-close { background: rgba(239,68,68,0.14); color: #f87171; font-size: 13px; }
  .icon-btn-close:hover:not(:disabled) { background: rgba(239,68,68,0.28); }

  /* ── Inline edit form ── */
  .truck-card-edit {
    display: grid;
    gap: 8px;
    padding: 12px 18px 14px;
    background: var(--surface2);
    border-bottom: 1px solid var(--border);
  }

  .truck-card-edit .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .truck-card-edit .add-input { font-size: 0.85rem; padding: 9px 12px; }
  .truck-card-edit .checkbox-row { padding: 8px 12px; font-size: 0.85rem; }

  .edit-actions { display: flex; gap: 8px; }

  .btn-edit-save {
    flex: 1;
    background: linear-gradient(135deg, var(--cyan), var(--cyan-dark));
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    padding: 9px 14px;
    font-family: var(--font-display);
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-edit-cancel {
    background: var(--surface3);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 9px 14px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  /* ── List Filters ── */
  .list-filters {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    align-items: center;
  }

  .filter-btn {
    background: var(--surface2);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .filter-btn:hover { border-color: var(--cyan); color: var(--text); }
  .filter-btn.active { background: rgba(6,182,212,0.15); border-color: var(--cyan); color: var(--cyan); }

  .filter-select {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 12px;
    font-family: var(--font-body);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    outline: none;
    transition: border-color 0.15s;
  }

  .filter-select:focus { border-color: var(--cyan); }

  /* ── Toasts ── */
  .toast-container {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 9999;
    pointer-events: none;
    align-items: center;
  }

  .toast {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 10px 22px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text);
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    animation: toast-in 0.2s ease;
    white-space: nowrap;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 600px) {
    .app-shell { padding: 16px 12px 60px; }

    /* Header */
    .header { flex-direction: column; align-items: stretch; gap: 12px; margin-bottom: 16px; }
    .header-logo { gap: 10px; }
    .logo-icon { width: 44px; height: 44px; font-size: 22px; border-radius: 12px; }
    .logo-text h1 { font-size: 1.5rem; }
    .logo-text p { font-size: 0.8rem; }
    .btn-add-truck { justify-content: center; padding: 14px 20px; font-size: 1rem; }

    /* Controls */
    .controls-bar { flex-direction: column; gap: 8px; }
    .controls-bar > * { width: 100%; }
    .search-form { flex: 1; }
    .search-form input { flex: 1; }
    .btn-location { justify-content: center; }
    .radius-selector { justify-content: center; }
    .radius-selector select { flex: 1; }

    /* Map */
    .map-wrapper { height: 320px; border-radius: var(--radius-sm); }

    /* Add panel */
    .form-row { grid-template-columns: 1fr; }
    .add-steps { flex-direction: column; gap: 6px; }
    .step:first-child, .step:last-child { border-radius: var(--radius-sm); }
    .add-panel { padding: 14px; }
    .add-panel-header { font-size: 0.9rem; }
    .btn-save-truck, .btn-cancel { padding: 12px 16px; }

    /* Truck cards — stack actions below info */
    .truck-card { flex-wrap: wrap; padding: 12px 14px; gap: 10px; }
    .truck-card-info { flex: 1; min-width: 0; }
    .truck-card-actions { width: 100%; justify-content: flex-end; gap: 6px; padding-top: 4px; }

    /* List filters */
    .list-filters { gap: 6px; }
    .filter-btn, .filter-select { font-size: 0.75rem; padding: 5px 10px; }

    /* Toast — bottom center on mobile */
    .toast-container { left: 50%; right: auto; transform: translateX(-50%); bottom: 16px; }
    .toast { white-space: normal; text-align: center; max-width: 280px; }
    .onboarding-card { padding: 28px 20px 22px; }
    .onboarding-title { font-size: 1.2rem; }
    .truck-comments { padding: 10px 14px 12px; }
  }

  /* ── Share / Comment icon buttons ── */
  .icon-btn-share { background: rgba(6,182,212,0.12); color: #22d3ee; }
  .icon-btn-share:hover:not(:disabled) { background: rgba(6,182,212,0.25); }
  .icon-btn-comment { background: rgba(148,163,184,0.12); color: #94a3b8; }
  .icon-btn-comment:hover:not(:disabled) { background: rgba(148,163,184,0.22); }
  .icon-btn-comment.active { background: rgba(6,182,212,0.15); color: var(--cyan); }

  /* ── Comments ── */
  .truck-comments {
    background: var(--surface2);
    border-top: 1px solid var(--border);
    padding: 12px 18px 14px;
  }

  .comments-list {
    max-height: 260px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .comment-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .comment-body { font-size: 0.83rem; color: var(--text); line-height: 1.45; }
  .comment-meta { font-size: 0.73rem; color: var(--text-dim); margin-top: 2px; }

  .comment-del {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 2px 5px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .comment-del:hover { color: #f87171; background: rgba(239,68,68,0.1); }

  .comments-empty { font-size: 0.82rem; color: var(--text-dim); text-align: center; padding: 10px 0; }

  .comment-input-row { display: flex; gap: 8px; align-items: flex-end; position: relative; }

  .comment-textarea {
    flex: 1;
    background: var(--surface3);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 9px 12px;
    font-family: var(--font-body);
    font-size: 0.85rem;
    resize: none;
    outline: none;
    min-height: 60px;
    transition: border-color 0.15s;
  }
  .comment-textarea::placeholder { color: var(--text-dim); }
  .comment-textarea:focus { border-color: var(--cyan); }

  .comment-char { font-size: 0.7rem; color: var(--text-dim); align-self: flex-end; padding-bottom: 10px; flex-shrink: 0; }
  .comment-char.near-limit { color: #f87171; }

  .btn-post-comment {
    background: linear-gradient(135deg, var(--cyan), var(--cyan-dark));
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    padding: 9px 14px;
    font-family: var(--font-display);
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
    align-self: flex-end;
  }
  .btn-post-comment:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ── Onboarding Overlay ── */
  .onboarding-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.72);
    backdrop-filter: blur(4px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    animation: fade-in 0.25s ease;
  }

  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

  .onboarding-card {
    background: var(--surface);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-lg);
    padding: 36px 32px 28px;
    max-width: 420px;
    width: 100%;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(6,182,212,0.1);
    text-align: center;
    animation: slide-up 0.3s ease;
  }

  @keyframes slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

  .onboarding-icon { font-size: 3rem; margin-bottom: 14px; line-height: 1; }
  .onboarding-title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: var(--text); margin-bottom: 10px; }
  .onboarding-body { font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 28px; }

  .onboarding-dots { display: flex; justify-content: center; gap: 7px; margin-bottom: 22px; }
  .onboarding-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--surface3); border: 1px solid var(--border); transition: background 0.2s, border-color 0.2s; }
  .onboarding-dot.active { background: var(--cyan); border-color: var(--cyan); box-shadow: 0 0 6px var(--cyan-glow); }

  .btn-onboarding-next {
    width: 100%;
    background: linear-gradient(135deg, var(--cyan), var(--cyan-dark));
    color: #fff;
    border: none;
    border-radius: var(--radius-md);
    padding: 14px 20px;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 6px 20px var(--cyan-glow);
    transition: transform 0.15s, box-shadow 0.15s;
    margin-bottom: 12px;
  }
  .btn-onboarding-next:hover { transform: translateY(-2px); box-shadow: 0 10px 28px var(--cyan-glow); }

  .btn-onboarding-skip {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 0.82rem;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 0.15s;
  }
  .btn-onboarding-skip:hover { color: var(--text-muted); }
`;

/* ─── Inject Styles ─────────────────────────────────────────────────────────── */
/* ─── Onboarding Overlay ────────────────────────────────────────────────────── */
const ONBOARDING_STEPS = [
  { icon: "🗺️", title: "Find trucks near you",    body: "The map shows food trucks in your area. Drag it, zoom in, or enter a city or ZIP code." },
  { icon: "📍", title: "Add a truck you spotted",  body: "Hit \"Add Truck\", drop a pin on the map, fill in the details, and save. You're helping the whole community." },
  { icon: "👍", title: "Vote & confirm trucks",     body: "Upvote trucks that are here, downvote ones that left. Hit \"Still Here\" to reset the expiry timer." },
];

function OnboardingOverlay({ onDismiss }) {
  const [step, setStep] = useState(0);
  const { icon, title, body } = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card">
        <div className="onboarding-icon">{icon}</div>
        <div className="onboarding-title">{title}</div>
        <div className="onboarding-body">{body}</div>
        <div className="onboarding-dots">
          {ONBOARDING_STEPS.map((_, i) => (
            <div key={i} className={`onboarding-dot ${i === step ? "active" : ""}`} />
          ))}
        </div>
        <button className="btn-onboarding-next" onClick={() => isLast ? onDismiss() : setStep(s => s + 1)}>
          {isLast ? "Let's go! 🌮" : "Next"}
        </button>
        <br />
        <button className="btn-onboarding-skip" onClick={onDismiss}>Skip</button>
      </div>
    </div>
  );
}

/* ─── Inject Styles ─────────────────────────────────────────────────────────── */
function StyleInjector() {
  return <style>{css}</style>;
}

/* ─── Header ────────────────────────────────────────────────────────────────── */
function Header({ onStartAddTruck, canAdd, addsRemaining }) {
  return (
    <div className="header">
      <div className="header-logo">
        <div className="logo-icon">🚚</div>
        <div className="logo-text">
          <h1>StreetTaco</h1>
          <p>Find food trucks near you • Community powered</p>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <button className="btn-add-truck" onClick={onStartAddTruck} disabled={!canAdd} style={!canAdd ? { opacity: 0.5, cursor: "not-allowed", boxShadow: "none" } : {}}>
          <span style={{ fontSize: "1.1em" }}>+</span> {canAdd ? "Add Truck" : "Limit Reached"}
        </button>
        {canAdd && addsRemaining <= 2 && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>{addsRemaining} add{addsRemaining !== 1 ? "s" : ""} left today</span>
        )}
      </div>
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

      <div className="radius-selector">
        <span>📏</span>
        <select value={radiusMiles} onChange={e => setRadiusMiles(Number(e.target.value))}>
          {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} mi</option>)}
        </select>
      </div>
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
function AddTruckPanel({ addMode, pendingPin, newTruckName, setNewTruckName, newTruckFood, setNewTruckFood, newTruckOpen, setNewTruckOpen, newTruckPermanent, setNewTruckPermanent, newTruckHours, setNewTruckHours, onSaveTruck, onCancelAddTruck, canAdd, addsRemaining }) {
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
          <div className="step-label">{step1Done ? "Pin placed!" : "Tap map to place pin"}</div>
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
          <input className="add-input" type="text" placeholder="🚚  Truck name…" value={newTruckName} onChange={e => setNewTruckName(e.target.value)} />
          <input className="add-input" type="text" placeholder="🍔  Food type…" value={newTruckFood} onChange={e => setNewTruckFood(e.target.value)} />
        </div>

        <div className="form-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={newTruckOpen} onChange={e => setNewTruckOpen(e.target.checked)} />
            <span className="checkbox-label">🟢 Open right now</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={newTruckPermanent} onChange={e => setNewTruckPermanent(e.target.checked)} />
            <span className="checkbox-label">📌 Permanent spot</span>
          </label>
        </div>

        {newTruckPermanent && (
          <input className="add-input" type="text" placeholder="⏰  Hours (e.g. Mon–Fri 11am–7pm)" value={newTruckHours} onChange={e => setNewTruckHours(e.target.value)} />
        )}

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
function TruckMap({ mapCenter, trucks, radiusMiles, onRadiusChange, addMode, pendingPin, onPickLocation, onVote, onConfirmStillHere, onReportClosed, userVotes, userLocation, focusRequest, onBoundsChange }) {
  const pendingIcon = useMemo(() => makePendingIcon(), []);
  const markerRefs = useRef({});
  const skipFitRef = useRef(false);

  return (
    <div className={`map-wrapper ${addMode ? "add-mode-active" : ""}`}>
      {addMode && <div className="add-mode-overlay">📍 Tap the map to drop a pin</div>}
      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBoundsToRadius center={mapCenter} radiusMiles={radiusMiles} skipRef={skipFitRef} />
        <MapBoundsTracker onBoundsChange={onBoundsChange} />
        <MapZoomRadiusSync radiusMiles={radiusMiles} onRadiusChange={onRadiusChange} skipRef={skipFitRef} />
        <FocusTruck trucks={trucks} focusRequest={focusRequest} markerRefs={markerRefs} />
        <MapClickHandler addMode={addMode} onPickLocation={onPickLocation} />

        {userLocation && (
          <Marker position={userLocation} icon={userLocationIcon}>
            <Popup>
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
              <Popup>
                <div className="popup-card">
                  <div className="popup-header">
                    <div className="popup-emoji">{getFoodEmoji(truck.foodType)}</div>
                    <div>
                      <div className="popup-name">{truck.name}</div>
                      <div className="popup-type">{truck.foodType}</div>
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
                    {truck.isPermanent && truck.hours && <span>⏰ {truck.hours}</span>}
                    {!truck.isPermanent && <span>📍 confirmed {timeAgo(truck.lastConfirmedAt)}</span>}
                  </div>
                  <div className="popup-section-label">Rate the food</div>
                  <div className="popup-actions">
                    <button className={`btn-vote btn-vote-up ${up ? "voted" : ""}`} onClick={() => onVote(truck.id, 1)} disabled={up}>
                      👍 {up ? "Liked" : "Good"}
                    </button>
                    <button className={`btn-vote btn-vote-down ${down ? "voted" : ""}`} onClick={() => onVote(truck.id, -1)} disabled={down}>
                      👎 {down ? "Noted" : "Not great"}
                    </button>
                  </div>
                  <div className="popup-section-label" style={{ marginTop: 8 }}>Is it here right now?</div>
                  <div className="popup-actions">
                    {!truck.isPermanent && (
                      <button className="btn-vote btn-vote-up" onClick={() => onConfirmStillHere(truck.id)}>
                        ✅ Still here
                      </button>
                    )}
                    {truck.open && (
                      <button className="btn-vote btn-vote-down" onClick={() => onReportClosed(truck.id)}>
                        🚫 It's closed
                      </button>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {pendingPin && (
          <Marker position={pendingPin} icon={pendingIcon}>
            <Popup>
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
/* ─── Truck Comments ────────────────────────────────────────────────────────── */
function TruckComments({ truckId, userId }) {
  const [comments, setComments] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("comments")
      .select("id, body, created_at, user_id")
      .eq("truck_id", truckId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setLoadState("error"); return; }
        setComments(data);
        setLoadState("done");
      });
    return () => { cancelled = true; };
  }, [truckId]);

  async function handlePost() {
    const body = draft.trim();
    if (!body || !userId || posting) return;
    setPosting(true);
    const { data, error } = await supabase
      .from("comments")
      .insert({ truck_id: truckId, user_id: userId, body })
      .select()
      .single();
    if (!error) { setComments(cur => [data, ...cur]); setDraft(""); }
    setPosting(false);
  }

  async function handleDelete(commentId) {
    const { error } = await supabase.from("comments").delete().eq("id", commentId).eq("user_id", userId);
    if (!error) setComments(cur => cur.filter(c => c.id !== commentId));
  }

  const nearLimit = draft.length > 240;

  return (
    <div className="truck-comments">
      {loadState === "loading" && <div className="comments-empty">Loading…</div>}
      {loadState === "error"   && <div className="comments-empty">Couldn't load comments.</div>}
      {loadState === "done" && (
        <>
          {comments.length === 0
            ? <div className="comments-empty">No comments yet. Be the first!</div>
            : (
              <div className="comments-list">
                {comments.map(c => (
                  <div className="comment-row" key={c.id}>
                    <div style={{ flex: 1 }}>
                      <div className="comment-body">{c.body}</div>
                      <div className="comment-meta">{timeAgo(c.created_at)}</div>
                    </div>
                    {c.user_id === userId && (
                      <button className="comment-del" onClick={() => handleDelete(c.id)} title="Delete">✕</button>
                    )}
                  </div>
                ))}
              </div>
            )
          }
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
        </>
      )}
    </div>
  );
}

function TruckList({ visibleTrucks, userVotes, onVote, onConfirmStillHere, onReportClosed, myTruckIds, onDeleteTruck, onEditTruck, onFocusTruck, userId, onShareTruck }) {
  const [showOpenOnly, setShowOpenOnly] = useState(false);
  const [foodFilter, setFoodFilter] = useState("");
  const [sortBy, setSortBy] = useState("distance");
  const [editingId, setEditingId] = useState(null);
  const [openCommentsId, setOpenCommentsId] = useState(null);
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
    if (showOpenOnly) list = list.filter(t => t.open);
    if (activeFoodFilter) list = list.filter(t => t.foodType === activeFoodFilter);
    if (sortBy === "votes") list = [...list].sort((a, b) => b.votes - a.votes);
    return list;
  }, [visibleTrucks, showOpenOnly, activeFoodFilter, sortBy]);

  return (
    <div className="list-section">
      <div className="list-header">
        <span className="list-title">Nearby Trucks</span>
        <span className="list-count">{displayed.length} found</span>
      </div>

      <div className="list-filters">
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
                  <input className="add-input" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Truck name…" />
                  <input className="add-input" value={editFood} onChange={e => setEditFood(e.target.value)} placeholder="Food type…" />
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
                  <div className="truck-card-name">{truck.name}</div>
                  <div className="truck-card-sub">
                    {truck.street ? `${truck.foodType} on ${truck.street}` : truck.foodType} &nbsp;·&nbsp;
                    <span className={truck.open ? "open-tag" : "closed-tag"}>{truck.open ? "Open" : "Closed"}</span>
                    &nbsp;·&nbsp; {truck.distance.toFixed(1)} mi
                  </div>
                  <div className="truck-card-hours">
                    {truck.isPermanent
                      ? truck.hours ? `📌 ${truck.hours}` : "📌 Permanent"
                      : `🚚 confirmed ${timeAgo(truck.lastConfirmedAt)}`}
                  </div>
                </div>
                <div className="truck-card-actions">
                  <span className={`score-pill ${truck.votes > 0 ? "positive" : truck.votes < 0 ? "negative" : ""}`}>
                    {truck.votes > 0 ? "▲" : truck.votes < 0 ? "▼" : "–"} {Math.abs(truck.votes)}
                  </span>
                  <button className={`icon-btn icon-btn-up ${up ? "voted" : ""}`} onClick={e => { e.stopPropagation(); onVote(truck.id, 1); }} disabled={up} title="Upvote">▲</button>
                  <button className={`icon-btn icon-btn-down ${down ? "voted" : ""}`} onClick={e => { e.stopPropagation(); onVote(truck.id, -1); }} disabled={down} title="Downvote">▼</button>
                  {!truck.isPermanent && (
                    <button className="icon-btn icon-btn-pin" onClick={e => { e.stopPropagation(); onConfirmStillHere(truck.id); }} title="Still here">📍</button>
                  )}
                  {truck.open && !isMine && (
                    <button className="icon-btn icon-btn-close" onClick={e => { e.stopPropagation(); onReportClosed(truck.id); }} title="Report closed">🚫</button>
                  )}
                  {isMine && (
                    <button className="icon-btn icon-btn-edit" onClick={e => { e.stopPropagation(); startEdit(truck); }} title="Edit">✏️</button>
                  )}
                  {isMine && (
                    <button className="icon-btn icon-btn-del" onClick={e => { e.stopPropagation(); onDeleteTruck(truck.id); }} title="Delete">🗑</button>
                  )}
                  <button className="icon-btn icon-btn-share" onClick={e => { e.stopPropagation(); onShareTruck(truck.id); }} title="Share">🔗</button>
                  <button className={`icon-btn icon-btn-comment ${commentsOpen ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpenCommentsId(v => v === truck.id ? null : truck.id); }} title="Comments">💬</button>
                </div>
              </div>
              {commentsOpen && <TruckComments truckId={truck.id} userId={userId} />}
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
  const [onboardingDone, setOnboardingDone] = useLocalStorageState(STORAGE_KEYS.onboarding, false);
  const [trucks, setTrucks] = useState([]);
  const [userVotes, setUserVotes] = useState({});
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [focusRequest, setFocusRequest] = useState(null);
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

    return () => supabase.removeChannel(channel);
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
    const { error } = await supabase.from("trucks")
      .update({ last_confirmed_at: nowIso() })
      .eq("id", id).eq("is_permanent", false);
    if (error) showToast("Couldn't confirm — try again.");
    else showToast("Truck confirmed as still here ✅");
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
      .eq("id", id);
    if (error) showToast("Couldn't update — try again.");
    else showToast("Truck updated ✅");
  }

  function handleShareTruck(id) {
    const url = `${window.location.origin}${window.location.pathname}?truck=${id}`;
    navigator.clipboard.writeText(url).then(
      () => showToast("Link copied! 🔗"),
      () => showToast("Couldn't copy — share this: " + url)
    );
  }

  async function handleReportClosed(id) {
    const { error } = await supabase.from("trucks").update({ open: false }).eq("id", id);
    if (error) showToast("Couldn't report — try again.");
    else showToast("Marked as closed. Thanks!");
  }

  async function handleDeleteTruck(id) {
    const { error } = await supabase.from("trucks").delete().eq("id", id);
    if (error) showToast("Couldn't delete — try again.");
    else showToast("Truck removed.");
  }

  function resetForm() { setPendingPin(null); setNewTruckName(""); setNewTruckFood(""); setNewTruckOpen(true); setNewTruckPermanent(false); setNewTruckHours(""); }
  function handleStartAddTruck() { setAddMode(true); resetForm(); showToast("Tap the map to drop a pin 📍"); }
  function handleCancelAddTruck() { setAddMode(false); resetForm(); }
  function handlePickLocation(pos) { setPendingPin(pos); showToast("Pin dropped! Fill in the details below."); }

  async function handleSaveTruck(e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = newTruckName.trim(), food = newTruckFood.trim(), hours = newTruckHours.trim();
    if (!canAdd) { showToast(`Daily limit of ${MAX_TRUCKS_PER_DAY} reached. Try again tomorrow.`); return; }
    if (!pendingPin) { showToast("Drop a pin on the map first."); return; }
    if (!name || !food) { showToast("Enter the truck name and food type."); return; }
    if (!userId) { showToast("Still connecting — try again in a moment."); return; }
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const ts = nowIso();
    const street = await reverseGeocodeStreet(pendingPin[0], pendingPin[1]);
    const { error } = await supabase.from("trucks").insert({
      id, name, food_type: food, open: newTruckOpen, votes: 1,
      lat: pendingPin[0], lng: pendingPin[1],
      is_permanent: newTruckPermanent, hours: newTruckPermanent ? hours : "",
      user_id: userId, created_at: ts, last_confirmed_at: ts,
      ...(street ? { street } : {}),
    });
    if (error) { console.error("Save truck error:", error); showToast("Couldn't save truck — try again."); return; }
    setUserVotes(cv => ({ ...cv, [id]: 1 }));
    setAddHistory(cur => [...cur.filter(t => hoursSince(t) < 24), ts]);
    setMapCenter(pendingPin);
    setAddMode(false);
    resetForm();
    showToast(`"${name}" added! Thanks for the tip 🎉`);
  }

  const activeTrucks = useMemo(() =>
    trucks.map(normalizeTruck).filter(t => !isTruckExpired(t)),
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
      <StyleInjector />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "var(--font-display)", fontSize: "1.1rem", color: "var(--text-muted)" }}>
        Loading StreetTaco…
      </div>
    </>
  );

  return (
    <>
      {!onboardingDone && <OnboardingOverlay onDismiss={() => setOnboardingDone(true)} />}
      <StyleInjector />
      <ToastContainer toasts={toasts} />
      <div className="app-shell">
        <Header onStartAddTruck={handleStartAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} />
        <ControlsBar searchText={searchText} setSearchText={setSearchText} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles} onUseMyLocation={handleUseMyLocation} onLocationSearch={handleLocationSearch} locationLoading={locationLoading} />
        <AddTruckPanel addMode={addMode} pendingPin={pendingPin} newTruckName={newTruckName} setNewTruckName={setNewTruckName} newTruckFood={newTruckFood} setNewTruckFood={setNewTruckFood} newTruckOpen={newTruckOpen} setNewTruckOpen={setNewTruckOpen} newTruckPermanent={newTruckPermanent} setNewTruckPermanent={setNewTruckPermanent} newTruckHours={newTruckHours} setNewTruckHours={setNewTruckHours} onSaveTruck={handleSaveTruck} onCancelAddTruck={handleCancelAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} />
        <TruckMap mapCenter={mapCenter} trucks={activeTrucks} radiusMiles={radiusMiles} onRadiusChange={setRadiusMiles} addMode={addMode} pendingPin={pendingPin} onPickLocation={handlePickLocation} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} userVotes={userVotes} userLocation={userLocation} focusRequest={focusRequest} onBoundsChange={setMapBounds} />
        <TruckList visibleTrucks={visibleTrucks} userVotes={userVotes} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} myTruckIds={myTruckIds} onDeleteTruck={handleDeleteTruck} onEditTruck={handleEditTruck} onFocusTruck={id => setFocusRequest(r => ({ id, seq: (r?.seq ?? 0) + 1 }))} userId={userId} onShareTruck={handleShareTruck} />
      </div>
    </>
  );
}

export default App;