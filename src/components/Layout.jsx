import { useState, useEffect, useRef } from "react";
import { RADIUS_OPTIONS, MAX_NAME_LENGTH, MAX_FOOD_LENGTH, MOBILE_TRUCK_EXPIRATION_HOURS, STORAGE_KEYS, ONBOARDING_STEPS, VAPID_PUBLIC_KEY } from "../constants";
import { supabase } from "../supabase";
import { ScheduleInput } from "./MapHelpers";

export function Header({ theme, onToggleTheme, onOpenSettings }) {
  return (
    <div className="header">
      <div className="header-logo">
        <img className="logo-icon-img" src="/logo.png" alt="StreetTaco" />
        <div className="logo-text">
          <h1>StreetTaco</h1>
          <p>Find food trucks near you • Community powered</p>
        </div>
      </div>
      <button className="btn-theme-toggle" onClick={onOpenSettings} title="Settings" aria-label="Settings">
        ⚙️
      </button>
    </div>
  );
}

/* ─── Settings Panel ───────────────────────────────────────────────────────── */
// Convert the VAPID public key from base64 string to the Uint8Array format
// that the browser's pushManager.subscribe() expects
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

// Get the user_id we use throughout the app (anonymous, stored in localStorage)
function getUserId() {
  let id = localStorage.getItem("street-taco-user-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("street-taco-user-id", id);
  }
  return id;
}

export function SettingsPanel({ theme, onToggleTheme, onClose, onShowEula, onShowOnboarding, userLocation, favorites }) {
  // "pushed" tracks whether we have an active push subscription in the browser
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushSupported] = useState(() => "serviceWorker" in navigator && "PushManager" in window);

  const [notifyNewTrucks, setNotifyNewTrucks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.notifyNewTrucks) || "true"); } catch { return true; }
  });
  const [notifyFavorites, setNotifyFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.notifyFavorites) || "true"); } catch { return true; }
  });

  // On mount, check if the browser already has a push subscription
  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setPushEnabled(!!sub);
      });
    });
  }, [pushSupported]);

  // Keep Supabase in sync when location, favorites, or preferences change (debounced)
  const syncTimerRef = useRef(null);
  useEffect(() => {
    if (!pushEnabled || !pushSupported) return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((subscription) => {
          if (!subscription) return;
          supabase.from("push_subscriptions").update({
            lat: userLocation?.[0] || null,
            lng: userLocation?.[1] || null,
            favorites: favorites || [],
            notify_new: notifyNewTrucks,
            notify_favorites: notifyFavorites,
          }).eq("endpoint", subscription.endpoint);
        })
      );
    }, 1000);
    return () => clearTimeout(syncTimerRef.current);
  }, [pushEnabled, pushSupported, userLocation, favorites, notifyNewTrucks, notifyFavorites]);

  // Subscribe: ask the browser for permission, get a subscription, save it to Supabase
  async function subscribeToPush() {
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("Notifications were blocked. You can enable them in your browser settings.");
        setPushLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true, // required by Chrome — means every push must show a notification
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // The subscription object looks like:
      // { endpoint: "https://fcm.googleapis.com/...", keys: { p256dh: "...", auth: "..." } }
      const sub = subscription.toJSON();
      // Use insert + update fallback instead of upsert to avoid overwriting is_admin
      const { error: insertErr } = await supabase.from("push_subscriptions").insert({
        user_id: getUserId(),
        endpoint: sub.endpoint,
        keys: sub.keys,
        lat: userLocation?.[0] || null,
        lng: userLocation?.[1] || null,
        radius_miles: 25,
        favorites: favorites || [],
        notify_new: notifyNewTrucks,
        notify_favorites: notifyFavorites,
      });
      // If endpoint already exists, just update the safe fields
      if (insertErr) {
        await supabase.from("push_subscriptions").update({
          user_id: getUserId(),
          keys: sub.keys,
          lat: userLocation?.[0] || null,
          lng: userLocation?.[1] || null,
          favorites: favorites || [],
          notify_new: notifyNewTrucks,
          notify_favorites: notifyFavorites,
        }).eq("endpoint", sub.endpoint);
      }

      setPushEnabled(true);
    } catch (err) {
      console.error("Push subscribe failed:", err);
      alert("Could not enable notifications. Please try again.");
    }
    setPushLoading(false);
  }

  // Unsubscribe: remove from browser and delete from Supabase
  async function unsubscribeFromPush() {
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
    } catch (err) {
      console.error("Push unsubscribe failed:", err);
    }
    setPushLoading(false);
  }

  function toggleNotifyNew() {
    const v = !notifyNewTrucks;
    setNotifyNewTrucks(v);
    localStorage.setItem(STORAGE_KEYS.notifyNewTrucks, JSON.stringify(v));
  }

  function toggleNotifyFav() {
    const v = !notifyFavorites;
    setNotifyFavorites(v);
    localStorage.setItem(STORAGE_KEYS.notifyFavorites, JSON.stringify(v));
  }

  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Appearance</div>
          <div className="settings-row" onClick={onToggleTheme}>
            <span>{theme === "dark" ? "🌙" : "☀️"} Theme</span>
            <span className="settings-value">{theme === "dark" ? "Dark" : "Light"}</span>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Notifications</div>
          {pushSupported ? (
            <>
              <div className="settings-row" onClick={pushLoading ? undefined : (pushEnabled ? unsubscribeFromPush : subscribeToPush)}>
                <span>🔔 Push notifications</span>
                <span className={`settings-toggle ${pushEnabled ? "on" : ""}`}>
                  {pushLoading ? "…" : pushEnabled ? "On" : "Off"}
                </span>
              </div>
              {pushEnabled && (
                <>
                  <div className="settings-row sub-row" onClick={toggleNotifyNew}>
                    <span>📍 New trucks nearby</span>
                    <span className={`settings-toggle ${notifyNewTrucks ? "on" : ""}`}>{notifyNewTrucks ? "On" : "Off"}</span>
                  </div>
                  <div className="settings-row sub-row" onClick={toggleNotifyFav}>
                    <span>❤️ Favorite truck updates</span>
                    <span className={`settings-toggle ${notifyFavorites ? "on" : ""}`}>{notifyFavorites ? "On" : "Off"}</span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="settings-row">
              <span className="text-dim">Push notifications are not supported in this browser.</span>
            </div>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-title">About</div>
          <div className="settings-row" onClick={onShowOnboarding}>
            <span>📖 App walkthrough</span>
            <span className="settings-arrow">→</span>
          </div>
          <div className="settings-row" onClick={onShowEula}>
            <span>📜 End User License Agreement</span>
            <span className="settings-arrow">→</span>
          </div>
          <div className="settings-row" onClick={() => window.open("mailto:support@streettaco.app")}>
            <span>💬 Help & Feedback</span>
            <span className="settings-arrow">→</span>
          </div>
        </div>

        <div className="settings-version">StreetTaco v2.5</div>
      </div>
    </div>
  );
}

/* ─── Controls Bar ──────────────────────────────────────────────────────────── */
export function ControlsBar({ searchText, setSearchText, radiusMiles, setRadiusMiles, onUseMyLocation, onLocationSearch, locationLoading }) {
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
export function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => <div key={t.id} className="toast">{t.message}</div>)}
    </div>
  );
}

/* ─── Add Truck Panel (Waze-style) ──────────────────────────────────────────── */
export function AddTruckPanel({ addMode, pendingPin, newTruckName, setNewTruckName, newTruckFood, setNewTruckFood, newTruckOpen, setNewTruckOpen, newTruckPermanent, setNewTruckPermanent, newTruckHours, setNewTruckHours, onSaveTruck, onCancelAddTruck, canAdd, addsRemaining, onUseMyLocation, savingTruck }) {
  const [showHours, setShowHours] = useState(false);
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

        <div className="schedule-section-label" onClick={() => setShowHours(h => !h)} style={{ cursor: "pointer" }}>
          {showHours ? "⏰ Operating Hours ▲" : "⏰ I know their hours →"}
        </div>
        {showHours && <ScheduleInput value={newTruckHours} onChange={setNewTruckHours} />}

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
          <button className="btn-save" onClick={onSaveTruck} disabled={!canAdd || savingTruck}>
            {savingTruck ? "Saving…" : canAdd ? "Save Truck 🎉" : `Daily limit reached (${MAX_TRUCKS_PER_DAY}/day)`}
          </button>
          <button className="btn-cancel" onClick={onCancelAddTruck}>Cancel</button>
        </div>
        {canAdd && <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", textAlign: "right" }}>{addsRemaining} add{addsRemaining !== 1 ? "s" : ""} left today</div>}
      </div>
    </div>
  );
}

