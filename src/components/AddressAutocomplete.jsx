'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/googleMaps';

export default function AddressAutocomplete({ value, onChange, onSelect, searchHint = '', placeholder = 'Search for an address...' }) {
  const inputRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const helpId = useId();
  const [announcement, setAnnouncement] = useState('');
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!key || !inputRef.current) return undefined;
    let listener;
    let cancelled = false;
    loadGoogleMaps(key).then(async (maps) => {
      const { Autocomplete } = await maps.importLibrary('places');
      if (cancelled || !inputRef.current) return;
      const autocomplete = new Autocomplete(inputRef.current, {
        fields: ['formatted_address'],
        componentRestrictions: { country: 'us' },
      });
      listener = autocomplete.addListener('place_changed', () => {
        const address = autocomplete.getPlace()?.formatted_address;
        if (!address) return;
        onSelectRef.current(address);
        setAnnouncement(`Address selected: ${address}`);
      });
    }).catch(() => {});
    return () => { cancelled = true; listener?.remove(); };
  }, [key]);

  return <>
    <input ref={inputRef} className="hh-input" style={{ flex: 1 }} value={value} onChange={(event) => onChange(event.target.value)} placeholder={searchHint || placeholder} autoComplete="off" aria-label="Search for or enter the street address" aria-describedby={helpId} />
    <span id={helpId} className="sr-only">Choose a suggestion with the arrow keys and Enter, or type the address yourself.</span>
    <span className="sr-only" aria-live="polite">{announcement}</span>
  </>;
}
