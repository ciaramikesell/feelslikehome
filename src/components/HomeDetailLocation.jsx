'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Car, Home, MapPin } from 'lucide-react';
import { currentDestinationCoordinates, currentHomeCoordinates, validMapPoint } from '@/lib/commute';
import { loadGoogleMaps } from '@/lib/googleMaps';

function markerNode(kind, label) {
  const node = document.createElement('div');
  node.className = `hh-detail-map-marker ${kind}`;
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = kind === 'home' ? '<span>⌂</span>' : '<span>•</span>';
  node.title = label;
  return node;
}

/**
 * A deliberately small consumer of the same Google loader and coordinate
 * provenance checks as the Map workspace. It renders markers only: commute
 * duration responses do not include route geometry, so drawing a line here
 * would incorrectly imply that FLH knows the route.
 */
export default function HomeDetailLocation({ home, destinations, getState }) {
  const [selectedId, setSelectedId] = useState(destinations[0]?.id ?? null);
  const [points, setPoints] = useState({ home: null, destinations: new Map() });
  const [mapState, setMapState] = useState('loading');
  const [coordinatesReady, setCoordinatesReady] = useState(false);
  const canvasRef = useRef(null);
  const destinationKey = useMemo(() => destinations.map((item) => `${item.id}:${item.address}:${item.coordinateStatus}`).join('|'), [destinations]);
  const selected = destinations.find((item) => item.id === selectedId) || destinations[0];
  const selectedCommute = selected ? getState(selected) : null;
  const transientHomePoint = validMapPoint(selectedCommute?.homeCoordinates);
  const transientDestinationPoint = validMapPoint(selectedCommute?.destinationCoordinates);

  useEffect(() => {
    let current = true;
    setCoordinatesReady(false);
    Promise.all([
      currentHomeCoordinates(home),
      Promise.all(destinations.map(async (destination) => [destination.id, await currentDestinationCoordinates(destination)])),
    ]).then(([homePoint, destinationPoints]) => {
      if (!current) return;
      setPoints({ home: homePoint, destinations: new Map(destinationPoints.filter(([, point]) => point)) });
      setCoordinatesReady(true);
    });
    return () => { current = false; };
  }, [home.address, home.latitude, home.longitude, home.coordinateStatus, home.coordinateAddressFingerprint, destinationKey]);

  useEffect(() => {
    if (!coordinatesReady && !transientHomePoint && !transientDestinationPoint) { setMapState('loading'); return undefined; }
    const homePoint = points.home || transientHomePoint;
    const destinationPoint = points.destinations.get(selected?.id) || transientDestinationPoint;
    const visiblePoints = [homePoint, destinationPoint].filter(Boolean);
    if (!visiblePoints.length) { setMapState('empty'); return undefined; }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
    if (!key) { setMapState('unconfigured'); return undefined; }
    setMapState('loading');
    let cancelled = false;
    const markers = [];
    loadGoogleMaps(key).then(async (maps) => {
      const [{ Map: GoogleMap, Marker }, markerLibrary] = await Promise.all([
        maps.importLibrary('maps'),
        mapId ? maps.importLibrary('marker') : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (!canvasRef.current) throw new Error('Map canvas is not mounted');
      const map = new GoogleMap(canvasRef.current, { ...(mapId ? { mapId } : {}), mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false });
      const bounds = new maps.LatLngBounds();
      const addMarker = (position, title, kind) => {
        const marker = mapId
          ? new markerLibrary.AdvancedMarkerElement({ map, position, title, content: markerNode(kind, title) })
          : new Marker({ map, position, title });
        markers.push(marker);
      };
      if (homePoint) {
        addMarker(homePoint, 'Home', 'home');
        bounds.extend(homePoint);
      }
      if (destinationPoint) {
        addMarker(destinationPoint, selected.label, 'destination');
        bounds.extend(destinationPoint);
      }
      if (visiblePoints.length === 1) { map.setCenter(visiblePoints[0]); map.setZoom(14); } else map.fitBounds(bounds, 58);
      setMapState('ready');
    }).catch(() => !cancelled && setMapState('error'));
    return () => {
      cancelled = true;
      markers.forEach((marker) => {
        if (typeof marker.setMap === 'function') marker.setMap(null);
        else marker.map = null;
      });
    };
  }, [points, selected?.id, coordinatesReady, transientHomePoint?.lat, transientHomePoint?.lng, transientDestinationPoint?.lat, transientDestinationPoint?.lng]);

  return <div className="hh-detail-location-grid">
    <div className="hh-detail-route-list" aria-label="Places that matter">
      {destinations.map((destination) => {
        const state = getState(destination);
        const resolved = state.status === 'ok';
        return <button key={destination.id} type="button" className={destination.id === selected?.id ? 'selected' : ''} aria-pressed={destination.id === selected?.id} onClick={() => setSelectedId(destination.id)}>
          <Car size={18} aria-hidden="true" />
          <span><strong>{destination.label}</strong><small>{resolved ? `${state.minutes} min drive` : state.status === 'loading' || state.status === 'idle' ? 'Calculating…' : 'Not available yet'}</small></span>
        </button>;
      })}
    </div>
    <div className="hh-detail-map-wrap">
      <div ref={canvasRef} className="hh-detail-map-canvas" aria-hidden="true" />
      {mapState !== 'ready' && <div className="hh-detail-map-fallback" role="status"><MapPin size={24} aria-hidden="true" /><strong>{mapState === 'loading' ? 'Loading map…' : 'Map preview unavailable'}</strong><span>Commute details remain available alongside the map.</span></div>}
      {mapState === 'ready' && <div className="hh-detail-map-key"><span><Home size={13} /> Home</span>{(points.destinations.get(selected?.id) || transientDestinationPoint) && <span><MapPin size={13} /> {selected?.label}</span>}</div>}
    </div>
  </div>;
}
