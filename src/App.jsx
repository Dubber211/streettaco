import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import "leaflet/dist/leaflet.css";
import "./styles.css";

import {
  DEFAULT_CENTER, DEFAULT_RADIUS_MILES, MAX_TRUCKS_PER_DAY,
  STORAGE_KEYS, CONFIRM_COOLDOWN_MINUTES, REPORT_COOLDOWN_MINUTES,
  ADD_COOLDOWN_MINUTES, VAPID_PUBLIC_KEY,
} from "./constants";

import {
  nowIso, containsProfanity, loadBlockedWords, isOpenBySchedule,
  reverseGeocode, nominatimFetch, toAppTruck, haversineMiles, hoursSince,
  isTruckExpired, normalizeTruck,
} from "./utils";

import { useLocalStorageState } from "./hooks";

import { AdminLoginModal, AdminPanel } from "./components/Admin";
import { ProximityPrompt, OnboardingOverlay } from "./components/Overlays";
import { Header, ControlsBar, ToastContainer, AddTruckPanel, SettingsPanel } from "./components/Layout";
import { TruckMap } from "./components/TruckMap";
import { TruckList } from "./components/TruckList";


/* ─── Main App ──────────────────────────────────────────────────────────────── */
function App() {
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [mapBounds, setMapBounds] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message) => {
    const id = ++toastIdRef.current;
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
  const [showSettings, setShowSettings] = useState(false);
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
  const [savingTruck, setSavingTruck] = useState(false);

  const myTruckIds = useMemo(() =>
    trucks.filter(t => t.userId === userId).map(t => t.id),
    [trucks, userId]
  );

  // Refs for polling to read current values without stale closures
  const mapCenterRef = useRef(mapCenter);
  const radiusMilesRef = useRef(radiusMiles);
  useEffect(() => { mapCenterRef.current = mapCenter; }, [mapCenter]);
  useEffect(() => { radiusMilesRef.current = radiusMiles; }, [radiusMiles]);

  // Auth + initial data load + realtime
  useEffect(() => {
    async function init() {
      loadBlockedWords();
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
      else if (truckRows) setTrucks(truckRows.map(toAppTruck));

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

    const realtimeConnected = { current: false };

    const channel = supabase.channel("trucks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "trucks" }, payload => {
        if (payload.eventType === "INSERT")
          setTrucks(cur => cur.find(t => t.id === payload.new.id) ? cur : [...cur, toAppTruck(payload.new)]);
        else if (payload.eventType === "UPDATE")
          setTrucks(cur => cur.map(t => t.id === payload.new.id ? toAppTruck(payload.new) : t));
        else if (payload.eventType === "DELETE")
          setTrucks(cur => cur.filter(t => t.id !== payload.old.id));
      })
      .subscribe(status => {
        realtimeConnected.current = status === "SUBSCRIBED";
      });

    // Polling fallback — only runs when the realtime websocket is disconnected
    // Scoped to a bounding box around the user's current map center + radius
    const poll = setInterval(async () => {
      if (realtimeConnected.current) return;
      const center = mapCenterRef.current;
      const radius = radiusMilesRef.current;
      const latDeg = (radius * 2) / 69;
      const lngDeg = (radius * 2) / (69 * Math.cos((center[0] * Math.PI) / 180));
      const { data } = await supabase.from("trucks").select("*")
        .gte("lat", center[0] - latDeg).lte("lat", center[0] + latDeg)
        .gte("lng", center[1] - lngDeg).lte("lng", center[1] + lngDeg);
      if (data) setTrucks(cur => {
        // Merge: update trucks in range, keep trucks outside range unchanged
        const fetched = new Map(data.map(r => [r.id, toAppTruck(r)]));
        const updated = cur.map(t => fetched.has(t.id) ? fetched.get(t.id) : t);
        // Add any new trucks from the fetch that weren't already in state
        data.forEach(r => { if (!cur.find(t => t.id === r.id)) updated.push(toAppTruck(r)); });
        return updated;
      });
    }, 30000);

    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, []);

  function applyUserLocation(lat, lng, msg = "Centered on your location.") {
    const loc = [lat, lng];
    setUserLocation(loc);
    setMapCenter(loc);
    showToast(msg);
  }

  // Prompt for push notifications if not already subscribed
  const pushPromptedRef = useRef(false);
  async function promptPushIfNeeded(location) {
    if (pushPromptedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    pushPromptedRef.current = true;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return; // already subscribed

      const padding = "=".repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4);
      const base64 = (VAPID_PUBLIC_KEY + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(base64);
      const key = Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });

      const sub = subscription.toJSON();
      let uid = localStorage.getItem("street-taco-user-id");
      if (!uid) { uid = crypto.randomUUID(); localStorage.setItem("street-taco-user-id", uid); }

      await supabase.from("push_subscriptions").insert({
        user_id: uid,
        endpoint: sub.endpoint,
        keys: sub.keys,
        lat: location?.[0] || null,
        lng: location?.[1] || null,
        radius_miles: 25,
        favorites: [],
        notify_new: true,
        notify_favorites: true,
      });
    } catch (e) { /* user declined or error — that's fine */ }
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) { showToast("Geolocation not supported. Using South Bend."); setMapCenter(DEFAULT_CENTER); return; }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        applyUserLocation(pos.coords.latitude, pos.coords.longitude);
        setLocationLoading(false);
      },
      err => {
        setLocationLoading(false);
        const msgs = { [err.PERMISSION_DENIED]: "Location denied.", [err.TIMEOUT]: "Location timed out." };
        showToast((msgs[err.code] || "Couldn't get location.") + " Using South Bend.");
        setMapCenter(DEFAULT_CENTER);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function handleOnboardingComplete() {
    setOnboardingDone(true);
    if (!navigator.geolocation) {
      setMapCenter(DEFAULT_CENTER);
      promptPushIfNeeded(null);
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = [pos.coords.latitude, pos.coords.longitude];
        applyUserLocation(loc[0], loc[1]);
        setLocationLoading(false);
        promptPushIfNeeded(loc);
      },
      err => {
        setLocationLoading(false);
        const msgs = { [err.PERMISSION_DENIED]: "Location denied.", [err.TIMEOUT]: "Location timed out." };
        showToast((msgs[err.code] || "Couldn't get location.") + " Using South Bend.");
        setMapCenter(DEFAULT_CENTER);
        promptPushIfNeeded(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function handleLocationSearch(e) {
    e.preventDefault();
    const q = searchText.trim();
    if (!q) { showToast("Enter a city or ZIP first."); return; }
    try {
      const params = new URLSearchParams({ format: "jsonv2", limit: "1" });
      /^\d{5}$/.test(q) ? (params.set("postalcode", q), params.set("countrycodes", "us")) : params.set("q", q);
      const res = await nominatimFetch(`https://nominatim.openstreetmap.org/search?${params}`);
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

  const votingRef = useRef(new Set());
  async function handleVote(id, vote) {
    const existing = userVotes[id];
    if (existing === vote) return;
    if (votingRef.current.has(id)) return;
    votingRef.current.add(id);
    const delta = existing === undefined ? vote : vote - existing;
    // Optimistic update
    setTrucks(cur => cur.map(t => t.id !== id ? t : { ...t, votes: Math.max(0, t.votes + delta) }));
    setUserVotes(cv => ({ ...cv, [id]: vote }));
    const { error } = await supabase.rpc("vote_truck", { p_truck_id: id, p_vote: vote });
    votingRef.current.delete(id);
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
    if (savingTruck) return;
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
    setSavingTruck(true);
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
    if (error) { console.error("Save truck error:", error); showToast("Couldn't save truck — try again."); setSavingTruck(false); return; }
    setUserVotes(cv => ({ ...cv, [id]: 1 }));
    setAddHistory(cur => [...cur.filter(t => hoursSince(t) < 24), ts]);
    setMapCenter(pendingPin);
    setAddMode(false);
    resetForm();
    setSavingTruck(false);
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
    // Flag this device's push subscription as admin
    if ("serviceWorker" in navigator && "PushManager" in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await supabase.from("push_subscriptions").update({ is_admin: true }).eq("endpoint", sub.endpoint);
        }
      } catch (e) { /* push not available, no big deal */ }
    }

    const { data: truckRows } = await supabase.from("trucks").select("*");
    if (truckRows) setTrucks(truckRows.map(toAppTruck));
    return { error: null };
  }

  async function handleAdminLogout() {
    // Remove admin flag from this device's push subscription
    if ("serviceWorker" in navigator && "PushManager" in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await supabase.from("push_subscriptions").update({ is_admin: false }).eq("endpoint", sub.endpoint);
        }
      } catch (e) { /* push not available */ }
    }

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
    } else {
      showToast("That truck link is no longer available.");
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
      {onboardingDone !== true && !adminView && !showAdminLogin && <OnboardingOverlay onDismiss={onboardingDone === "walkthrough" ? () => setOnboardingDone(true) : handleOnboardingComplete} skipEula={onboardingDone === "walkthrough"} />}
      {showSettings && (
        <SettingsPanel
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={() => setShowSettings(false)}
          onShowOnboarding={() => { setShowSettings(false); setOnboardingDone("walkthrough"); }}
          userLocation={userLocation}
          favorites={favorites}
        />
      )}

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
        <div className="map-app">
          {/* Map is the full-viewport background */}
          <TruckMap mapCenter={mapCenter} trucks={activeTrucks} radiusMiles={radiusMiles} onRadiusChange={setRadiusMiles} addMode={addMode} pendingPin={pendingPin} onPickLocation={handlePickLocation} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} userVotes={userVotes} userLocation={userLocation} focusRequest={focusRequest} onBoundsChange={setMapBounds} onStartAddTruck={handleStartAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} theme={theme} visibleTrucks={visibleTrucks} onFindNearest={handleFindNearest} />

          {/* Floating header */}
          <Header theme={theme} onToggleTheme={toggleTheme} onOpenSettings={() => setShowSettings(true)} />

          {/* Floating controls */}
          <ControlsBar searchText={searchText} setSearchText={setSearchText} radiusMiles={radiusMiles} setRadiusMiles={setRadiusMiles} onUseMyLocation={handleUseMyLocation} onLocationSearch={handleLocationSearch} locationLoading={locationLoading} />

          {/* Floating Add Truck button */}
          {!addMode && (
            <button className="fab-add-truck" onClick={handleStartAddTruck} disabled={!canAdd} aria-label="Add truck">
              <span className="fab-plus">+</span>
            </button>
          )}

          {/* Bottom sheet panels */}
          <AddTruckPanel addMode={addMode} pendingPin={pendingPin} newTruckName={newTruckName} setNewTruckName={setNewTruckName} newTruckFood={newTruckFood} setNewTruckFood={setNewTruckFood} newTruckOpen={newTruckOpen} setNewTruckOpen={setNewTruckOpen} newTruckPermanent={newTruckPermanent} setNewTruckPermanent={setNewTruckPermanent} newTruckHours={newTruckHours} setNewTruckHours={setNewTruckHours} onSaveTruck={handleSaveTruck} onCancelAddTruck={handleCancelAddTruck} canAdd={canAdd} addsRemaining={addsRemaining} onUseMyLocation={handleUseLocationForPin} savingTruck={savingTruck} />

          <ProximityPrompt userLocation={userLocation} trucks={activeTrucks} onConfirm={handleConfirmStillHere} />

          {/* Truck list bottom sheet */}
          <TruckList visibleTrucks={visibleTrucks} userVotes={userVotes} onVote={handleVote} onConfirmStillHere={handleConfirmStillHere} onReportClosed={handleReportClosed} myTruckIds={myTruckIds} onDeleteTruck={handleDeleteTruck} onEditTruck={handleEditTruck} onFocusTruck={id => setFocusRequest(r => ({ id, seq: (r?.seq ?? 0) + 1 }))} userId={userId} onShareTruck={handleShareTruck} favorites={favorites} onToggleFavorite={handleToggleFavorite} isAdmin={isAdmin} onAdminHideComment={handleAdminHideComment} onAdminDeleteComment={handleAdminDeleteComment} onFindNearest={handleFindNearest} />
        </div>
      )}
    </>
  );
}

export default App;