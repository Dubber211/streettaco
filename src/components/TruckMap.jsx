import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, Circle } from "react-leaflet";
import { RADIUS_OPTIONS, TILE_DARK, TILE_LIGHT } from "../constants";
import { getFoodEmoji, makeTruckIcon, makePendingIcon, userLocationIcon, haversineMiles, milesToMeters, formatSchedule, timeAgo } from "../utils";
import { FitBoundsToRadius, MapZoomRadiusSync, ClosePopupOnDrag, MapBoundsTracker, FocusTruck, MapClickHandler } from "./MapHelpers";
import { PopupTopComment } from "./TruckList";

export function TruckMap({ mapCenter, trucks, radiusMiles, onRadiusChange, addMode, pendingPin, onPickLocation, onVote, userVotes, userLocation, focusRequest, onBoundsChange, onStartAddTruck, canAdd, addsRemaining, theme, visibleTrucks, onFindNearest }) {
  const pendingIcon = useMemo(() => makePendingIcon(), []);
  const markerRefs = useRef({});
  const skipFitRef = useRef(false);

  // Pre-computed distance lookup from visibleTrucks to avoid redundant haversine calls
  const distanceMap = useMemo(() => {
    const map = new Map();
    if (visibleTrucks) visibleTrucks.forEach(t => map.set(t.id, t.distance));
    return map;
  }, [visibleTrucks]);

  // Clean up refs for trucks that have been removed
  useEffect(() => {
    const truckIds = new Set(trucks.map(t => t.id));
    for (const id of Object.keys(markerRefs.current)) {
      if (!truckIds.has(Number(id))) delete markerRefs.current[id];
    }
  }, [trucks]);

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
      <div className="map-radius-overlay">
        <select value={radiusMiles} onChange={e => onRadiusChange(Number(e.target.value))}>
          {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} mi</option>)}
        </select>
      </div>
      {!addMode && visibleTrucks && visibleTrucks.length === 0 && trucks.length > 0 && (
        <div className="map-empty-overlay">
          <div className="map-empty-text">No trucks in this area</div>
          <button className="btn-find-nearest" onClick={onFindNearest}>📍 Find nearest truck</button>
        </div>
      )}
      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={theme === "light" ? TILE_LIGHT : TILE_DARK}
        />
        <FitBoundsToRadius center={mapCenter} radiusMiles={radiusMiles} skipRef={skipFitRef} />
        <ClosePopupOnDrag />
        <MapBoundsTracker onBoundsChange={onBoundsChange} />
        <MapZoomRadiusSync radiusMiles={radiusMiles} onRadiusChange={onRadiusChange} skipRef={skipFitRef} />
        <FocusTruck trucks={trucks} focusRequest={focusRequest} markerRefs={markerRefs} />
        <MapClickHandler addMode={addMode} onPickLocation={onPickLocation} />

        {userLocation && (
          <Marker position={userLocation} icon={userLocationIcon}>
            <Popup autoPan={false}>
              <div className="popup-card">
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "#f1f5f9" }}>You are here</div>
              </div>
            </Popup>
          </Marker>
        )}
        <Circle center={userLocation || mapCenter} radius={milesToMeters(radiusMiles)} pathOptions={{ color: "#06b6d4", fillColor: "#06b6d4", fillOpacity: 0.06, weight: 1.5, dashArray: "6 4" }} />

        {trucks.map(truck => {
          const dist = distanceMap.get(truck.id) ?? haversineMiles(userLocation || mapCenter, truck.position);
          const isNearby = dist <= radiusMiles;
          const up = userVotes[truck.id] === 1;
          const down = userVotes[truck.id] === -1;
          const icon = makeTruckIcon(truck.foodType, truck.open);

          return (
            <Marker key={truck.id} ref={el => { if (el) markerRefs.current[truck.id] = el; }} position={truck.position} icon={icon}>
              <Popup autoPan={false}>
                <div className="popup-card">
                  <div className="popup-header">
                    <div className="popup-emoji">{getFoodEmoji(truck.foodType)}</div>
                    <div>
                      <div className="popup-name">{truck.name}{truck.isVerified && <span title="Verified"> ✅</span>}</div>
                      <div className="popup-type">{truck.street ? `${truck.foodType} on ${truck.street}` : truck.foodType}</div>
                    </div>
                  </div>
                  <div className="popup-badges">
                    <span className={`badge ${truck.open ? "badge-open" : "badge-closed"}`} role="status" aria-label={truck.open ? "Currently open" : "Currently closed"}>{truck.open ? "● Open" : "○ Closed"}</span>
                    <span className={`badge ${truck.isPermanent ? "badge-perm" : "badge-mobile"}`}>{truck.isPermanent ? "📌 Permanent" : "🚚 Mobile"}</span>
                    {isNearby && <span className="badge badge-nearby">📍 Nearby</span>}
                  </div>
                  <div className="popup-meta">
                    <span>⭐ {truck.votes} votes</span>
                    <span>📏 {dist.toFixed(1)} mi</span>
                    {truck.hours && <span>⏰ {formatSchedule(truck.hours)}</span>}
                    {!truck.isPermanent && <span>📍 confirmed {timeAgo(truck.lastConfirmedAt)}</span>}
                  </div>
                  <PopupTopComment truckId={truck.id} />
                  <div className="popup-actions">
                    <button className={`btn-vote btn-vote-up ${up ? "voted" : ""}`} onClick={() => onVote(truck.id, 1)} disabled={up} aria-label="Upvote">
                      😊
                    </button>
                    <button className={`btn-vote btn-vote-down ${down ? "voted" : ""}`} onClick={() => onVote(truck.id, -1)} disabled={down} aria-label="Downvote">
                      😞
                    </button>
                    <button className="btn-vote btn-vote-nav" onClick={() => window.open(`https://maps.google.com/maps?daddr=${truck.position[0]},${truck.position[1]}`, "_blank")} aria-label="Navigate">
                      🧭
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {pendingPin && (
          <Marker position={pendingPin} icon={pendingIcon}>
            <Popup autoPan={false}>
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
