'use client';

import { useEffect, useRef, useState } from 'react';
import { House } from 'lucide-react';
import { photoObjectPosition, photoRequestUrl } from '@/lib/photoFraming';

// Every property surface uses the same source validation, framing and failure
// behavior. Metadata never reaches an image request or becomes a new upload.
export default function HomePhoto({ src, alt = '', style, onError, onLoad, ...props }) {
  const source = photoRequestUrl(src);
  const [failed, setFailed] = useState(false);
  const imageRef = useRef(null);
  const callbacks = useRef({ onError, onLoad });
  callbacks.current = { onError, onLoad };
  useEffect(() => {
    const image = imageRef.current;
    // An SSR image can finish/fail before hydration attaches event handlers.
    // Read its actual state too, so cached failures never leave a blank frame.
    if (image?.complete && image.naturalWidth === 0) {
      setFailed(true); callbacks.current.onError?.({ currentTarget: image });
    } else {
      setFailed(false);
      if (image?.complete && image.naturalWidth > 0) callbacks.current.onLoad?.({ currentTarget: image });
    }
  }, [source]);
  if (!source || failed) return <span className="flh-home-photo-fallback" role={alt ? 'img' : undefined} aria-label={alt || undefined}><House size={26} aria-hidden="true" /><small>{source ? 'Photo unavailable' : 'No photo yet'}</small></span>;
  return <img ref={imageRef} data-home-photo="true" {...props} src={source} alt={alt} onLoad={onLoad} referrerPolicy="no-referrer" draggable={false} style={{ ...style, objectPosition: photoObjectPosition(src) }} onError={(event) => { setFailed(true); onError?.(event); }} />;
}
