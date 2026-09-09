'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, MapPin } from 'lucide-react';
import { computeMatch, fmtMoney } from '@/lib/matching';

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

export default function SavedHomesMap({ homes, priorities }) {
  const eligible = useMemo(() => homes.filter((home) => home.mapPosition), [homes]);
  const unresolved = useMemo(() => homes.filter((home) => !home.mapPosition), [homes]);
  const [selectedId, setSelectedId] = useState(eligible[0]?.id || null);
  const [mapState, setMapState] = useState('loading');
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
  const selected = homes.find((home) => home.id === selectedId);

  useEffect(() => {
    if (!eligible.length || !key || !mapId) { setMapState(!eligible.length ? 'empty' : 'unconfigured'); return; }
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
        const marker = new AdvancedMarkerElement({ map, position: home.mapPosition, title: home.address, content: MarkerContent({ selected: home.id === selectedId, address: home.address }) });
        marker.addListener('click', () => setSelectedId(home.id));
        markersRef.current.set(home.id, marker);
        bounds.extend(home.mapPosition);
      });
      if (eligible.length === 1) { map.setCenter(eligible[0].mapPosition); map.setZoom(14); }
      else map.fitBounds(bounds, 56);
      setMapState('ready');
    }).catch(() => !cancelled && setMapState('error'));
    return () => { cancelled = true; markersRef.current.forEach((marker) => { marker.map = null; }); markersRef.current.clear(); };
  }, [eligible, key, mapId]);

  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const home = eligible.find((item) => item.id === id);
      marker.content = MarkerContent({ selected: id === selectedId, address: home?.address });
    });
    const home = eligible.find((item) => item.id === selectedId);
    if (home && mapRef.current) mapRef.current.panTo(home.mapPosition);
  }, [selectedId, eligible]);

  if (!homes.length) return <div className="hh-map-empty"><Home size={30} /><h2>Your homes will show up here.</h2><p>Add a home and we'll put it on the map.</p><Link className="hh-btn" href="/homes?add=1">Add home</Link></div>;
  const match = selected ? computeMatch(selected, priorities) : null;

  return <div className="hh-map-layout">
    <div className="hh-map-stage">
      <div ref={canvasRef} className="hh-map-canvas" role="region" aria-label="Map of your saved homes" />
      {mapState !== 'ready' && <div className="hh-map-message">
        <MapPin size={28} />
        <strong>{eligible.length ? (mapState === 'loading' ? 'Placing your saved homes…' : mapState === 'error' ? "The map couldn't load." : 'Map setup is needed.') : "Your homes couldn't be placed yet."}</strong>
        <span>{eligible.length ? (mapState === 'loading' ? 'This should only take a moment.' : 'You can still choose a home from the list.') : 'Open a home to check its address and location.'}</span>
      </div>}
      {selected && <article className="hh-map-preview">
        {selected.photoUrl && <img src={selected.photoUrl} alt="" />}
        <div className="hh-map-preview-copy"><div className="hh-mono hh-map-preview-price">{fmtMoney(selected.price)}</div><strong className="hh-address">{selected.address}</strong>
          <small>{[selected.beds && `${selected.beds} beds`, selected.baths && `${selected.baths} baths`, selected.sqft && `${selected.sqft} sq ft`].filter(Boolean).join(' · ')}</small>
          {match?.pct !== null && match?.pct !== undefined && <span className="hh-map-match">{match.pct}% Match</span>}
          {selected.status && <span className="hh-map-status">{selected.status}</span>}
          <Link href={`/homes?home=${encodeURIComponent(selected.id)}`}>View home</Link>
        </div>
      </article>}
    </div>
    <section aria-label="Mapped homes"><h2 className="hh-serif">Mapped homes</h2><div className="hh-map-home-list">{eligible.map((home) => <button key={home.id} type="button" className={home.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(home.id)}><MapPin size={15} /><span>{home.address}</span></button>)}</div></section>
    {unresolved.length > 0 && <details className="hh-details"><summary>{unresolved.length} {unresolved.length === 1 ? 'home' : 'homes'} couldn't be placed on the map yet.</summary><div className="hh-map-unresolved">{unresolved.map((home) => <Link key={home.id} href={`/homes?home=${encodeURIComponent(home.id)}`}>{home.address || 'Address not added'} <span>Check home</span></Link>)}</div></details>}
  </div>;
}
