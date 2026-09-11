'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, MapPin } from 'lucide-react';
import { computeMatch } from '@/lib/matching';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { formatHomePrice } from '@/lib/homeDisplay';

let mapsPromise;
function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const callback = `flhGoogleMapsReady${Date.now()}`;
    window[callback] = () => { delete window[callback]; resolve(window.google.maps); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=marker&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps could not load'));
    document.head.appendChild(script);
  });
  return mapsPromise;
}

function MarkerContent({ selected, address }) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `hh-map-marker${selected ? ' selected' : ''}`;
  node.setAttribute('aria-label', `${selected ? 'Selected home' : 'Select saved home'}: ${address || 'Address not added'}`);
  node.setAttribute('aria-pressed', String(selected));
  node.innerHTML = '<span aria-hidden="true">⌂</span>';
  return node;
}

function DestinationMarkerContent({ selected, label }) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `hh-map-marker hh-map-destination-marker${selected ? ' selected' : ''}`;
  node.setAttribute('aria-label', `${selected ? 'Selected place' : 'Select place'}: ${label}`);
  node.setAttribute('aria-pressed', String(selected));
  node.innerHTML = '<span aria-hidden="true">•</span>';
  return node;
}

export default function SavedHomesMap({ homes, destinations = [], priorities }) {
  const vocabulary = homeVocabulary(priorities);
  const eligible = useMemo(() => homes.filter((home) => home.mapPosition), [homes]);
  const eligibleDestinations = useMemo(() => destinations.filter((destination) => destination.mapPosition), [destinations]);
  const unresolved = useMemo(() => homes.filter((home) => !home.mapPosition), [homes]);
  const [selection, setSelection] = useState(eligible[0] ? { type: 'home', id: eligible[0].id } : null);
  const [mapState, setMapState] = useState('loading');
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
  const selected = selection?.type === 'home' ? homes.find((home) => home.id === selection.id) : null;
  const selectedDestination = selection?.type === 'destination' ? destinations.find((destination) => destination.id === selection.id) : null;

  useEffect(() => {
    if ((!eligible.length && !eligibleDestinations.length) || !key || !mapId) { setMapState(!eligible.length && !eligibleDestinations.length ? 'empty' : 'unconfigured'); return; }
    let cancelled = false;
    loadGoogleMaps(key).then(async (maps) => {
      const [{ Map: GoogleMap }, { AdvancedMarkerElement }] = await Promise.all([
        maps.importLibrary('maps'), maps.importLibrary('marker'),
      ]);
      if (cancelled) return;
      const map = new GoogleMap(canvasRef.current, { mapId, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      mapRef.current = map;
      const bounds = new maps.LatLngBounds();
      eligible.forEach((home) => {
        const marker = new AdvancedMarkerElement({ map, position: home.mapPosition, title: homeIdentity(home, priorities).accessible, content: MarkerContent({ selected: selection?.type === 'home' && home.id === selection.id, address: homeIdentity(home, priorities).accessible }) });
        marker.addListener('click', () => setSelection({ type: 'home', id: home.id }));
        markersRef.current.set(`home:${home.id}`, marker);
        bounds.extend(home.mapPosition);
      });
      eligibleDestinations.forEach((destination) => {
        const marker = new AdvancedMarkerElement({ map, position: destination.mapPosition, title: destination.label, content: DestinationMarkerContent({ selected: selection?.type === 'destination' && destination.id === selection.id, label: destination.label }) });
        marker.addListener('click', () => setSelection({ type: 'destination', id: destination.id }));
        markersRef.current.set(`destination:${destination.id}`, marker);
        bounds.extend(destination.mapPosition);
      });
      if (eligible.length + eligibleDestinations.length === 1) { map.setCenter((eligible[0] || eligibleDestinations[0]).mapPosition); map.setZoom(14); }
      else map.fitBounds(bounds, 56);
      setMapState('ready');
    }).catch(() => !cancelled && setMapState('error'));
    return () => { cancelled = true; markersRef.current.forEach((marker) => { marker.map = null; }); markersRef.current.clear(); };
  }, [eligible, eligibleDestinations, key, mapId]);

  useEffect(() => {
    markersRef.current.forEach((marker, keyName) => {
      const [type, id] = keyName.split(':');
      if (type === 'home') {
        const home = eligible.find((item) => item.id === id);
        marker.content = MarkerContent({ selected: selection?.type === 'home' && id === selection.id, address: home ? homeIdentity(home, priorities).accessible : '' });
      } else {
        const destination = eligibleDestinations.find((item) => item.id === id);
        marker.content = DestinationMarkerContent({ selected: selection?.type === 'destination' && id === selection.id, label: destination?.label });
      }
    });
    const selectedItem = selection?.type === 'home'
      ? eligible.find((item) => item.id === selection.id)
      : eligibleDestinations.find((item) => item.id === selection?.id);
    if (selectedItem && mapRef.current) mapRef.current.panTo(selectedItem.mapPosition);
  }, [selection, eligible, eligibleDestinations]);

  if (!homes.length && !destinations.length) return <div className="hh-map-empty"><Home size={30} /><h2>Your {vocabulary.pluralLower} and places will show up here.</h2><p>Add a {vocabulary.singularLower} or a place that matters to start your map.</p><Link className="hh-btn" href="/homes?add=1">Add {vocabulary.singularLower}</Link></div>;
  const match = selected ? computeMatch(selected, priorities) : null;

  return <div className="hh-map-layout">
    <div className="hh-map-stage">
      <div ref={canvasRef} className="hh-map-canvas" role="region" aria-label="Map of your saved homes and places that matter" />
      {mapState !== 'ready' && <div className="hh-map-message">
        <MapPin size={28} />
        <strong>{eligible.length || eligibleDestinations.length ? (mapState === 'loading' ? 'Placing your homes and places…' : "The map isn't available right now.") : "Your locations couldn't be placed yet."}</strong>
        <span>{eligible.length || eligibleDestinations.length ? (mapState === 'loading' ? 'This should only take a moment.' : 'Your locations are still listed below.') : 'Check the saved addresses and try again.'}</span>
      </div>}
      {selected && <article className="hh-map-preview">
        {selected.photoUrl && <img src={selected.photoUrl} alt="" />}
        <div className="hh-map-preview-copy"><div className="hh-mono hh-map-preview-price">{formatHomePrice(selected.price, priorities.searchType) || 'Price not added'}</div><strong className="hh-address">{homeIdentity(selected, priorities).primary}</strong>{homeIdentity(selected, priorities).option && <small>{homeIdentity(selected, priorities).option}</small>}{homeIdentity(selected, priorities).supporting && <small>{homeIdentity(selected, priorities).supporting}</small>}
          <small>{[selected.beds && `${selected.beds} beds`, selected.baths && `${selected.baths} baths`, selected.sqft && `${selected.sqft} sq ft`].filter(Boolean).join(' · ')}</small>
          {match?.pct !== null && match?.pct !== undefined && <span className="hh-map-match">{match.pct}% Match</span>}
          {selected.status && <span className="hh-map-status">{selected.status}</span>}
          <Link href={`/homes/${encodeURIComponent(selected.id)}`}>View {vocabulary.singularLower}</Link>
        </div>
      </article>}
      {selectedDestination && <article className="hh-map-preview hh-map-destination-preview">
        <MapPin size={28} aria-hidden="true" />
        <div className="hh-map-preview-copy"><div className="hh-map-place-label">Place that matters</div><strong>{selectedDestination.label}</strong><small>{selectedDestination.address}</small></div>
      </article>}
    </div>
    <section aria-label="Mapped homes"><h2 className="hh-serif">Mapped homes</h2><div className="hh-map-home-list">{eligible.map((home) => <button key={home.id} type="button" className={selection?.type === 'home' && home.id === selection.id ? 'selected' : ''} onClick={() => setSelection({ type: 'home', id: home.id })}><Home size={15} /><span>{homeIdentity(home, priorities).primary}</span></button>)}</div></section>
    {eligibleDestinations.length > 0 && <section aria-label="Mapped places that matter"><h2 className="hh-serif">Places that matter</h2><div className="hh-map-home-list">{eligibleDestinations.map((destination) => <button key={destination.id} type="button" className={selection?.type === 'destination' && destination.id === selection.id ? 'selected' : ''} onClick={() => setSelection({ type: 'destination', id: destination.id })}><MapPin size={15} /><span>{destination.label}</span></button>)}</div></section>}
    {unresolved.length > 0 && <details className="hh-details"><summary>{unresolved.length} {unresolved.length === 1 ? 'home' : 'homes'} couldn't be placed on the map yet.</summary><div className="hh-map-unresolved">{unresolved.map((home) => <Link key={home.id} href={`/homes/${encodeURIComponent(home.id)}`}>{home.address || 'Address not added'} <span>Check home</span></Link>)}</div></details>}
  </div>;
}
