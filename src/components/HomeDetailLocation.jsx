'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Car, Home, MapPin } from 'lucide-react';
import { currentDestinationCoordinates, currentHomeCoordinates } from '@/lib/commute';
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
  const [mapState, setMapState] = useState('checking');
  const canvasRef = useRef(null);
  const destinationKey = useMemo(() => destinations.map((item) => `${item.id}:${item.address}:${item.coordinateStatus}`).join('|'), [destinations]);
  const selected = destinations.find((item) => item.id === selectedId) || destinations[0];

  useEffect(() => {
    let current = true;
    Promise.all([
      currentHomeCoordinates(home),
      Promise.all(destinations.map(async (destination) => [destination.id, await currentDestinationCoordinates(destination)])),
    ]).then(([homePoint, destinationPoints]) => {
      if (!current) return;
      setPoints({ home: homePoint, destinations: new Map(destinationPoints.filter(([, point]) => point)) });
    });
    return () => { current = false; };
  }, [home.address, home.latitude, home.longitude, home.coordinateStatus, home.coordinateAddressFingerprint, destinationKey]);

  useEffect(() => {
    const destinationPoint = points.destinations.get(selected?.id);
    const visiblePoints = [points.home, destinationPoint].filter(Boolean);
    if (!visiblePoints.length) { setMapState('empty'); return undefined; }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
    if (!key || !mapId) { setMapState('unconfigured'); return undefined; }
    let cancelled = false;
    const markers = [];
    loadGoogleMaps(key).then(async (maps) => {
      const [{ Map: GoogleMap }, { AdvancedMarkerElement }] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')]);
      if (cancelled) return;
      const map = new GoogleMap(canvasRef.current, { mapId, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false });
      const bounds = new maps.LatLngBounds();
      if (points.home) {
        markers.push(new AdvancedMarkerElement({ map, position: points.home, title: 'Home', content: markerNode('home', 'Home') }));
        bounds.extend(points.home);
      }
      if (destinationPoint) {
        markers.push(new AdvancedMarkerElement({ map, position: destinationPoint, title: selected.label, content: markerNode('destination', selected.label) }));
        bounds.extend(destinationPoint);
      }
      if (visiblePoints.length === 1) { map.setCenter(visiblePoints[0]); map.setZoom(14); } else map.fitBounds(bounds, 58);
      setMapState('ready');
    }).catch(() => !cancelled && setMapState('error'));
    return () => { cancelled = true; markers.forEach((marker) => { marker.map = null; }); };
  }, [points, selected?.id]);

  return <div className={`hh-detail-location-grid ${mapState === 'empty' ? 'without-map' : ''}`}>
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
    {mapState !== 'empty' && <div className="hh-detail-map-wrap">
      <div ref={canvasRef} className="hh-detail-map-canvas" aria-hidden="true" />
      {mapState !== 'ready' && <div className="hh-detail-map-fallback"><MapPin size={24} aria-hidden="true" /><strong>{mapState === 'checking' ? 'Loading location…' : 'Map preview unavailable'}</strong><span>Commute details remain available alongside the map.</span></div>}
      <div className="hh-detail-map-key"><span><Home size={13} /> Home</span>{points.destinations.get(selected?.id) && <span><MapPin size={13} /> {selected?.label}</span>}</div>
    </div>}
  </div>;
}
