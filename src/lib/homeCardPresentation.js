function clean(value) {
  const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : `${value || ''}`;
  return text.trim() || null;
}

export function formatCardGarage(home) {
  const raw = clean(home.garageSpaces);
  if (!raw) return null;
  const count = raw.match(/\b(\d+)\b/)?.[1];
  if (!count) return raw;
  const attached = /attached/i.test(raw) || home.checks?.['exterior:Attached Garage'] === true;
  return `${count} Car${attached ? ' Attached' : ''}`;
}

export function homeCardSnapshot(home, styleSummary) {
  const school = clean(home.schoolsNotes)?.replace(/\s*(?:—|-)\s*\d+(?:\.\d+)?\s*\/\s*10\s*$/i, '').trim();
  return [
    { label: 'Garage', value: formatCardGarage(home) },
    { label: 'Basement', value: clean(home.basementNotes) },
    { label: 'Home condition', value: clean(home.homeCondition) },
    { label: 'Schools', value: school },
    { label: 'Style', value: clean(styleSummary) },
  ].filter((fact) => fact.value && !/^(unknown|not specified|n\/a)$/i.test(fact.value));
}
