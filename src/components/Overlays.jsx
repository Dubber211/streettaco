import { useEffect, useMemo, useState } from "react";
import { PROXIMITY_KEY, PROXIMITY_RADIUS_MILES, ONBOARDING_STEPS, STORAGE_KEYS } from "../constants";
import { haversineMiles } from "../utils";

/* ─── Proximity Prompt ─────────────────────────────────────────────────────── */
export function getStoredDismissals() {
  try { return JSON.parse(localStorage.getItem(PROXIMITY_KEY) || "{}"); } catch { return {}; }
}

export function ProximityPrompt({ userLocation, trucks, onConfirm }) {
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

export function OnboardingOverlay({ onDismiss }) {
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


