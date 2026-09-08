'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Heart, Home, MapPin, Footprints } from 'lucide-react';
import { computeMatch, fmtMoney, parseNum } from '@/lib/matching';
import { splitAddressLines } from '@/lib/homeDisplay';
import { hasCurrentCoordinates } from '@/lib/mapLocations';

let googleMapsPromise;

function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    const callback = '__flhGoogleMapsReady';
    window[callback] = () => {
      delete window[callback];
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=marker&callback=${callback}&v=weekly`;
    script.async = true;
    script.onerror = () => {
      delete window[callback];
      googleMapsPromise = undefined;
      reject(new Error('Google Maps failed to load'));
    };
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function mapLabel(home, priorities) {
  const match = computeMatch(home, priorities);
  const parts = [home.address || 'Untitled home', fmtMoney(home.price)];
  if (match?.pct != null) parts.push(`${match.pct}% Match`);
  return parts.filter(Boolean).join(' — ');
}

function HomePreview({ home, priorities }) {
  const [imageFailed, setImageFailed] = useState(false);
  const match = computeMatch(home, priorities);
  const { line1, line2 } = splitAddressLines(home.address);
  const facts = [
    home.beds && `${home.beds} bd`,
    home.baths && `${home.baths} ba`,
    home.sqft && `${parseNum(home.sqft)?.toLocaleString()} sqft`,
  ].filter(Boolean).join(' · ');

  return (
    <article className="hh-map-preview" aria-live="polite">
      <div className="hh-map-preview-photo">
        {home.photoUrl && !imageFailed
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={home.photoUrl} alt="" onError={() => setImageFailed(true)} />
          : <Home size={28} aria-hidden="true" />}
      </div>
      <div className="hh-map-preview-body">
        <div className="hh-mono hh-map-price">{fmtMoney(home.price)}</div>
        <div className="hh-address hh-map-address">{line1 || 'Untitled home'}</div>
        {line2 && <div className="hh-map-city">{line2}</div>}
        {facts && <div className="hh-mono hh-map-facts">{facts}</div>}
        <div className="hh-map-signals">
          {match?.pct != null && <strong>{match.pct}% Match</strong>}
          {home.reaction === 'love' && <span><Heart size={13} fill="currentColor" /> Favorite</span>}
          {home.status === 'Want to Tour' && <span><Footprints size={13} /> Want to Tour</span>}
          {home.coBuyerArchivedCount > 0 && <span>Archived by Co-Buyer</span>}
        </div>
        <Link className="hh-btn hh-map-view-home" href={`/homes?home=${encodeURIComponent(home.id)}`}>View home</Link>
      </div>
    </article>
  );
}

export default function SavedHomesMap({ homes, priorities }) {
  const mapped = useMemo(() => homes.filter(hasCurrentCoordinates), [homes]);
  const unresolved = useMemo(() => homes.filter((home) => !hasCurrentCoordinates(home)), [homes]);
  const [selectedId, setSelectedId] = useState(mapped[0]?.id || null);
  const [mapState, setMapState] = useState('loading');
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
  const selected = homes.find((home) => home.id === selectedId) || null;

  useEffect(() => {
    if (!mapped.length || !apiKey || !mapId) {
      setMapState(!mapped.length ? 'empty' : 'error');
      return undefined;
    }
    let cancelled = false;
    let listeners = [];
    loadGoogleMaps(apiKey).then(async (maps) => {
      const { Map: GoogleMap } = await maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await maps.importLibrary('marker');
      if (cancelled || !mapNode.current) return;
      const map = new GoogleMap(mapNode.current, {
        mapId, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        clickableIcons: false, gestureHandling: 'cooperative',
      });
      mapRef.current = map;
      const bounds = new maps.LatLngBounds();
      mapped.forEach((home) => {
        const position = { lat: Number(home.latitude), lng: Number(home.longitude) };
        const content = document.createElement('div');
        content.className = 'hh-home-marker';
        content.setAttribute('aria-hidden', 'true');
        content.innerHTML = '<span></span>';
        const marker = new AdvancedMarkerElement({ map, position, title: mapLabel(home, priorities), content });
        listeners.push(marker.addListener('click', () => setSelectedId(home.id)));
        markersRef.current.set(home.id, { marker, content, position });
        bounds.extend(position);
      });
      if (mapped.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, 56);
      }
      setMapState('ready');
    }).catch(() => !cancelled && setMapState('error'));
    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      markersRef.current.forEach(({ marker }) => { marker.map = null; });
      markersRef.current.clear();
      mapRef.current = null;
    };
  }, [mapped, priorities, apiKey, mapId]);

  useEffect(() => {
    markersRef.current.forEach(({ content, position }, id) => {
      content.classList.toggle('selected', id === selectedId);
      if (id === selectedId && mapRef.current) mapRef.current.panTo(position);
    });
  }, [selectedId, mapState]);

  if (!homes.length) {
    return (
      <section className="hh-map-empty hh-corner">
        <Home size={34} aria-hidden="true" />
        <h2 className="hh-serif">Your homes will show up here.</h2>
        <p>Add a home and we'll put it on the map.</p>
        <Link className="hh-btn" href="/homes?add=1">Add a home</Link>
      </section>
    );
  }

  return (
    <div className="hh-map-layout">
      {unresolved.length > 0 && (
        <details className="hh-map-unresolved">
          <summary>{unresolved.length} {unresolved.length === 1 ? 'home couldn’t' : 'homes couldn’t'} be placed on the map yet.</summary>
          <ul>{unresolved.map((home) => <li key={home.id}><Link href={`/homes?home=${encodeURIComponent(home.id)}`}>{home.address || 'Untitled home'}</Link></li>)}</ul>
        </details>
      )}
      {mapped.length > 0 ? (
        <div className="hh-map-stage hh-corner">
          <div ref={mapNode} className="hh-map-canvas" aria-label="Map of your saved homes" />
          {mapState === 'loading' && <div className="hh-map-message">Loading map…</div>}
          {mapState === 'error' && <div className="hh-map-message">We couldn't load the map right now. Your homes are still available below and in Homes.</div>}
          {selected && <HomePreview home={selected} priorities={priorities} />}
        </div>
      ) : (
        <section className="hh-map-empty hh-corner">
          <MapPin size={34} aria-hidden="true" />
          <h2 className="hh-serif">Your homes couldn't be placed yet.</h2>
          <p>Open a home below to check its address and look it up again.</p>
        </section>
      )}
      <section className="hh-map-list" aria-labelledby="mapped-homes-heading">
        <h2 id="mapped-homes-heading" className="hh-serif">Homes on this map</h2>
        {mapped.length ? (
          <div className="hh-map-list-items">
            {mapped.map((home) => (
              <button key={home.id} type="button" className={home.id === selectedId ? 'selected' : ''}
                aria-pressed={home.id === selectedId} onClick={() => setSelectedId(home.id)}>
                <MapPin size={16} aria-hidden="true" /><span>{mapLabel(home, priorities)}</span>
              </button>
            ))}
          </div>
        ) : <p>No homes have a verified location yet.</p>}
      </section>
    </div>
  );
}
