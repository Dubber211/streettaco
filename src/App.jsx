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
  onboarding: "street-taco-onboarding-v3",
  theme: "street-taco-theme",
  favorites: "street-taco-favorites",
  confirmHistory: "street-taco-confirm-history",
  reportHistory: "street-taco-report-history",
  eulaAccepted: "street-taco-eula-accepted",
};

const MAX_NAME_LENGTH = 40;
const MAX_FOOD_LENGTH = 30;
const CONFIRM_COOLDOWN_MINUTES = 30;
const REPORT_COOLDOWN_MINUTES = 30;
const ADD_COOLDOWN_MINUTES = 15;

const nowIso = () => new Date().toISOString();

/* ─── Profanity Filter ─────────────────────────────────────────────────────── */
const BLOCKED_WORDS = [
  "ass","asshole","assholes","bastard","bastards","bitch","bitches","bitchy",
  "blowjob","blowjobs","boner","boob","boobs","bullshit","butt","butthole",
  "cock","cocks","cocksucker","coon","coons","cum","cumming","cunt","cunts",
  "damn","damned","damnit","dick","dicks","dickhead","dildo","dildos",
  "douche","douchebag","dumbass","dyke",
  "fag","fags","faggot","faggots","felch","fuck","fucked","fucker","fuckers",
  "fuckface","fucking","fuckoff","fucks","fuckwit",
  "goddamn","goddamnit","gringo","handjob",
  "hell","ho","hoe","hooker","hookers","horny","humping",
  "jackass","jackoff","jerkoff","jizz",
  "kike","kinky","kkk",
  "lmao","lmfao",
  "meth","milf","mofo","motherfucker","motherfuckers","motherfucking",
  "negro","nigga","niggas","nigger","niggers","nig","nipple","nipples","nutsack",
  "orgasm","orgy",
  "paki","pecker","penis","penises","piss","pissed","pissing","porn","porno",
  "prostitute","prostitutes","pube","pubes","pubic","pussy","pussies",
  "queer",
  "rape","raped","raping","rapist","rectum","retard","retarded","rimjob",
  "schlong","scrotum","semen","sex","sexo","sexy","shit","shits","shithead",
  "shitty","shitting","skank","skanky","slut","sluts","slutty","smegma",
  "snatch","spic","spick","spunk","stfu",
  "testicle","testicles","tit","tits","titties","titty","twat","twats",
  "vagina","viagra","vulva",
  "wang","wank","wanker","whore","whores","wtf",
  // Drugs
  "cocaine","coke","crack","crackhead","heroin","heroine","meth","methhead",
  "amphetamine","amphetamines","molly","ecstasy","mdma","lsd","acid",
  "shrooms","mushrooms","weed","marijuana","stoner","pothead","blunt","dope",
  "dopehead","junkie","junkies","oxy","oxycontin","fentanyl","ketamine",
  "xanax","adderall","percocet","vicodin","codeine","opium","narcotic",
  "narcotics","druggie","druggies","crackpipe","bong","edibles",
  // Slurs & hate speech
  "beaner","beaners","chink","chinks","chinky","coolie","darkie","darkies",
  "gook","gooks","gringo","gringos","gyp","gypsy","halfbreed",
  "honkey","honky","injun","jap","japs","kike","kikes",
  "kraut","krauts","limey","mick","micks","muzzie","nazi","nazis",
  "paki","pakis","polack","polacks","raghead","ragheads","redskin","redskins",
  "sambo","skinhead","spaz","sperg","squaw","terrorist","terrorists",
  "towelhead","towelheads","tranny","trannies","Uncle Tom","wetback","wetbacks",
  "wigger","wiggers","wop","wops","zipperhead",
];

function containsProfanity(text) {
  const lower = text.toLowerCase().replace(/[^a-z]/g, " ");
  const words = lower.split(/\s+/);
  return words.some(w => BLOCKED_WORDS.includes(w));
}

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
    isHidden: row.is_hidden || false,
    isVerified: row.is_verified || false,
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
    --popup-bg: #1e293b;
    --popup-text: #f1f5f9;
    --popup-muted: #94a3b8;
  }

  :root[data-theme="light"] {
    --bg: #f8fafc;
    --surface: #ffffff;
    --surface2: #f1f5f9;
    --surface3: #e2e8f0;
    --border: rgba(0,0,0,0.08);
    --border-accent: rgba(6,182,212,0.3);
    --text: #0f172a;
    --text-muted: #475569;
    --text-dim: #94a3b8;
    --cyan-glow: rgba(6,182,212,0.2);
    --popup-bg: #ffffff;
    --popup-text: #0f172a;
    --popup-muted: #475569;
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
    padding: 28px 32px 48px;
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

  .btn-theme-toggle {
    width: 38px; height: 38px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, border-color 0.15s;
  }
  .btn-theme-toggle:hover { background: var(--surface3); border-color: var(--cyan); }

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

  [data-theme="dark"] .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) saturate(0); }
  [data-theme="dark"] .leaflet-tile-pane img { filter: brightness(0.75) contrast(1.3); }

  .map-add-truck-overlay {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

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
    background: var(--surface2) !important;
    border: 1px solid var(--border-accent) !important;
    border-radius: 14px !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  .leaflet-popup-content { margin: 0 !important; }
  .leaflet-popup-tip { background: var(--surface2) !important; }
  .leaflet-popup-close-button { color: var(--text-muted) !important; top: 10px !important; right: 10px !important; font-size: 16px !important; }

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

  .popup-name { font-family: var(--font-display); font-size: 1rem; font-weight: 800; color: var(--popup-text); }
  .popup-type { font-size: 0.8rem; color: var(--popup-muted); margin-top: 2px; }

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

  .popup-meta { font-size: 0.8rem; color: var(--text-dim); margin-bottom: 12px; }
  .popup-meta span { margin-right: 10px; }

  .popup-top-comment { margin-bottom: 10px; font-size: 0.905rem; color: var(--popup-muted); line-height: 1.4; }

  .popup-actions { display: flex; gap: 5px; flex-wrap: wrap; }
  .popup-section-label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin-bottom: 4px; }

  .btn-vote {
    flex: 1;
    min-width: 0;
    border: none;
    border-radius: 999px;
    padding: 5px 10px;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 4px;
    transition: opacity 0.15s, transform 0.1s;
  }

  .btn-vote:hover:not(:disabled) { transform: scale(1.04); }
  .btn-vote:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-vote-up { background: rgba(34,197,94,0.14); color: #4ade80; }
  .btn-vote-up.voted { background: rgba(34,197,94,0.3); }
  .btn-vote-down { background: rgba(239,68,68,0.14); color: #f87171; }
  .btn-vote-down.voted { background: rgba(239,68,68,0.3); }

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
  .icon-btn-vote { background: rgba(148,163,184,0.14); color: #94a3b8; position: relative; }
  .icon-btn-vote.voted-up { background: rgba(34,197,94,0.25); color: #4ade80; }
  .icon-btn-vote.voted-down { background: rgba(239,68,68,0.25); color: #f87171; }

  .vote-popup {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    display: flex;
    gap: 6px;
    padding: 8px;
    z-index: 100;
    animation: fade-in 0.15s ease;
  }

  @keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  .vote-popup-btn {
    width: 42px; height: 42px;
    border: none;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
    cursor: pointer;
    transition: transform 0.1s, background 0.15s;
  }
  .vote-popup-btn:hover:not(:disabled) { transform: scale(1.12); }
  .vote-popup-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .vote-popup-up { background: rgba(34,197,94,0.18); color: #4ade80; }
  .vote-popup-up:hover:not(:disabled) { background: rgba(34,197,94,0.35); }
  .vote-popup-down { background: rgba(239,68,68,0.18); color: #f87171; }
  .vote-popup-down:hover:not(:disabled) { background: rgba(239,68,68,0.35); }
  .icon-btn-status { background: rgba(59,130,246,0.14); color: #93c5fd; position: relative; }
  .icon-btn-pin { background: rgba(59,130,246,0.14); color: #93c5fd; }
  .icon-btn-del { background: rgba(239,68,68,0.14); color: #f87171; }
  .icon-btn-del:hover:not(:disabled) { background: rgba(239,68,68,0.28); }
  .icon-btn-edit { background: rgba(6,182,212,0.14); color: #22d3ee; }
  .icon-btn-edit:hover:not(:disabled) { background: rgba(6,182,212,0.28); }
  .icon-btn-close { background: rgba(239,68,68,0.14); color: #f87171; font-size: 13px; }
  .icon-btn-close:hover:not(:disabled) { background: rgba(239,68,68,0.28); }
  .icon-btn-fav { background: rgba(148,163,184,0.14); color: #94a3b8; }
  .icon-btn-fav.favorited { background: rgba(239,68,68,0.15); color: #f87171; }
  .icon-btn-fav:hover:not(:disabled) { background: rgba(239,68,68,0.2); }

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
    .onboarding-tooltip { max-width: 280px; padding: 18px 16px 16px; }
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

  .comment-vote-row { display: flex; align-items: center; gap: 4px; margin-top: 3px; }
  .comment-vote-btn {
    background: none; border: none; cursor: pointer; font-size: 0.72rem; padding: 1px 5px; border-radius: 4px;
    color: #64748b; transition: color 0.15s, background 0.15s;
  }
  .comment-vote-btn:hover { background: rgba(148,163,184,0.12); }
  .comment-vote-btn.voted-up { color: #4ade80; }
  .comment-vote-btn.voted-down { color: #f87171; }
  .comment-vote-count { font-size: 0.72rem; color: #64748b; min-width: 14px; text-align: center; }

  .comment-sort-row { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; }
  .comment-sort-btn {
    background: none; border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px;
    font-size: 0.7rem; color: #94a3b8; cursor: pointer; transition: all 0.15s;
  }
  .comment-sort-btn:hover { border-color: var(--cyan); color: var(--cyan); }
  .comment-sort-btn.active { background: rgba(6,182,212,0.15); border-color: var(--cyan); color: var(--cyan); }

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

  /* ── Admin ── */
  .admin-login-card { max-width: 360px; width: 90vw; }
  .admin-login-form { display: flex; flex-direction: column; gap: 10px; width: 100%; margin-bottom: 8px; }
  .admin-login-error { color: #ef4444; font-size: 0.85rem; text-align: center; }

  .admin-panel { min-height: 100vh; background: var(--bg); color: var(--text); padding: 0; font-family: var(--font-body); }
  .admin-bar { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: var(--surface1); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
  .admin-bar-title { font-family: var(--font-display); font-size: 1.15rem; font-weight: 800; }
  .btn-admin-logout { background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 6px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: background 0.15s; }
  .btn-admin-logout:hover { background: var(--surface3); }

  .admin-filters { display: flex; gap: 8px; padding: 14px 20px; flex-wrap: wrap; }

  .admin-truck-list { padding: 0 20px 40px; }
  .admin-truck-row { background: var(--surface1); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; overflow: hidden; transition: opacity 0.2s; }
  .admin-truck-row.admin-hidden { opacity: 0.5; }
  .admin-truck-main { display: flex; align-items: center; gap: 12px; padding: 14px 16px; cursor: pointer; }
  .admin-truck-main:hover { background: var(--surface2); }
  .admin-truck-emoji { font-size: 1.6rem; }
  .admin-truck-info { flex: 1; min-width: 0; }
  .admin-truck-name { font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .admin-truck-meta { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
  .admin-expand-icon { color: var(--text-dim); font-size: 0.75rem; }

  .admin-badge { display: inline-block; font-size: 0.65rem; font-weight: 700; padding: 2px 7px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .admin-badge.verified { background: #065f4620; color: #4ade80; border: 1px solid #4ade8040; }
  .admin-badge.hidden { background: #ef444420; color: #ef4444; border: 1px solid #ef444440; }

  .admin-truck-actions { padding: 0 16px 14px; border-top: 1px solid var(--border); }
  .admin-btn-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .btn-admin-action { padding: 6px 14px; border-radius: 8px; font-size: 0.82rem; font-weight: 600; border: 1px solid var(--border); background: var(--surface2); color: var(--text); cursor: pointer; transition: all 0.15s; }
  .btn-admin-action:hover { background: var(--surface3); }
  .btn-admin-action.hide { color: #ef4444; }
  .btn-admin-action.delete { color: #ef4444; }
  .btn-admin-action.restore { color: #4ade80; }
  .btn-admin-action.verify { color: #4ade80; }
  .btn-admin-action.unverify { color: #f59e0b; }

  .admin-truck-detail { display: flex; gap: 16px; font-size: 0.75rem; color: var(--text-dim); margin-top: 10px; flex-wrap: wrap; }

  .admin-comments { margin-top: 12px; }
  .admin-comments-title { font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px; }
  .admin-comment-row { background: var(--surface2); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; }
  .admin-comment-row.admin-hidden { opacity: 0.5; }
  .admin-comment-body { font-size: 0.85rem; color: var(--text); margin-bottom: 4px; }
  .admin-comment-meta { font-size: 0.75rem; color: var(--text-dim); margin-bottom: 6px; }

  .admin-add-form { padding: 16px 20px; background: var(--surface1); border-bottom: 1px solid var(--border); }
  .admin-add-title { font-weight: 700; font-size: 0.95rem; margin-bottom: 12px; }
  .admin-add-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

  .admin-comment-actions { display: flex; gap: 4px; }

  .verified-badge { font-size: 0.8em; }

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
    overflow-y: auto;
    animation: ob-fade-in 0.25s ease;
  }

  @keyframes ob-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ob-slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

  .onboarding-card {
    background: var(--surface);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-lg);
    padding: 36px 32px 28px;
    max-width: 420px;
    width: 100%;
    margin: auto;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(6,182,212,0.1);
    text-align: center;
    animation: ob-slide-up 0.3s ease;
  }

  .onboarding-icon { font-size: 3rem; margin-bottom: 14px; line-height: 1; }
  .onboarding-title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: var(--text); margin-bottom: 10px; }
  .onboarding-subtitle { font-size: 1rem; color: var(--cyan); font-weight: 600; margin-bottom: 6px; }
  .onboarding-body { font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 28px; }

  .onboarding-dots { display: flex; justify-content: center; gap: 7px; margin-bottom: 22px; }
  .onboarding-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--surface3); border: 1px solid var(--border); transition: background 0.2s, border-color 0.2s; }
  .onboarding-dot.active { background: var(--cyan); border-color: var(--cyan); box-shadow: 0 0 6px var(--cyan-glow); }

  .onboarding-btn-row { display: flex; gap: 10px; }

  .btn-onboarding-next {
    flex: 1;
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
  }
  .btn-onboarding-next:hover { transform: translateY(-2px); box-shadow: 0 10px 28px var(--cyan-glow); }

  .btn-onboarding-back {
    background: var(--surface3);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-onboarding-back:hover { background: var(--surface2); }

  .btn-onboarding-skip {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 0.82rem;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 0.15s;
    margin-top: 12px;
  }
  .btn-onboarding-skip:hover { color: var(--text-muted); }

  /* EULA step */
  .eula-card { max-width: 420px; width: 90vw; }
  .eula-scroll {
    max-height: 45vh;
    overflow-y: auto;
    text-align: left;
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.65;
    padding: 14px 16px;
    margin-bottom: 20px;
    background: var(--surface1);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .eula-scroll h4 {
    color: var(--text);
    font-size: 0.88rem;
    margin: 14px 0 4px;
    font-weight: 700;
  }
  .eula-scroll h4:first-of-type { margin-top: 8px; }
  .eula-scroll p { margin: 0 0 8px; }
  .eula-scroll::-webkit-scrollbar { width: 6px; }
  .eula-scroll::-webkit-scrollbar-track { background: transparent; }
  .eula-scroll::-webkit-scrollbar-thumb { background: var(--surface3); border-radius: 3px; }

  /* Spotlight mode — tooltip positioned near highlighted element */
  .onboarding-spotlight {
    position: fixed;
    inset: 0;
    z-index: 10000;
    pointer-events: none;
    animation: ob-fade-in 0.25s ease;
  }

  .onboarding-spotlight-bg {
    position: fixed;
    inset: 0;
    pointer-events: auto;
  }

  .onboarding-highlight {
    position: fixed;
    border-radius: 12px;
    box-shadow: 0 0 0 4000px rgba(0,0,0,0.72), 0 0 0 4px rgba(6,182,212,0.5);
    transition: all 0.35s ease;
    pointer-events: none;
  }

  .onboarding-tooltip {
    position: fixed;
    background: var(--surface);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-lg);
    padding: 24px 22px 20px;
    max-width: 320px;
    width: calc(100vw - 40px);
    box-shadow: 0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(6,182,212,0.1);
    pointer-events: auto;
    animation: ob-fade-in 0.2s ease;
    z-index: 10001;
  }

  .onboarding-tooltip .onboarding-icon { font-size: 2rem; margin-bottom: 8px; }
  .onboarding-tooltip .onboarding-title { font-size: 1.15rem; margin-bottom: 6px; }
  .onboarding-tooltip .onboarding-body { font-size: 0.85rem; margin-bottom: 18px; }
`;

/* ─── Inject Styles ─────────────────────────────────────────────────────────── */
/* ─── Onboarding Overlay ────────────────────────────────────────────────────── */
const ONBOARDING_STEPS = [
  { type: "modal", icon: "🚚", title: "Welcome to StreetTaco", body: "Find the best food trucks near you, powered by people like you. Let's show you around — it only takes a sec." },
  { type: "spotlight", icon: "🗺️", title: "Your map", body: "This is where food trucks show up. Drag to explore, pinch to zoom, or search for a city.", target: ".map-wrapper", position: "bottom" },
  { type: "spotlight", icon: "📍", title: "Spot a truck?", body: "Tap this to drop a pin and share a food truck you found with the community.", target: ".map-add-truck-overlay", position: "bottom-left" },
  { type: "spotlight", icon: "🔍", title: "Find your area", body: "Use your location or type in a city/ZIP to jump to the right spot on the map.", target: ".controls-bar", position: "bottom" },
  { type: "spotlight", icon: "🗳️", title: "Vote & comment", body: "Each truck card shows votes, comments, and status. Tap to interact.", target: ".list-section", position: "top" },
  { type: "eula", icon: "📜", title: "End User License Agreement", body: "" },
  { type: "modal", icon: "🌮", title: "You're all set!", body: "Start exploring, add trucks you find, and help your community eat well." },
];

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
function AdminPanel({ trucks, onToggleHide, onToggleVerify, onHideComment, onUnhideComment, onDeleteComment, onDeleteTruck, onAddTruck, onLogout, showToast }) {
  const [filter, setFilter] = useState("all");
  const [expandedTruck, setExpandedTruck] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addFood, setAddFood] = useState("");
  const [addOpen, setAddOpen] = useState(true);
  const [addPermanent, setAddPermanent] = useState(false);
  const [addHours, setAddHours] = useState("");
  const [addLat, setAddLat] = useState("");
  const [addLng, setAddLng] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  async function handleAdminAdd() {
    const name = addName.trim(), food = addFood.trim(), lat = parseFloat(addLat), lng = parseFloat(addLng);
    if (!name || !food) { showToast("Enter truck name and food type."); return; }
    if (isNaN(lat) || isNaN(lng)) { showToast("Enter valid coordinates."); return; }
    setAddSaving(true);
    await onAddTruck({ name, food, open: addOpen, isPermanent: addPermanent, hours: addHours.trim(), lat, lng });
    setAddName(""); setAddFood(""); setAddOpen(true); setAddPermanent(false); setAddHours(""); setAddLat(""); setAddLng("");
    setAddSaving(false);
    setShowAddForm(false);
  }

  const filtered = useMemo(() => {
    if (filter === "hidden") return trucks.filter(t => t.isHidden);
    if (filter === "unverified") return trucks.filter(t => !t.isVerified && !t.isHidden);
    return trucks;
  }, [trucks, filter]);

  return (
    <div className="admin-panel">
      <div className="admin-bar">
        <span className="admin-bar-title">🔐 Admin Mode</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-admin-logout" style={{ background: "var(--cyan)", color: "#fff", borderColor: "var(--cyan)" }} onClick={() => setShowAddForm(f => !f)}>+ Add Truck</button>
          <button className="btn-admin-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {showAddForm && (
        <div className="admin-add-form">
          <div className="admin-add-title">Add Truck (no limits)</div>
          <div className="admin-add-grid">
            <input className="add-input" placeholder="Truck name" value={addName} maxLength={MAX_NAME_LENGTH} onChange={e => setAddName(e.target.value)} />
            <input className="add-input" placeholder="Food type" value={addFood} maxLength={MAX_FOOD_LENGTH} onChange={e => setAddFood(e.target.value)} />
            <input className="add-input" placeholder="Latitude" value={addLat} onChange={e => setAddLat(e.target.value)} />
            <input className="add-input" placeholder="Longitude" value={addLng} onChange={e => setAddLng(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 16, margin: "10px 0" }}>
            <label className="checkbox-row"><input type="checkbox" checked={addOpen} onChange={e => setAddOpen(e.target.checked)} /> <span className="checkbox-label">Open</span></label>
            <label className="checkbox-row"><input type="checkbox" checked={addPermanent} onChange={e => setAddPermanent(e.target.checked)} /> <span className="checkbox-label">Permanent</span></label>
          </div>
          {addPermanent && <input className="add-input" placeholder="Hours (e.g. Mon-Fri 11-3)" value={addHours} onChange={e => setAddHours(e.target.value)} style={{ marginBottom: 10 }} />}
          <div className="admin-btn-row">
            <button className="btn-admin-action verify" onClick={handleAdminAdd} disabled={addSaving}>{addSaving ? "Saving…" : "Add Truck"}</button>
            <button className="btn-admin-action" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="admin-filters">
        <button className={`filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All ({trucks.length})</button>
        <button className={`filter-btn ${filter === "hidden" ? "active" : ""}`} onClick={() => setFilter("hidden")}>Hidden ({trucks.filter(t => t.isHidden).length})</button>
        <button className={`filter-btn ${filter === "unverified" ? "active" : ""}`} onClick={() => setFilter("unverified")}>Unverified ({trucks.filter(t => !t.isVerified && !t.isHidden).length})</button>
      </div>

      <div className="admin-truck-list">
        {filtered.length === 0 && <div className="comments-empty">No trucks match this filter.</div>}
        {filtered.map(truck => (
          <div key={truck.id} className={`admin-truck-row ${truck.isHidden ? "admin-hidden" : ""}`}>
            <div className="admin-truck-main" onClick={() => setExpandedTruck(e => e === truck.id ? null : truck.id)}>
              <span className="admin-truck-emoji">{getFoodEmoji(truck.foodType)}</span>
              <div className="admin-truck-info">
                <div className="admin-truck-name">
                  {truck.name}
                  {truck.isVerified && <span className="admin-badge verified">Verified</span>}
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
                <div className="admin-btn-row">
                  <button className={`btn-admin-action ${truck.isHidden ? "restore" : "hide"}`} onClick={() => onToggleHide(truck.id, truck.isHidden)}>
                    {truck.isHidden ? "👁 Restore" : "🚫 Hide"}
                  </button>
                  <button className={`btn-admin-action ${truck.isVerified ? "unverify" : "verify"}`} onClick={() => onToggleVerify(truck.id, truck.isVerified)}>
                    {truck.isVerified ? "✖ Unverify" : "✅ Verify"}
                  </button>
                  <button className="btn-admin-action delete" onClick={() => { if (window.confirm(`Permanently delete "${truck.name}"? This cannot be undone.`)) onDeleteTruck(truck.id); }}>
                    🗑 Delete
                  </button>
                </div>
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

/* ─── Inject Styles ─────────────────────────────────────────────────────────── */
function StyleInjector() {
  return <style>{css}</style>;
}

/* ─── Header ────────────────────────────────────────────────────────────────── */
function Header({ theme, onToggleTheme }) {
  return (
    <div className="header">
      <div className="header-logo">
        <div className="logo-icon">🚚</div>
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
          <input className="add-input" type="text" placeholder="🚚  Truck name…" value={newTruckName} maxLength={MAX_NAME_LENGTH} onChange={e => setNewTruckName(e.target.value)} />
          <input className="add-input" type="text" placeholder="🍔  Food type…" value={newTruckFood} maxLength={MAX_FOOD_LENGTH} onChange={e => setNewTruckFood(e.target.value)} />
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
const TILE_DARK = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

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
      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={theme === "light" ? TILE_LIGHT : TILE_DARK}
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
                    {truck.isPermanent && truck.hours && <span>⏰ {truck.hours}</span>}
                    {!truck.isPermanent && <span>📍 confirmed {timeAgo(truck.lastConfirmedAt)}</span>}
                  </div>
                  <PopupTopComment truckId={truck.id} />
                  <div className="popup-section-label">Rate the food</div>
                  <div className="popup-actions">
                    <button className={`btn-vote btn-vote-up ${up ? "voted" : ""}`} onClick={() => onVote(truck.id, 1)} disabled={up}>
                      👍 {up ? "Liked" : "Good"}
                    </button>
                    <button className={`btn-vote btn-vote-down ${down ? "voted" : ""}`} onClick={() => onVote(truck.id, -1)} disabled={down}>
                      👎 {down ? "Noted" : "Not great"}
                    </button>
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

function TruckList({ visibleTrucks, userVotes, onVote, onConfirmStillHere, onReportClosed, myTruckIds, onDeleteTruck, onEditTruck, onFocusTruck, userId, onShareTruck, favorites, onToggleFavorite, isAdmin, onAdminHideComment, onAdminDeleteComment }) {
  const [showOpenOnly, setShowOpenOnly] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [foodFilter, setFoodFilter] = useState("");
  const [sortBy, setSortBy] = useState("distance");
  const [editingId, setEditingId] = useState(null);
  const [openCommentsId, setOpenCommentsId] = useState(null);
  const [openVoteId, setOpenVoteId] = useState(null);
  const [openStatusId, setOpenStatusId] = useState(null);

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
                  <div className="truck-card-name">{truck.name}{truck.isVerified && <span className="verified-badge" title="Verified"> ✅</span>}</div>
                  <div className="truck-card-sub">
                    {truck.street ? `${truck.foodType} on ${truck.street}` : truck.foodType} &nbsp;·&nbsp;
                    <span className={truck.open ? "open-tag" : "closed-tag"}>{truck.open ? "Open" : "Closed"}</span>
                    &nbsp;·&nbsp; {truck.distance.toFixed(1)} mi
                  </div>
                  <div className="truck-card-hours">
                    {truck.isPermanent
                      ? truck.hours ? `📌 ${truck.hours}` : "📌 Permanent"
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
                      {up ? "👍" : down ? "👎" : "🗳️"}
                    </button>
                    {openVoteId === truck.id && (
                      <div className="vote-popup" onClick={e => e.stopPropagation()}>
                        <button className={`vote-popup-btn vote-popup-up`} onClick={() => { onVote(truck.id, 1); setOpenVoteId(null); }} disabled={up} title="Upvote">👍</button>
                        <button className={`vote-popup-btn vote-popup-down`} onClick={() => { onVote(truck.id, -1); setOpenVoteId(null); }} disabled={down} title="Downvote">👎</button>
                      </div>
                    )}
                  </div>
                  {(!truck.isPermanent || (truck.open && !isMine)) && (
                    <div style={{ position: "relative" }}>
                      <button className="icon-btn icon-btn-status" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(v => v === truck.id ? null : truck.id); }} title="Update status">
                        📋
                      </button>
                      {openStatusId === truck.id && (
                        <div className="vote-popup" onClick={e => e.stopPropagation()}>
                          {!truck.isPermanent && (
                            <button className="vote-popup-btn vote-popup-up" onClick={() => { onConfirmStillHere(truck.id); setOpenStatusId(null); }} title="Still here">📍</button>
                          )}
                          {truck.open && !isMine && (
                            <button className="vote-popup-btn vote-popup-down" onClick={() => { onReportClosed(truck.id); setOpenStatusId(null); }} title="Report closed">🚫</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {isMine && (
                    <button className="icon-btn icon-btn-edit" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); startEdit(truck); }} title="Edit">✏️</button>
                  )}
                  {isMine && (
                    <button className="icon-btn icon-btn-del" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onDeleteTruck(truck.id); }} title="Delete">🗑</button>
                  )}
                  <button className={`icon-btn icon-btn-comment ${commentsOpen ? "active" : ""}`} onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); setOpenCommentsId(v => v === truck.id ? null : truck.id); }} title="Comments">💬</button>
                  <button className="icon-btn icon-btn-share" onClick={e => { e.stopPropagation(); setOpenVoteId(null); setOpenStatusId(null); onShareTruck(truck.id); }} title="Share">🔗</button>
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
      // Check for admin trigger in URL
      const params = new URLSearchParams(window.location.search);
      if (params.has("admin")) {
        setShowAdminLogin(true);
        window.history.replaceState({}, "", window.location.pathname);
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
    const street = await reverseGeocodeStreet(lat, lng);
    const { error } = await supabase.from("trucks").insert({
      id, name, food_type: food, open, votes: 1,
      lat, lng, is_permanent: isPermanent, hours: isPermanent ? hours : "",
      user_id: userId, created_at: ts, last_confirmed_at: ts,
      ...(street ? { street } : {}),
    });
    if (error) { showToast("Failed to add truck."); return; }
    showToast(`"${name}" added!`);
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
      {showAdminLogin && <AdminLoginModal onLogin={handleAdminLogin} onClose={() => setShowAdminLogin(false)} />}
      {!onboardingDone && !adminView && !showAdminLogin && <OnboardingOverlay onDismiss={() => setOnboardingDone(true)} />}
      <StyleInjector />
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
          onAddTruck={handleAdminAddTruck}
          onLogout={handleAdminLogout}
          showToast={showToast}
        />
      ) : (
        <div className="app-shell">
          <Header theme={theme} onToggleTheme={toggleTheme} />
          <ControlsBar searchText={searchText} setSearchText={setSearchText} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles} onUseMyLocation={handleUseMyLocation} onLocationSearch={handleLocationSearch} locationLoading={locationLoading} />
          <AddTruckPanel addMode={addMode} pendingPin={pendingPin} newTruckName={newTruckName} setNewTruckName={setNewTruckName} newTruckFood={newTruckFood} setNewTruckFood={setNewTruckFood} newTruckOpen={newTruckOpen} setNewTruckOpen={setNewTruckOpen} newTruckPermanent={newTruckPermanent} setNewTruckPermanent={setNewTruckPermanent} newTruckHours={newTruckHours} setNewTruckHours={setNewTruckHours} onSaveTruck={handleSaveTruck} onCancelAddTruck={handleCancelAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} />
          <TruckMap mapCenter={mapCenter} trucks={activeTrucks} radiusMiles={radiusMiles} onRadiusChange={setRadiusMiles} addMode={addMode} pendingPin={pendingPin} onPickLocation={handlePickLocation} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} userVotes={userVotes} userLocation={userLocation} focusRequest={focusRequest} onBoundsChange={setMapBounds} onStartAddTruck={handleStartAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} theme={theme} />
          <TruckList visibleTrucks={visibleTrucks} userVotes={userVotes} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} myTruckIds={myTruckIds} onDeleteTruck={handleDeleteTruck} onEditTruck={handleEditTruck} onFocusTruck={id => setFocusRequest(r => ({ id, seq: (r?.seq ?? 0) + 1 }))} userId={userId} onShareTruck={handleShareTruck} favorites={favorites} onToggleFavorite={handleToggleFavorite} isAdmin={isAdmin} onAdminHideComment={handleAdminHideComment} onAdminDeleteComment={handleAdminDeleteComment} />
        </div>
      )}
    </>
  );
}

export default App;