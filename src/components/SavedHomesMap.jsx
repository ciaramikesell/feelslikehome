'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Crosshair, Home, MapPin } from 'lucide-react';
import { computeMatch } from '@/lib/matching';
import { homeIdentity, homeVocabulary } from '@/lib/homePresentation';
import { formatHomePrice } from '@/lib/homeDisplay';
import { loadGoogleMaps } from '@/lib/googleMaps';

function MarkerContent({ selected, address }) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `hh-map-marker${selected ? ' selected' : ''}`;
  node.setAttribute('aria-label', `${selected ? 'Selected home' : 'Select saved home'}: ${address || 'Address not added'}`);
  node.setAttribute('aria-pressed', String(selected));
  node.innerHTML = '<span aria-hidden="true">⌂</span>';
  return node;
}

// Places That Matter markers use the sage/positive location language, never
// the terracotta home language, so a place can never be mistaken for a
// contender — a collaborator's place gets an additional modifier class for
// its own quieter attribution color, but is otherwise the same marker type.
function DestinationMarkerContent({ selected, label, isCollaborator }) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `hh-map-marker hh-map-destination-marker${isCollaborator ? ' is-collaborator' : ''}${selected ? ' selected' : ''}`;
  node.setAttribute('aria-label', `${selected ? 'Selected place' : 'Select place'}: ${label}`);
  node.setAttribute('aria-pressed', String(selected));
  node.innerHTML = '<span aria-hidden="true">•</span>';
  return node;
}

export default function SavedHomesMap({ homes, destinations = [], collaboratorDestinations = [], collaboratorName = null, priorities }) {
  const vocabulary = homeVocabulary(priorities);
  const eligible = useMemo(() => homes.filter((home) => home.mapPosition), [homes]);
  const unresolved = useMemo(() => homes.filter((home) => !home.mapPosition), [homes]);
  // Places That Matter displayed on Map may come from more than one
  // decision-making participant, but displaying a place here never
  // transfers ownership, creates a shared criterion, or allows editing --
  // each row just carries who it belongs to for attribution. Own and
  // collaborator places share one list/marker pipeline from here on so
  // selection, markers, and the rail/cards behave identically for both.
  const places = useMemo(() => [
    ...destinations.map((d) => ({ ...d, owner: 'self' })),
    ...collaboratorDestinations.map((d) => ({ ...d, owner: 'collaborator' })),
  ], [destinations, collaboratorDestinations]);
  const eligibleDestinations = useMemo(() => places.filter((destination) => destination.mapPosition), [places]);
  const isCollaborativeMap = eligibleDestinations.some((destination) => destination.owner === 'collaborator');
  // Start with the geography unobstructed. A preview is an explicit result of
  // choosing a marker/list row, rather than permanent furniture over the map.
  const [selection, setSelection] = useState(null);
  const [mapState, setMapState] = useState('loading');
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const mapsApiRef = useRef(null);
  const markersRef = useRef(new Map());
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
  const selected = selection?.type === 'home' ? homes.find((home) => home.id === selection.id) : null;
  const selectedDestination = selection?.type === 'destination' ? places.find((destination) => destination.id === selection.id) : null;

  useEffect(() => {
    if ((!eligible.length && !eligibleDestinations.length) || !key || !mapId) { setMapState(!eligible.length && !eligibleDestinations.length ? 'empty' : 'unconfigured'); return; }
    let cancelled = false;
    loadGoogleMaps(key).then(async (maps) => {
      const [{ Map: GoogleMap }, { AdvancedMarkerElement }] = await Promise.all([
        maps.importLibrary('maps'), maps.importLibrary('marker'),
      ]);
      if (cancelled) return;
      mapsApiRef.current = maps;
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
        const marker = new AdvancedMarkerElement({ map, position: destination.mapPosition, title: destination.label, content: DestinationMarkerContent({ selected: selection?.type === 'destination' && destination.id === selection.id, label: destination.label, isCollaborator: destination.owner === 'collaborator' }) });
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
        marker.content = DestinationMarkerContent({ selected: selection?.type === 'destination' && id === selection.id, label: destination?.label, isCollaborator: destination?.owner === 'collaborator' });
      }
    });
    const selectedItem = selection?.type === 'home'
      ? eligible.find((item) => item.id === selection.id)
      : eligibleDestinations.find((item) => item.id === selection?.id);
    // Only pan when the selected marker isn't already comfortably in view --
    // clicking a rail row/card for a marker that's already visible shouldn't
    // jolt the map.
    if (selectedItem && mapRef.current) {
      const bounds = mapRef.current.getBounds();
      if (!bounds || !bounds.contains(selectedItem.mapPosition)) mapRef.current.panTo(selectedItem.mapPosition);
    }
  }, [selection, eligible, eligibleDestinations]);

  // Recenter is a map-workspace recovery action (undo panning/zooming away
  // from the relevant search geography), not device geolocation -- it fits
  // the same mapped homes + places the map already loaded, never requests
  // the user's physical location.
  const recenter = () => {
    const map = mapRef.current;
    const mapsApi = mapsApiRef.current;
    if (!map || !mapsApi) return;
    const points = [...eligible.map((home) => home.mapPosition), ...eligibleDestinations.map((destination) => destination.mapPosition)];
    if (!points.length) return;
    if (points.length === 1) { map.setCenter(points[0]); map.setZoom(14); return; }
    const bounds = new mapsApi.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 56);
  };

  if (!homes.length && !places.length) return <div className="hh-map-empty"><Home size={30} /><h2>Your {vocabulary.pluralLower} and places will show up here.</h2><p>Add a {vocabulary.singularLower} or a place that matters to start your map.</p><Link className="hh-btn" href="/homes?add=1">Add {vocabulary.singularLower}</Link></div>;
  const match = selected ? computeMatch(selected, priorities) : null;
  // Same Match-trust rule as Compare's contender picker: this Match is
  // computed without commute evaluation (the map never fetches a commute
  // matrix just to badge a preview card), which is fine — identical to the
  // canonical Home Detail Match — UNLESS the user has selected "Commute" as
  // a location priority, in which case this number and the real one could
  // differ. Detected the same structural way: presence of a
  // 'location:Commute' row in allSelected, not by re-deriving tier logic.
  const matchTrustworthy = !match?.allSelected?.some((c) => c.key === 'location:Commute');

  return <>
    <div className="hh-map-layout">
      <div className="hh-map-stage">
        <div ref={canvasRef} className="hh-map-canvas" role="region" aria-label="Map of your saved homes and places that matter" />
        {mapState === 'ready' && <button type="button" className="hh-map-recenter" onClick={recenter}><Crosshair size={14} aria-hidden="true" /> Recenter</button>}
        {mapState !== 'ready' && <div className="hh-map-message">
          <MapPin size={28} />
          <strong>{eligible.length || eligibleDestinations.length ? (mapState === 'loading' ? 'Placing your homes and places…' : "The map isn't available right now.") : "Your locations couldn't be placed yet."}</strong>
          <span>{eligible.length || eligibleDestinations.length ? (mapState === 'loading' ? 'This should only take a moment.' : 'Your locations are still listed below.') : 'Check the saved addresses and try again.'}</span>
        </div>}
        {selected && <article className="hh-map-preview" aria-label={`Selected ${vocabulary.singularLower}: ${homeIdentity(selected, priorities).accessible}`}>
          <div className="hh-map-preview-media" aria-hidden="true">{selected.photoUrl ? <img src={selected.photoUrl} alt="" /> : <div className="hh-map-preview-photo-fallback"><Home size={22} /></div>}</div>
          <div className="hh-map-preview-copy"><div className="hh-mono hh-map-preview-price">{formatHomePrice(selected.price, priorities.searchType) || 'Price not added'}</div><strong className="hh-address">{homeIdentity(selected, priorities).primary}</strong>{homeIdentity(selected, priorities).option && <small>{homeIdentity(selected, priorities).option}</small>}{homeIdentity(selected, priorities).supporting && <small>{homeIdentity(selected, priorities).supporting}</small>}
            <small className="hh-map-preview-facts">{[selected.beds && `${selected.beds} beds`, selected.baths && `${selected.baths} baths`, selected.sqft && `${selected.sqft} sq ft`].filter(Boolean).join(' · ')}</small>
            <div className="hh-map-preview-summary">
              {matchTrustworthy && match?.pct !== null && match?.pct !== undefined && <span className="hh-map-match">{match.pct}% Match</span>}
              {selected.status && <span className="hh-map-status">{selected.status}</span>}
            </div>
            <div className="hh-map-preview-actions">
              <Link href={`/homes/${encodeURIComponent(selected.id)}`}>View {vocabulary.singularLower}</Link>
              {selected.address && <a href={`https://maps.apple.com/?daddr=${encodeURIComponent(selected.address)}`} target="_blank" rel="noreferrer">Directions</a>}
            </div>
          </div>
        </article>}
        {selectedDestination && <article className="hh-map-preview hh-map-destination-preview">
          <MapPin size={28} aria-hidden="true" />
          <div className="hh-map-preview-copy">
            <div className="hh-map-place-label">{selectedDestination.owner === 'collaborator' ? `${collaboratorName || 'Your collaborator'}'s place` : 'Place that matters'}</div>
            <strong>{selectedDestination.label}</strong><small>{selectedDestination.address}</small>
          </div>
        </article>}
      </div>
      <section aria-label="Mapped homes">
        <div className="hh-map-rail-heading">
          <h2 className="hh-serif">Mapped homes</h2>
          {eligible.length > 0 && <span className="hh-map-rail-count">{eligible.length} {eligible.length === 1 ? vocabulary.singular : vocabulary.plural}</span>}
        </div>
        <div className="hh-map-home-list">{eligible.map((home) => <button key={home.id} type="button" className={selection?.type === 'home' && home.id === selection.id ? 'selected' : ''} onClick={() => setSelection({ type: 'home', id: home.id })}><Home size={15} /><span>{homeIdentity(home, priorities).primary}</span></button>)}</div>
        {!eligible.length && <p className="hh-map-rail-empty">{unresolved.length ? "Your homes couldn't be placed on the map yet — see below." : `Add a ${vocabulary.singularLower} to see it here.`}</p>}
      </section>
      {unresolved.length > 0 && <details className="hh-details"><summary>{unresolved.length} {unresolved.length === 1 ? vocabulary.singularLower : vocabulary.pluralLower} couldn't be placed on the map yet.</summary><div className="hh-map-unresolved">{unresolved.map((home) => <Link key={home.id} href={`/homes/${encodeURIComponent(home.id)}`}>{home.address || 'Address not added'} <span>Check home</span></Link>)}</div></details>}
    </div>

    {/* Full-width band below the geographic workspace, connecting the map to
        the user's actual decision criteria — mirrors the warm editorial
        bands already established on Homes/My Search, sized for compact
        horizontal cards rather than a single-column list. */}
    <section className="hh-map-places-band" aria-label="Places that matter to this search">
      <div className="hh-map-places-band-heading">
        <h2 className="hh-serif">Places That Matter to This Search</h2>
        <p>See commute times from your homes to the places that matter to you.</p>
      </div>
      {eligibleDestinations.length > 0 ? (
        <div className="hh-map-places-cards">
          {eligibleDestinations.map((destination) => {
            const attribution = destination.owner === 'collaborator' ? `${collaboratorName || 'Your collaborator'}'s place` : 'Your place';
            return (
              <button
                key={destination.id}
                type="button"
                className={`hh-map-place-card ${destination.owner === 'collaborator' ? 'is-collaborator' : ''} ${selection?.type === 'destination' && destination.id === selection.id ? 'selected' : ''}`}
                onClick={() => setSelection({ type: 'destination', id: destination.id })}
              >
                <MapPin size={15} aria-hidden="true" />
                <div>
                  <strong>{destination.label}</strong>
                  {destination.address && <small>{destination.address}</small>}
                  <span className="hh-map-place-attribution">
                    {isCollaborativeMap && `${attribution} · `}
                    {destination.maxDriveMinutes != null ? `${destination.maxDriveMinutes} min max` : 'Informational only'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="hh-map-places-empty">Nothing to show yet — add a place from My Search and we&apos;ll compare the trip from every {vocabulary.singularLower}.</p>
      )}
      <Link className="hh-btn hh-btn-ghost hh-map-edit-places" href="/search">Edit places</Link>
    </section>
  </>;
}
