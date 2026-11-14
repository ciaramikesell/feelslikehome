'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AirVent, Archive, ArrowUpDown, Ban, Car, Dumbbell, Milestone, Package, PlugZap, Route, School, ShieldCheck,
  Shirt, Signpost, Sparkle, SquareParking,
} from 'lucide-react';

// The picture on a feature card. Three kinds, all on the same 4:3 tile:
//   • an illustration (public/images/features, FLH-authored, see
//     scripts/visual/feature-art.mjs) for physical features;
//   • an icon for abstract criteria (No HOA, traffic), where a picture would
//     not clarify anything;
//   • a neutral placeholder for the person's own features.
// Purely decorative: every card is labelled in text, so the image is hidden
// from assistive technology and a missing image falls back to the icon tile.
const ICONS = { AirVent, Archive, ArrowUpDown, Ban, Car, Dumbbell, Milestone, Package, PlugZap, Route, School, ShieldCheck, Shirt, Signpost, SquareParking };

export default function FeatureVisual({ feature, eager = false }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);
  // An image that failed before hydration never fires onError: check on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [feature.art]);
  if (feature.art && !failed) {
    return (
      <span className="flh-ob-pf-media">
        <img ref={imgRef} src={`/images/features/${feature.art}.svg`} alt="" width={160} height={120} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  const Icon = ICONS[feature.icon] || Sparkle;
  const tone = feature.icon && ICONS[feature.icon] ? 'is-icon' : 'is-placeholder';
  return (
    <span className={`flh-ob-pf-media ${tone}`}>
      <Icon size={30} strokeWidth={1.7} aria-hidden="true" />
    </span>
  );
}
