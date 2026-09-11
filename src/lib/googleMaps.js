'use client';

let mapsPromise;

// One browser loader shared by maps and address discovery. importLibrary loads
// Places only when the address control asks for it.
export function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const callback = `flhGoogleMapsReady${Date.now()}`;
    window[callback] = () => { delete window[callback]; resolve(window.google.maps); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => { mapsPromise = undefined; reject(new Error('Google Maps could not load')); };
    document.head.appendChild(script);
  });
  return mapsPromise;
}
