import { useState } from "react";
import { RADIUS_OPTIONS, MAX_NAME_LENGTH, MAX_FOOD_LENGTH, MOBILE_TRUCK_EXPIRATION_HOURS, STORAGE_KEYS, ONBOARDING_STEPS } from "../constants";
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
      <button className="btn-theme-toggle" onClick={onOpenSettings} title="Settings">
        ⚙️
      </button>
    </div>
  );
}

/* ─── Settings Panel ───────────────────────────────────────────────────────── */
export function SettingsPanel({ theme, onToggleTheme, onClose, onShowEula, onShowOnboarding }) {
  const [notifyNewTrucks, setNotifyNewTrucks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.notifyNewTrucks) || "true"); } catch { return true; }
  });
  const [notifyFavorites, setNotifyFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.notifyFavorites) || "true"); } catch { return true; }
  });

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

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose}>✕</button>
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
          <div className="settings-row" onClick={toggleNotifyNew}>
            <span>🔔 New trucks nearby</span>
            <span className={`settings-toggle ${notifyNewTrucks ? "on" : ""}`}>{notifyNewTrucks ? "On" : "Off"}</span>
          </div>
          <div className="settings-row" onClick={toggleNotifyFav}>
            <span>❤️ Favorite truck updates</span>
            <span className={`settings-toggle ${notifyFavorites ? "on" : ""}`}>{notifyFavorites ? "On" : "Off"}</span>
          </div>
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
export function AddTruckPanel({ addMode, pendingPin, newTruckName, setNewTruckName, newTruckFood, setNewTruckFood, newTruckOpen, setNewTruckOpen, newTruckPermanent, setNewTruckPermanent, newTruckHours, setNewTruckHours, onSaveTruck, onCancelAddTruck, canAdd, addsRemaining, onUseMyLocation }) {
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

