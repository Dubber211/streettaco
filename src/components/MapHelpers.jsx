import { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { RADIUS_OPTIONS, DAY_LABELS } from "../constants";
import { haversineMiles, parseSchedule } from "../utils";

export function FitBoundsToRadius({ center, radiusMiles, skipRef }) {
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
      setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { animate: false }); }, 150);
      setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { animate: false }); }, 500);
    } else {
      map.fitBounds(bounds, { animate: true });
    }
  }, [center, radiusMiles, map, skipRef]);
  return null;
}

export function MapZoomRadiusSync({ radiusMiles, onRadiusChange, skipRef }) {
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



export function ClosePopupOffScreen() {
  const map = useMap();
  useEffect(() => {
    const check = () => {
      const popup = map._popup;
      if (!popup || !popup.getLatLng()) return;
      if (!map.getBounds().contains(popup.getLatLng())) map.closePopup();
    };
    map.on("moveend zoomend", check);
    return () => map.off("moveend zoomend", check);
  }, [map]);
  return null;
}

export function MapBoundsTracker({ onBoundsChange }) {
  const map = useMap();
  const timerRef = useRef(null);
  useEffect(() => {
    const update = () => { const b = map.getBounds(); onBoundsChange({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }); };
    const debouncedUpdate = () => { clearTimeout(timerRef.current); timerRef.current = setTimeout(update, 150); };
    update(); // initial bounds immediately
    map.on("moveend zoomend", debouncedUpdate);
    return () => { map.off("moveend zoomend", debouncedUpdate); clearTimeout(timerRef.current); };
  }, [map, onBoundsChange]);
  return null;
}

export function FocusTruck({ trucks, focusRequest, markerRefs, zoom = 15 }) {
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

export function MapClickHandler({ addMode, onPickLocation }) {
  useMapEvents({ click(e) { if (addMode) onPickLocation([e.latlng.lat, e.latlng.lng]); } });
  return null;
}

export function ScheduleInput({ value, onChange }) {
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
