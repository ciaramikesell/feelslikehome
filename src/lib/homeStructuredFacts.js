export const EXISTING_STRUCTURED_FACT_VALUE = '__existing__';

export function structuredFactSelectValue(value, choices) {
  const selected = Array.isArray(value) ? value : [];
  if (selected.length === 1 && choices.includes(selected[0])) return selected[0];
  return selected.length > 0 ? EXISTING_STRUCTURED_FACT_VALUE : '';
}

export function structuredFactValueFromSelect(value) {
  return value ? [value] : [];
}
