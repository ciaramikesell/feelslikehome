// Mobile Priority Onboarding V3 — the explicit feature-to-image manifest.
//
// Every card picture is chosen here by key; nothing is matched by filename at
// runtime. Order of preference for a card:
//   1. a photo: the founder's photography in public/images/onboarding/ (the
//      original upload is kept untouched), served as card-sized 4:3
//      derivatives from public/images/onboarding/cards/ (see
//      scripts/visual/onboarding-card-images.mjs);
//   2. an illustration (public/images/features/, FLH-authored), only for the
//      few features with no photo yet;
//   3. an icon — always defined, used for abstract preferences (No HOA) and
//      whenever an image is unavailable or fails to load.
//
// Provenance: photos supplied by the FLH founder (uploaded to main,
// public/images/onboarding/, commits 7e3e5fa and f7fd834). They illustrate an
// example of a feature, never a promise about any particular home.

export const CARD_WIDTHS = Object.freeze([400, 800]);

const photo = (file, extra = {}) => Object.freeze({ file, ...extra });

// key → original upload. Keys are the card names; several differ from the
// uploaded filename (e.g. garage-attached ← attached-garage.webp).
export const ONBOARDING_PHOTOS = Object.freeze({
  'first-floor-bedroom': photo('first-floor-bedroom.webp'),
  'home-office': photo('home-office.webp'),
  'finished-basement': photo('finished-basement.webp'),
  'primary-ensuite': photo('primary-ensuite.webp'),
  'first-floor-laundry': photo('first-floor-laundry.webp'),
  'walkout-basement': photo('walkout-basement.webp'),
  'front-porch': photo('front-porch.webp'),
  'countertop-seating': photo('countertop-seating.webp'),
  'stainless-appliances': photo('stainless-appliances.webp'),
  'walk-in-pantry': photo('walk-in-pantry.webp'),
  'eat-in-kitchen': photo('eat-in-kitchen.webp'),
  'kitchen-island': photo('kitchen-island.webp'),
  'formal-dining': photo('formal-dining-room.webp'),
  fireplace: photo('fireplace.webp'),
  'high-ceilings': photo('high-ceiling.webp'),
  'built-in-shelving': photo('built-in-shelving.webp'),
  'large-windows': photo('large-windows.webp'),
  'double-vanity': photo('double-vanity.webp'),
  'soaking-tub': photo('soaking-tub.webp'),
  'separate-shower': photo('separate-shower-tub.webp'),
  'private-toilet': photo('private-toilet.webp'),
  'linen-closet': photo('linen-closet.webp'),
  'garage-attached': photo('attached-garage.webp'),
  'garage-detached': photo('detached-garage.webp'),
  workbench: photo('garage-workbench.webp'),
  'garage-extension': photo('garage-extension.webp'),
  'garage-yard-door': photo('garage-backyard-door.webp'),
  'deck-patio': photo('deck-patio.webp'),
  'fenced-yard': photo('fenced-yard.webp'),
  'mature-trees': photo('mature-trees.webp'),
  garden: photo('garden-space.webp'),
  pool: photo('pool.webp'),
  'low-traffic-street': photo('low-traffic-street.webp'),
  sidewalks: photo('sidewalks.webp'),
  'tree-lined-street': photo('tree-lined-street.webp'),
  'cul-de-sac': photo('cul-de-sac.webp'),
  'walkable-schools': photo('walkable-to-schools.webp'),
});

// Features with no photo yet keep an FLH-authored illustration.
export const ONBOARDING_ILLUSTRATIONS = Object.freeze(['pet-friendly', 'in-unit-laundry', 'dishwasher', 'garage-either']);

// The card picture for a feature: { kind: 'photo', src, srcSet } |
// { kind: 'illustration', src } | null (icon only).
export function cardImage(key) {
  if (key && ONBOARDING_PHOTOS[key]) {
    return {
      kind: 'photo',
      src: `/images/onboarding/cards/${key}-400.webp`,
      srcSet: CARD_WIDTHS.map((width) => `/images/onboarding/cards/${key}-${width}.webp ${width}w`).join(', '),
    };
  }
  if (key && ONBOARDING_ILLUSTRATIONS.includes(key)) return { kind: 'illustration', src: `/images/features/${key}.svg` };
  return null;
}

// Cards are two to a row on phones (gutters 16–22px, 12px gap) and three in
// the 600px desktop column.
export const CARD_SIZES = '(min-width: 960px) 192px, (min-width: 560px) 31vw, calc(50vw - 28px)';
