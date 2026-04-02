import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, Circle } from "react-leaflet";
import { RADIUS_OPTIONS, TILE_DARK, TILE_LIGHT } from "../constants";
import { getFoodEmoji, makeTruckIcon, makePendingIcon, userLocationIcon, haversineMiles, milesToMeters, formatSchedule, timeAgo, logEvent } from "../utils";
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
    <div className="map-fullscreen">
      {addMode && <div className="add-mode-overlay">📍 Tap the map to drop a pin</div>}
      {!addMode && visibleTrucks && visibleTrucks.length === 0 && trucks.length > 0 && (
        <div className="map-empty-overlay">
          <div className="map-empty-text">No trucks in this area</div>
          <button className="btn-find-nearest" onClick={onFindNearest}>📍 Find nearest truck</button>
        </div>
      )}
      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom zoomControl={false} style={{ height: "100%", width: "100%" }}>
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
                <div className={`popup-card ${truck.open ? "popup-open" : ""}`}>
                  <div className="popup-top-row">
                    <div className="popup-emoji">{getFoodEmoji(truck.foodType)}</div>
                    <div className="popup-title-block">
                      <div className="popup-name">{truck.name}{truck.isVerified && <span title="Verified"> ✅</span>}</div>
                      <div className="popup-type">{truck.street ? `${truck.foodType} · ${truck.street}` : truck.foodType}</div>
                    </div>
                    <div className={`popup-score ${truck.votes > 0 ? "positive" : truck.votes < 0 ? "negative" : ""}`}>
                      <span className="popup-score-num">{truck.votes}</span>
                      <span className="popup-score-label">votes</span>
                    </div>
                  </div>

                  <div className="popup-badges">
                    <span className={`badge ${truck.open ? "badge-open" : "badge-closed"}`} role="status" aria-label={truck.open ? "Currently open" : "Currently closed"}>{truck.open ? "● Open" : "○ Closed"}</span>
                    <span className="badge badge-dist">📏 {dist.toFixed(1)} mi</span>
                    {truck.isPermanent
                      ? <span className="badge badge-perm">📌 Permanent</span>
                      : <span className="badge badge-mobile">🚚 {timeAgo(truck.lastConfirmedAt)}</span>
                    }
                  </div>

                  {truck.hours && <div className="popup-schedule">⏰ {formatSchedule(truck.hours)}</div>}

                  <div className="popup-actions">
                    <button className="popup-action-btn popup-nav" onClick={() => { logEvent("navigate_click", { truckId: truck.id }); window.open(`https://maps.google.com/maps?daddr=${truck.position[0]},${truck.position[1]}`, "_blank"); }} aria-label="Navigate">
                      🧭 Go
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
              <div className="popup-card popup-pending">
                <div className="popup-pending-icon">📍</div>
                <div className="popup-pending-title">Pin dropped!</div>
                <div className="popup-pending-sub">Fill in the details below</div>
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
