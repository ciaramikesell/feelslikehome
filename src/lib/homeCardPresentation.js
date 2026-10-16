function clean(value) {
  const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : `${value || ''}`;
  return text.trim() || null;
}

export function formatCardGarage(home) {
  const raw = clean(home.garageSpaces);
  if (!raw) return null;
  const count = raw.match(/\b(\d+)\b/)?.[1];
  if (!count) return raw;
  const attached = home.garageType === 'attached' || /attached/i.test(raw) || home.checks?.['exterior:Attached Garage'] === true;
  return `${count} Car${attached ? ' Attached' : ''}`;
}

const BASEMENT_CARD_LABELS = { none: 'No basement', traditional: 'Traditional', gardenview: 'Gardenview', walkout: 'Walkout', unfinished: 'Unfinished', partially_finished: 'Partially finished', finished: 'Finished' };

// The structured Home Facts basement answer when one exists, else the earlier
// descriptive note.
export function formatCardBasement(home) {
  if (home.basementStyle === 'none' || home.basementCondition === 'none') return 'No basement';
  const parts = [BASEMENT_CARD_LABELS[home.basementCondition], BASEMENT_CARD_LABELS[home.basementStyle]].filter(Boolean);
  return parts.length ? parts.join(', ') : clean(home.basementNotes);
}

export function homeCardSnapshot(home, styleSummary) {
  const school = clean(home.schoolDistrict) || clean(home.schoolsNotes)?.replace(/\s*(?:—|-)\s*\d+(?:\.\d+)?\s*\/\s*10\s*$/i, '').trim();
  return [
    { label: 'Garage', value: formatCardGarage(home) },
    { label: 'Basement', value: formatCardBasement(home) },
    { label: 'Home condition', value: clean(home.homeCondition) },
    { label: 'Schools', value: school },
    { label: 'Style', value: clean(styleSummary) },
  ].filter((fact) => fact.value && !/^(unknown|not specified|n\/a)$/i.test(fact.value));
}
