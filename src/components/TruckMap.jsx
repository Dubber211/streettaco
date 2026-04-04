import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, Circle, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { RADIUS_OPTIONS, TILE_DARK, TILE_DARK_LABELS, TILE_LIGHT } from "../constants";
import { getFoodEmoji, makeTruckIcon, makePendingIcon, userLocationIcon, haversineMiles, milesToMeters, formatSchedule, getTodayHoursContext, timeAgo, logEvent } from "../utils";
import { FitBoundsToRadius, MapZoomRadiusSync, ClosePopupOnDrag, MapBoundsTracker, FocusTruck, MapClickHandler } from "./MapHelpers";
import { PopupTopComment } from "./TruckList";

function UserPanDetector({ onPan }) {
  useMapEvents({ dragstart: onPan, zoomstart: onPan });
  return null;
}

/* ─── Navigation Mode: follow user position on map ─────────────────────────── */
function FollowNavUser({ userPos, truckPos }) {
  const map = useMap();
  const fittedRef = useRef(false);

  // Fit bounds to show both user and truck on first render
  useEffect(() => {
    if (!userPos || !truckPos || fittedRef.current) return;
    fittedRef.current = true;
    const bounds = L.latLngBounds([userPos, truckPos]);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  }, [userPos, truckPos, map]);

  // Pan to follow user as they move (after initial fit)
  useEffect(() => {
    if (!userPos || !fittedRef.current) return;
    map.panTo(userPos, { animate: true, duration: 0.5 });
  }, [userPos, map]);

  return null;
}

function formatNavDuration(seconds) {
  if (seconds < 60) return "< 1 min";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

function formatNavDistance(miles) {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(1)} mi`;
}

/* ─── Navigation Bar ───────────────────────────────────────────────────────── */
function NavBar({ navTarget, navRoute, navDistanceRemaining, navArrived, navLoading, onStopNav, onNavArrived }) {
  const emoji = getFoodEmoji(navTarget.foodType);
  const etaSeconds = navRoute?.duration;
  const routeMiles = navRoute ? navRoute.distance / 1609.34 : null;

  return (
    <div className="nav-bar">
      <div className="nav-bar-top">
        <button className="nav-bar-close" onClick={onStopNav} aria-label="Stop navigation">✕</button>
        <div className="nav-bar-info">
          <div className="nav-bar-truck">
            <span className="nav-bar-emoji">{emoji}</span>
            <span className="nav-bar-name">{navTarget.name}</span>
          </div>
          {navLoading ? (
            <div className="nav-bar-meta">Finding route...</div>
          ) : navRoute && (
            <div className="nav-bar-stats">
              <span className="nav-bar-stat">
                <span className="nav-bar-stat-num">{formatNavDuration(etaSeconds)}</span>
                <span className="nav-bar-stat-label">ETA</span>
              </span>
              <span className="nav-bar-stat-divider" />
              <span className="nav-bar-stat">
                <span className="nav-bar-stat-num">{formatNavDistance(navDistanceRemaining ?? routeMiles)}</span>
                <span className="nav-bar-stat-label">away</span>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="nav-bar-actions">
        {navArrived ? (
          <button className="nav-bar-btn nav-bar-arrived" onClick={onNavArrived}>
            I'm here! ✅
          </button>
        ) : (
          <button className="nav-bar-btn nav-bar-maps" onClick={() => window.open(`https://maps.google.com/maps?daddr=${navTarget.position[0]},${navTarget.position[1]}`, "_blank")}>
            Open in Maps 🗺️
          </button>
        )}
      </div>
    </div>
  );
}

export function TruckMap({ mapCenter, trucks, radiusMiles, onRadiusChange, addMode, pendingPin, onPickLocation, onVote, userVotes, userLocation, focusRequest, onBoundsChange, onStartAddTruck, canAdd, addsRemaining, theme, visibleTrucks, onFindNearest, onNavigate, navTarget, navRoute, navUserPos, navLoading, navDistanceRemaining, navArrived, onStopNav, onNavArrived }) {
  const pendingIcon = useMemo(() => makePendingIcon(), []);
  const markerRefs = useRef({});
  const skipFitRef = useRef(false);
  const [userPanned, setUserPanned] = useState(false);

  // Reset the panned flag when map center changes programmatically (search, location, etc.)
  useEffect(() => { setUserPanned(false); }, [mapCenter]);

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
      {!addMode && !userPanned && visibleTrucks && visibleTrucks.length === 0 && trucks.length > 0 && (
        <div className="map-empty-overlay" onClick={() => setUserPanned(true)}>
          <div className="map-empty-card" onClick={e => e.stopPropagation()}>
            <img src="/favicon.png" alt="StreetTaco" className="empty-logo" />
            <div className="map-empty-title">No trucks nearby</div>
            <div className="map-empty-sub">Try expanding your radius or searching a different area</div>
            <div className="empty-actions">
              <button className="btn-find-nearest" onClick={onFindNearest}>Find a truck</button>
              {canAdd && <button className="btn-add-first" onClick={onStartAddTruck}>Add the first</button>}
            </div>
          </div>
        </div>
      )}
      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom zoomControl={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={theme === "light" ? TILE_LIGHT : TILE_DARK}
        />
        {theme === "dark" && (
          <TileLayer
            key="dark-labels"
            url={TILE_DARK_LABELS}
            className="labels-overlay"
          />
        )}
        <FitBoundsToRadius center={mapCenter} radiusMiles={radiusMiles} skipRef={skipFitRef} />
        <UserPanDetector onPan={() => setUserPanned(true)} />
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
        {!navTarget && <Circle center={userLocation || mapCenter} radius={milesToMeters(radiusMiles)} pathOptions={{ color: "#06b6d4", fillColor: "#06b6d4", fillOpacity: 0.06, weight: 1.5, dashArray: "6 4" }} />}

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

                  {truck.hours && (() => {
                    const ctx = getTodayHoursContext(truck.hours);
                    return (
                      <div className="popup-schedule">
                        ⏰ {formatSchedule(truck.hours)}
                        {ctx && <span className={`popup-hours-context ${ctx.startsWith("Closing") ? "closing-soon" : ""}`}> · {ctx}</span>}
                      </div>
                    );
                  })()}

                  <div className="popup-actions">
                    <button className="popup-action-btn popup-nav" onClick={() => { logEvent("navigate_click", { truckId: truck.id }); onNavigate(truck.id); }} aria-label="Navigate">
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

        {/* Navigation mode: route line + follow user */}
        {navRoute && <Polyline positions={navRoute.geometry} pathOptions={{ color: "#06b6d4", weight: 5, opacity: 0.85, lineCap: "round", lineJoin: "round" }} />}
        {navTarget && navUserPos && <FollowNavUser userPos={navUserPos} truckPos={navTarget.position} />}
        {navUserPos && navTarget && (
          <Marker position={navUserPos} icon={userLocationIcon} />
        )}
      </MapContainer>

      {/* Navigation bar overlay */}
      {navTarget && (
        <NavBar
          navTarget={navTarget}
          navRoute={navRoute}
          navDistanceRemaining={navDistanceRemaining}
          navArrived={navArrived}
          navLoading={navLoading}
          onStopNav={onStopNav}
          onNavArrived={onNavArrived}
        />
      )}
    </div>
  );
}

/* ─── Truck List ────────────────────────────────────────────────────────────── */
/* ─── Popup Top Comment ────────────────────────────────────────────────────── */
