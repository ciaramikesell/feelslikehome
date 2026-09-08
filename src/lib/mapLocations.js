function normalizedAddress(value) {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hasCurrentCoordinates(home) {
  const latitude = Number(home.latitude);
  const longitude = Number(home.longitude);
  return home.coordinateStatus === 'resolved'
    && home.coordinateSource === 'rentcast'
    && normalizedAddress(home.coordinateAddress) === normalizedAddress(home.address)
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

