import { isApartmentRental } from './constants.js';

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

export function homeIdentity(home, priorities) {
  const apartment = isApartmentRental(priorities);
  const propertyName = apartment ? String(home?.propertyName || '').trim() : '';
  const address = String(home?.address || '').trim();
  return {
    primary: propertyName || address || (apartment ? 'Untitled property' : 'Untitled home'),
    supporting: propertyName && address ? address : '',
    option: apartment ? selectedOptionLabel(home) : '',
    accessible: [propertyName || address, selectedOptionLabel(home), propertyName ? address : ''].filter(Boolean).join(', ')
      || (apartment ? 'Untitled property' : 'Untitled home'),
  };
}
