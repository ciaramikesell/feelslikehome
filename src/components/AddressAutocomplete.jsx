'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/googleMaps';

// Places API (New) deliberately leaves the text box in our control. That keeps
// free-form entry working when Google is unavailable and lets the same native
// input remain accessible and usable on small screens.
export default function AddressAutocomplete({ value, onChange, onSelect, searchHint = '', placeholder = 'Search for an address...' }) {
  const onSelectRef = useRef(onSelect);
  const requestId = useRef(0);
  const sessionRef = useRef(null);
  const listId = useId();
  const helpId = useId();
  const [places, setPlaces] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState('');
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    loadGoogleMaps(key).then((maps) => maps.importLibrary('places')).then((library) => {
      if (!cancelled) setPlaces(library);
    }).catch(() => {}); // Manual entry remains fully functional.
    return () => { cancelled = true; };
  }, [key]);

  useEffect(() => {
    const query = value.trim();
    if (!places?.AutocompleteSuggestion || query.length < 3) {
      setSuggestions([]);
      return undefined;
    }
    const currentRequest = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        if (!sessionRef.current && places.AutocompleteSessionToken) sessionRef.current = new places.AutocompleteSessionToken();
        const { suggestions: next = [] } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          includedRegionCodes: ['us'],
          sessionToken: sessionRef.current || undefined,
        });
        if (currentRequest === requestId.current) {
          setSuggestions(next.filter((item) => item.placePrediction));
          setActiveIndex(-1);
        }
      } catch {
        if (currentRequest === requestId.current) setSuggestions([]);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [places, value]);

  const choose = async (suggestion) => {
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({ fields: ['formattedAddress'] });
      if (!place.formattedAddress) return;
      onSelectRef.current(place.formattedAddress);
      setSuggestions([]);
      sessionRef.current = null;
      setAnnouncement(`Address selected: ${place.formattedAddress}`);
    } catch {
      // Keep the typed address intact if details retrieval fails.
    }
  };

  const onKeyDown = (event) => {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + direction + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      choose(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setSuggestions([]);
      setActiveIndex(-1);
    }
  };

  return <div className="hh-address-autocomplete" style={{ flex: 1, position: 'relative', minWidth: 0 }}>
    <input
      className="hh-input"
      style={{ width: '100%' }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      placeholder={searchHint || placeholder}
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={suggestions.length > 0}
      aria-controls={listId}
      aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      aria-label="Search for or enter the street address"
      aria-describedby={helpId}
    />
    {suggestions.length > 0 && <ul id={listId} role="listbox" className="hh-address-suggestions" style={{ position: 'absolute', zIndex: 20, inset: '100% 0 auto', margin: '4px 0 0', padding: 4, listStyle: 'none', background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', maxHeight: 240, overflowY: 'auto' }}>
      {suggestions.map((suggestion, index) => <li key={`${suggestion.placePrediction.placeId || index}`} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(suggestion)} style={{ width: '100%', border: 0, borderRadius: 7, padding: '9px 10px', textAlign: 'left', background: index === activeIndex ? 'var(--paper)' : 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>
          {suggestion.placePrediction.text?.toString() || suggestion.placePrediction.mainText?.toString()}
        </button>
      </li>)}
    </ul>}
    <span id={helpId} className="sr-only">Choose a suggestion with the arrow keys and Enter, or type the address yourself.</span>
    <span className="sr-only" aria-live="polite">{announcement}</span>
  </div>;
}
