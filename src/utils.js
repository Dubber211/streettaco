import L from "leaflet";
import { supabase } from "./supabase";
import { DAY_LABELS, FOOD_EMOJIS, MOBILE_TRUCK_EXPIRATION_HOURS } from "./constants";

export const nowIso = () => new Date().toISOString();

// Blocked words loaded from Supabase, with fallback
let blockedWordsCache = [];

export async function loadBlockedWords() {
  const { data } = await supabase.from("blocked_words").select("word");
  if (data) blockedWordsCache = data.map(r => r.word);
  return blockedWordsCache;
}

export function containsProfanity(text) {
  const lower = text.toLowerCase().replace(/[^a-z]/g, " ");
  const words = lower.split(/\s+/);
  return words.some(w => blockedWordsCache.includes(w));
}

export function to12h(t) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hr = h % 12 || 12;
  return m ? `${hr}:${String(m).padStart(2, "0")}${suffix}` : `${hr}${suffix}`;
}

export function parseSchedule(hours) {
  if (!hours || typeof hours !== "string") return null;
  try {
    const s = JSON.parse(hours);
    if (Array.isArray(s) && s.length && s[0].days) return s;
    if (s && s.open && s.close && Array.isArray(s.days)) return [s];
  } catch {}
  return null;
}

export function isOpenBySchedule(hours) {
  const blocks = parseSchedule(hours);
  if (!blocks) return null;
  const now = new Date();
  const day = now.getDay();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  for (const b of blocks) {
    if (!b.days.includes(day)) continue;
    const [oh, om] = b.open.split(":").map(Number);
    const [ch, cm] = b.close.split(":").map(Number);
    const openMins = oh * 60 + (om || 0);
    const closeMins = ch * 60 + (cm || 0);
    if (closeMins > openMins) { if (currentMins >= openMins && currentMins < closeMins) return true; }
    else { if (currentMins >= openMins || currentMins < closeMins) return true; }
  }
  return false;
}

export function formatDayRange(sorted) {
  if (sorted.length === 0) return "";
  if (sorted.length === 7) return "Every day";
  const ranges = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    ranges.push(start === prev ? DAY_LABELS[start] : `${DAY_LABELS[start]}–${DAY_LABELS[prev]}`);
    if (i < sorted.length) { start = sorted[i]; prev = sorted[i]; }
  }
  return ranges.join(", ");
}

export function formatSchedule(hours) {
  const blocks = parseSchedule(hours);
  if (!blocks) return hours || "";
  return blocks.map(b => {
    const dayStr = formatDayRange([...b.days].sort());
    return `${dayStr} ${to12h(b.open)}–${to12h(b.close)}`;
  }).join(" · ");
}

export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    const addr = data?.address || {};
    return {
      street: addr.road || null,
      city: addr.city || addr.town || addr.village || addr.hamlet || null,
      state: addr.state || null,
    };
  } catch { return { street: null, city: null, state: null }; }
}

export function getFoodEmoji(foodType = "") {
  const lower = foodType.toLowerCase();
  for (const [key, emoji] of Object.entries(FOOD_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return FOOD_EMOJIS.default;
}

export function toAppTruck(row) {
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
    city: row.city || null,
    state: row.state || null,
    isHidden: row.is_hidden || false,
    isVerified: row.is_verified || false,
    isApproved: row.is_approved !== false,
  };
}

export const userLocationIcon = L.divIcon({
  html: `<div style="width:16px;height:16px;background:#06b6d4;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(6,182,212,0.3),0 2px 8px rgba(0,0,0,0.4);"></div>`,
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export function makeTruckIcon(foodType, isOpen) {
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

export function makePendingIcon() {
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

export const adminPinIcon = L.divIcon({
  html: `<div style="width:24px;height:24px;background:#06b6d4;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export function haversineMiles([lat1, lon1], [lat2, lon2]) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function milesToMeters(m) { return m * 1609.34; }
export function hoursSince(ts) { const t = new Date(ts).getTime(); return isNaN(t) ? Infinity : (Date.now() - t) / 3600000; }
export function timeAgo(ts) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

export function isTruckExpired(t) { return t.isPermanent || t.isVerified ? false : hoursSince(t.lastConfirmedAt || t.createdAt) > MOBILE_TRUCK_EXPIRATION_HOURS; }
export function normalizeTruck(t) { const c = t.createdAt || nowIso(); return { ...t, isPermanent: Boolean(t.isPermanent), hours: t.hours || "", createdAt: c, lastConfirmedAt: t.lastConfirmedAt || c }; }
