import { useState, useEffect, useRef } from "react";
import { RADIUS_OPTIONS, MAX_NAME_LENGTH, MAX_FOOD_LENGTH, MOBILE_TRUCK_EXPIRATION_HOURS, STORAGE_KEYS, ONBOARDING_STEPS, VAPID_PUBLIC_KEY } from "../constants";
import { supabase } from "../supabase";
import { ScheduleInput } from "./MapHelpers";
import { useFocusTrap } from "../hooks";

export function Header({ theme, onToggleTheme, onOpenSettings }) {
  return (
    <div className="floating-header">
      <div className="header-logo">
        <img className="logo-icon-img" src="/logo.png" alt="StreetTaco" />
        <div className="header-brand">
          <h1 className="header-title">StreetTaco</h1>
          <span className="header-tagline">Real food trucks, right now</span>
        </div>
      </div>
      <button className="btn-header-action" onClick={onOpenSettings} title="Settings" aria-label="Settings">
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

function EulaViewer({ onClose }) {
  const trapRef = useFocusTrap();

  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="eula-viewer" ref={trapRef} onClick={e => e.stopPropagation()}>
        <div className="eula-viewer-header">
          <span className="settings-title">📜 EULA</span>
          <button className="settings-close" onClick={onClose} aria-label="Close EULA">✕</button>
        </div>
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
      </div>
    </div>
  );
}

function FeedbackForm({ onClose }) {
  const trapRef = useFocusTrap();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    let uid = localStorage.getItem("street-taco-user-id");
    if (!uid) { uid = crypto.randomUUID(); localStorage.setItem("street-taco-user-id", uid); }
    const { error } = await supabase.from("feedback").insert({ user_id: uid, body: body.trim() });
    setSending(false);
    if (error) alert("Couldn't send feedback — try again.");
    else setSent(true);
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="eula-viewer" ref={trapRef} onClick={e => e.stopPropagation()}>
        <div className="eula-viewer-header">
          <span className="settings-title">💬 Feedback</span>
          <button className="settings-close" onClick={onClose} aria-label="Close feedback">✕</button>
        </div>
        <div style={{ padding: "20px" }}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🎉</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", fontWeight: 800, marginBottom: 8 }}>Thanks!</div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Your feedback has been sent to the team.</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 14, lineHeight: 1.5 }}>
                Found a bug? Have a suggestion? Let us know and we'll take a look.
              </p>
              <textarea
                className="comment-textarea"
                placeholder="What's on your mind?"
                value={body}
                onChange={e => setBody(e.target.value)}
                maxLength={1000}
                style={{ width: "100%", minHeight: 120 }}
                autoFocus
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>{body.length}/1000</span>
                <button type="submit" className="btn-edit-save" disabled={!body.trim() || sending} style={{ flex: "none", padding: "10px 20px" }}>
                  {sending ? "Sending…" : "Send Feedback"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({ theme, onToggleTheme, onClose, onShowOnboarding, userLocation, favorites }) {
  const [showEula, setShowEula] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
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

  const trapRef = useFocusTrap();

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" ref={trapRef} onClick={e => e.stopPropagation()}>
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
          <div className="settings-row" onClick={() => setShowEula(true)}>
            <span>📜 End User License Agreement</span>
            <span className="settings-arrow">→</span>
          </div>
          {showEula && <EulaViewer onClose={() => setShowEula(false)} />}
          <div className="settings-row" onClick={() => setShowFeedback(true)}>
            <span>💬 Help & Feedback</span>
            <span className="settings-arrow">→</span>
          </div>
          {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Our Story</div>
          <div className="settings-about">
            <p>StreetTaco started with a simple moment — a friend was over, hungry, and said <em>"I wish I knew what food trucks were open right now."</em></p>
            <p>That's it. That was the spark. We built StreetTaco to answer that exact question, powered by real people in real time.</p>
            <p className="settings-about-privacy">🔒 <strong>Privacy first.</strong> No accounts required. No tracking. No selling your data. Your location stays on your device — we just use it to show you what's nearby.</p>
          </div>
        </div>

        <div className="settings-version">StreetTaco v3.1</div>
      </div>
    </div>
  );
}

/* ─── Controls Bar ──────────────────────────────────────────────────────────── */
export function ControlsBar({ searchText, setSearchText, radiusMiles, setRadiusMiles, onUseMyLocation, onLocationSearch, locationLoading }) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="floating-controls">
      <button className="control-pill" onClick={onUseMyLocation} disabled={locationLoading} aria-label="My location">
        {locationLoading ? "⌛" : <span className="location-dot" />}
      </button>

      {searchOpen ? (
        <form className="control-search-form" onSubmit={(e) => { onLocationSearch(e); setSearchOpen(false); }}>
          <input className="control-search-input" type="text" placeholder="City or ZIP…" value={searchText} onChange={e => setSearchText(e.target.value)} autoFocus onBlur={() => { if (!searchText) setSearchOpen(false); }} />
          <button className="control-pill" type="submit" aria-label="Search">Go</button>
        </form>
      ) : (
        <button className="control-pill" onClick={() => setSearchOpen(true)} aria-label="Search location">🔍</button>
      )}

      <select className="control-pill control-radius" value={radiusMiles} onChange={e => setRadiusMiles(Number(e.target.value))} aria-label="Search radius">
        {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} mi</option>)}
      </select>
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
    <div className="add-panel-sheet">
      <div className="sheet-handle"><div className="sheet-handle-bar" /></div>
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

