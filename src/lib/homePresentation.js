import { isApartmentRental } from './constants.js';
import { splitAddressLines } from './homeDisplay.js';

export function homeVocabulary(priorities) {
  const apartment = isApartmentRental(priorities);
  return apartment ? {
    apartment: true,
    singular: 'Property',
    singularLower: 'property',
    plural: 'Properties',
    pluralLower: 'properties',
  } : {
    apartment: false,
    singular: 'Home',
    singularLower: 'home',
    plural: 'Homes',
    pluralLower: 'homes',
  };
}

export function selectedOptionLabel(home) {
  return [home?.selectedFloorPlanName, home?.selectedUnitLabel].filter(Boolean).join(' · ');
}

// Home identity is address-based, but the address itself has its own internal
// hierarchy: street is the identity, city/state/ZIP just locates it. Apartment
// identity is intentionally different (community name is the identity, the
// full address is only ever supporting text) and is untouched below — the
// street/locality split only ever applies to the non-apartment address.
export function homeIdentity(home, priorities) {
  const apartment = isApartmentRental(priorities);
  const propertyName = apartment ? String(home?.propertyName || '').trim() : '';
  const address = String(home?.address || '').trim();
  const addressLines = !apartment && address ? splitAddressLines(address) : null;
  const homePrimary = addressLines?.line2 ? addressLines.line1 : address;
  const homeSupporting = addressLines?.line2 || '';
  return {
    primary: propertyName || homePrimary || (apartment ? 'Untitled property' : 'Untitled home'),
    supporting: propertyName && address ? address : homeSupporting,
    option: apartment ? selectedOptionLabel(home) : '',
    accessible: [propertyName || address, selectedOptionLabel(home), propertyName ? address : ''].filter(Boolean).join(', ')
      || (apartment ? 'Untitled property' : 'Untitled home'),
  };
}
