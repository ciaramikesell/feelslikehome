'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AirVent, AppWindow, Archive, ArrowUpDown, ArrowUpToLine, Armchair, Ban, Bath, BedDouble, BedSingle, Car, ChefHat, Coffee,
  DoorClosed, DoorOpen, Droplets, Dumbbell, Fence, Flame, Flower2, Footprints, Laptop, Layers, Library, Milestone, Package, PawPrint,
  PlugZap, Refrigerator, Route, School, ShieldCheck, Shirt, ShowerHead, Sofa, Sparkle, Sprout, SquareParking, Store, TreeDeciduous,
  Trees, Utensils, UtensilsCrossed, Warehouse, WashingMachine, Waves, Wrench, Sun,
} from 'lucide-react';
import { CARD_SIZES, cardImage } from '@/lib/onboardingImages';

// The picture on a feature card, always on the same 4:3 tile. The explicit
// manifest (src/lib/onboardingImages.js) decides what it is:
//   • the founder's photo, as responsive card-sized derivatives;
//   • an FLH illustration, for the few features with no photo yet;
//   • an icon — abstract preferences (No HOA), and the fallback whenever an
//     image is unavailable or fails to load;
//   • a neutral placeholder for the person's own features.
// Purely decorative: every card is labelled in text, so the image is hidden
// from assistive technology. Offscreen cards load lazily, and only the screen
// being shown renders any images at all.
const ICONS = {
  AirVent, AppWindow, Archive, ArrowUpDown, ArrowUpToLine, Armchair, Ban, Bath, BedDouble, BedSingle, Car, ChefHat, Coffee,
  DoorClosed, DoorOpen, Droplets, Dumbbell, Fence, Flame, Flower2, Footprints, Laptop, Layers, Library, Milestone, Package, PawPrint,
  PlugZap, Refrigerator, Route, School, ShieldCheck, Shirt, ShowerHead, Sofa, Sprout, SquareParking, Store, TreeDeciduous,
  Trees, Utensils, UtensilsCrossed, Warehouse, WashingMachine, Waves, Wrench, Sun,
};

export default function FeatureVisual({ feature, eager = false }) {
  const image = cardImage(feature.art);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);
  useEffect(() => { setFailed(false); }, [feature.art]);
  // An image that failed before hydration never fires onError: check on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [feature.art]);
  if (image && !failed) {
    return (
      <span className={`flh-ob-pf-media is-${image.kind}`}>
        <img
          ref={imgRef}
          src={image.src}
          srcSet={image.srcSet}
          sizes={image.srcSet ? CARD_SIZES : undefined}
          alt=""
          width={400}
          height={300}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
        />
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
