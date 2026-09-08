export function evaluateCommute(destinations, resultsByDestination = {}) {
  const required = (destinations || []).filter((destination) => Number.isInteger(destination.maximumMinutes));
  if (!required.length) return null;

  for (const destination of required) {
    const result = resultsByDestination[destination.id];
    if (result?.status === 'ok' && result.minutes > destination.maximumMinutes) {
      return {
        evaluated: true,
        met: false,
        score: 0,
        detail: `${destination.label} is ${result.minutes} min · ${destination.maximumMinutes} min maximum`,
      };
    }
  }

  const allKnown = required.every((destination) => resultsByDestination[destination.id]?.status === 'ok');
  if (!allKnown) {
    return { evaluated: false, met: null, score: null, detail: 'Commute not available yet' };
  }

  return { evaluated: true, met: true, score: 1, detail: 'All commute limits met' };
}

export function sortCommuteDestinations(destinations) {
  return [...(destinations || [])].sort((a, b) => {
    const aRequired = Number.isInteger(a.maximumMinutes);
    const bRequired = Number.isInteger(b.maximumMinutes);
    if (aRequired !== bRequired) return aRequired ? -1 : 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}
