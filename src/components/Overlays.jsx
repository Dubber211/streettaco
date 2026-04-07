import { useEffect, useMemo, useState, useCallback } from "react";
import { PROXIMITY_KEY, PROXIMITY_RADIUS_MILES, ONBOARDING_STEPS, STORAGE_KEYS } from "../constants";
import { haversineMiles } from "../utils";
import { useFocusTrap } from "../hooks";

/* ─── Proximity Prompt ─────────────────────────────────────────────────────── */
export function getStoredDismissals() {
  try { return JSON.parse(localStorage.getItem(PROXIMITY_KEY) || "{}"); } catch { return {}; }
}

// Show a proximity notification via the local service worker. We don't
// route this through the server because the user is right here, the
// permission is already granted, and the SW can fire a notification
// directly — no need to involve the push backend.
async function showProximityNotification(truck) {
  try {
    if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Truck nearby!", {
      body: `Are you near ${truck.name}? Confirm it's still here!`,
      data: { url: "/", type: "proximity", truck_id: truck.id },
      tag: `proximity-${truck.id}`,
    });
  } catch (e) { /* fall through to in-app prompt */ }
}

export function ProximityPrompt({ userLocation, trucks, onConfirm }) {
  const [prompt, setPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(getStoredDismissals);
  const [pushSubscribed, setPushSubscribed] = useState(false);

  // Check if push is active on mount
  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready.then(reg =>
        reg.pushManager.getSubscription().then(sub => setPushSubscribed(!!sub))
      );
    }
  }, []);

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

  const markDone = useCallback((truckId) => {
    const today = new Date().toISOString().slice(0, 10);
    const key = `${truckId}_${today}`;
    setDismissed(prev => {
      const updated = { ...prev, [key]: true };
      Object.keys(updated).forEach(k => { if (!k.endsWith(today)) delete updated[k]; });
      localStorage.setItem(PROXIMITY_KEY, JSON.stringify(updated));
      return updated;
    });
    setPrompt(null);
  }, []);

  useEffect(() => {
    if (!nearbyTruck) { setPrompt(null); return; }
    if (pushSubscribed) {
      showProximityNotification(nearbyTruck);
      markDone(nearbyTruck.id);
    } else {
      setPrompt(nearbyTruck);
    }
  }, [nearbyTruck, pushSubscribed, markDone]);

  // Don't show in-app prompt if push is subscribed or no nearby truck
  if (!prompt || pushSubscribed) return null;

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

export function OnboardingOverlay({ onDismiss, skipEula = false }) {
  const steps = useMemo(() => skipEula ? ONBOARDING_STEPS.filter(s => s.type !== "eula") : ONBOARDING_STEPS, [skipEula]);
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;
  const totalSteps = steps.length;

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") {
        if (isLast) { onDismiss(); return; }
        const eulaIdx = steps.findIndex(s => s.type === "eula");
        setStep(eulaIdx >= 0 ? eulaIdx : steps.length - 1);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isLast, onDismiss, steps]);

  const trapRef = useFocusTrap();

  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    const cur = steps[step];
    function measure() {
      if (cur.type === "spotlight" && cur.target) {
        const el = document.querySelector(cur.target);
        if (el) {
          const rect = el.getBoundingClientRect();
          const top = Math.max(0, rect.top - 8);
          const height = rect.height + 16 - (top - (rect.top - 8));
          setTargetRect({ top, left: rect.left - 8, width: rect.width + 16, height });
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

  const eulaStepIndex = steps.findIndex(s => s.type === "eula");

  function getTooltipStyle() {
    if (!targetRect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    const pad = 16;
    const maxW = Math.min(320, window.innerWidth - 40);
    const belowTop = targetRect.top + targetRect.height + pad;
    const spaceBelow = window.innerHeight - belowTop;
    const spaceAbove = targetRect.top - pad;
    let left = targetRect.left + targetRect.width / 2 - maxW / 2;
    left = Math.max(20, Math.min(left, window.innerWidth - maxW - 20));

    if (spaceBelow >= 200) {
      return { top: Math.min(belowTop, window.innerHeight - 220), left, maxWidth: maxW };
    }
    if (spaceAbove >= 200) {
      return { top: Math.max(pad, targetRect.top - 220), left, maxWidth: maxW };
    }
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)", maxWidth: maxW };
  }

  // EULA step
  if (current.type === "eula") {
    return (
      <div className="onboarding-backdrop">
        <div className="onboarding-card eula-card" ref={trapRef}>
          <div className="onboarding-icon">{current.icon}</div>
          <div className="onboarding-title">{current.title}</div>
          <div className="eula-scroll">
            <p><strong>Last updated:</strong> April 4, 2026</p>
            <p>By using StreetTaco ("the App"), you agree to the following terms. If you do not agree, please do not use the App.</p>
            <h4>1. Acceptance of Terms</h4>
            <p>By accessing or using StreetTaco, you confirm that you have read, understood, and agree to be bound by this End User License Agreement.</p>
            <h4>2. Minimum Age Requirement</h4>
            <p>You must be at least 13 years of age to use this App. By using StreetTaco, you represent and warrant that you are at least 13 years old. If you are under 13, you may not use the App. If you are between 13 and 18, you may use the App only with the consent of a parent or legal guardian.</p>
            <h4>3. Use of the App</h4>
            <p>StreetTaco is a community-driven platform for discovering and sharing food truck locations. You agree to use the App only for lawful purposes and in a manner that does not infringe the rights of others.</p>
            <h4>4. User-Generated Content</h4>
            <p>You are solely responsible for any content you submit, including truck listings, votes, comments, and status updates. You agree not to post false, misleading, offensive, or spam content. We reserve the right to remove any content at our discretion.</p>
            <h4>5. Geolocation Data</h4>
            <p>The App uses your device's geolocation solely to display nearby food trucks. Your location data is processed on your device and is not transmitted to, stored on, or retained by our servers. We do not share your location data with any third parties. You may disable location access at any time through your device or browser settings, though this may limit the App's functionality.</p>
            <h4>6. Data Retention &amp; Local Storage</h4>
            <p>StreetTaco stores user preferences and app state locally on your device using your browser's localStorage. This data never leaves your device and is not accessible to us or any third party. You may clear this data at any time by clearing your browser's site data or using your browser's storage settings. No personal information is retained on our servers from general app usage.</p>
            <h4>7. Children's Privacy (COPPA Compliance)</h4>
            <p>StreetTaco is a general audience app and is not directed at children under the age of 13. We do not knowingly collect, use, or disclose personal information from children under 13. If you are a parent or guardian and believe your child under 13 has provided personal information through the App, please contact us at <strong>privacy@streettaco.food</strong> and we will promptly delete any such information. If we become aware that we have inadvertently collected personal information from a child under 13, we will take steps to delete that information as soon as possible.</p>
            <h4>8. No Warranty</h4>
            <p>The App is provided "as is" without warranties of any kind. Food truck locations, hours, and availability are user-reported and may not be accurate. StreetTaco is not responsible for any inaccuracies.</p>
            <h4>9. Limitation of Liability</h4>
            <p>StreetTaco and its creators shall not be liable for any damages arising from your use of the App, including but not limited to inaccurate food truck information, food quality, or service issues.</p>
            <h4>10. Changes to Terms</h4>
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
        <div className="onboarding-card" ref={trapRef}>
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
          {!isLast && (eulaStepIndex < 0 || step < eulaStepIndex) && <button className="btn-onboarding-skip" onClick={() => setStep(eulaStepIndex >= 0 ? eulaStepIndex : steps.length - 1)}>Skip</button>}
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
      <div className="onboarding-tooltip" ref={trapRef} style={getTooltipStyle()}>
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
        <button className="btn-onboarding-skip" onClick={() => setStep(eulaStepIndex >= 0 ? eulaStepIndex : steps.length - 1)}>Skip</button>
      </div>
    </div>
  );
}

export function EulaReacceptOverlay({ onAccept }) {
  const trapRef = useFocusTrap();
  const eulaStep = ONBOARDING_STEPS.find(s => s.type === "eula");
  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-card eula-card" ref={trapRef}>
        <div className="onboarding-icon">{eulaStep?.icon || "📜"}</div>
        <div className="onboarding-title">Updated Terms</div>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", margin: "0 0 12px", textAlign: "center" }}>
          We've updated our End User License Agreement. Please review and accept the new terms to continue using StreetTaco.
        </p>
        <div className="eula-scroll">
          <p><strong>Last updated:</strong> April 4, 2026</p>
          <p>By using StreetTaco ("the App"), you agree to the following terms. If you do not agree, please do not use the App.</p>
          <h4>1. Acceptance of Terms</h4>
          <p>By accessing or using StreetTaco, you confirm that you have read, understood, and agree to be bound by this End User License Agreement.</p>
          <h4>2. Minimum Age Requirement</h4>
          <p>You must be at least 13 years of age to use this App. By using StreetTaco, you represent and warrant that you are at least 13 years old. If you are under 13, you may not use the App. If you are between 13 and 18, you may use the App only with the consent of a parent or legal guardian.</p>
          <h4>3. Use of the App</h4>
          <p>StreetTaco is a community-driven platform for discovering and sharing food truck locations. You agree to use the App only for lawful purposes and in a manner that does not infringe the rights of others.</p>
          <h4>4. User-Generated Content</h4>
          <p>You are solely responsible for any content you submit, including truck listings, votes, comments, and status updates. You agree not to post false, misleading, offensive, or spam content. We reserve the right to remove any content at our discretion.</p>
          <h4>5. Geolocation Data</h4>
          <p>The App uses your device's geolocation solely to display nearby food trucks. Your location data is processed on your device and is not transmitted to, stored on, or retained by our servers. We do not share your location data with any third parties. You may disable location access at any time through your device or browser settings, though this may limit the App's functionality.</p>
          <h4>6. Data Retention &amp; Local Storage</h4>
          <p>StreetTaco stores user preferences and app state locally on your device using your browser's localStorage. This data never leaves your device and is not accessible to us or any third party. You may clear this data at any time by clearing your browser's site data or using your browser's storage settings. No personal information is retained on our servers from general app usage.</p>
          <h4>7. Children's Privacy (COPPA Compliance)</h4>
          <p>StreetTaco is a general audience app and is not directed at children under the age of 13. We do not knowingly collect, use, or disclose personal information from children under 13. If you are a parent or guardian and believe your child under 13 has provided personal information through the App, please contact us at <strong>privacy@streettaco.food</strong> and we will promptly delete any such information. If we become aware that we have inadvertently collected personal information from a child under 13, we will take steps to delete that information as soon as possible.</p>
          <h4>8. No Warranty</h4>
          <p>The App is provided "as is" without warranties of any kind. Food truck locations, hours, and availability are user-reported and may not be accurate. StreetTaco is not responsible for any inaccuracies.</p>
          <h4>9. Limitation of Liability</h4>
          <p>StreetTaco and its creators shall not be liable for any damages arising from your use of the App, including but not limited to inaccurate food truck information, food quality, or service issues.</p>
          <h4>10. Changes to Terms</h4>
          <p>We may update this agreement at any time. Continued use of the App after changes constitutes acceptance of the updated terms.</p>
        </div>
        <div className="onboarding-btn-row">
          <button className="btn-onboarding-next" onClick={() => {
            localStorage.setItem(STORAGE_KEYS.eulaAccepted, JSON.stringify(true));
            onAccept();
          }}>I Accept</button>
        </div>
      </div>
    </div>
  );
}
