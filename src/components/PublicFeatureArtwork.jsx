import Image from 'next/image';
import { ArrowRight, Heart, House, Laptop, MapPin } from 'lucide-react';

// Crop windows reference the original approved 1448×1086 artwork. Only the
// photo interiors are shown; labels and priority states remain crisp HTML.
const priorityPhotos = [
  { crop: [62, 234, 429, 420], title: 'Home Office', tier: 'Must Have', tone: 'must' },
  { crop: [519, 233, 419, 422], title: 'Fenced Yard', tier: 'Important', tone: 'important' },
  { crop: [981, 233, 418, 420], title: 'Soaking Tub', tier: 'Nice to Have', tone: 'nice' },
];
const homes = [
  { crop: [70, 227, 409, 425], score: 92, tone: 'sage' },
  { crop: [533, 227, 389, 425], score: 87, tone: 'gold' },
  { crop: [979, 227, 400, 425], score: 76, tone: 'peach' },
];
function SourcePhoto({ source, crop }) {
  const [x, y, width, height] = crop;
  return <div className="pl-source-photo" style={{ aspectRatio: `${width} / ${height}` }}>
    <Image src={`/images/homepage-previews/${source}.webp`} alt="" width={1448} height={1086} loading="lazy"
      sizes="(max-width: 767px) 110vw, 1448px"
      style={{ width: `${1448 / width * 100}%`, left: `${-x / width * 100}%`, top: `${-y / height * 100}%` }} />
  </div>;
}
function Match({ score, tone }) {
  return <div className={`pl-art-match is-${tone}`}><strong>{score}%</strong><span>Match</span></div>;
}
function Participant({ name, initial, score, tone, priorities }) {
  return <div className="pl-art-participant">
    <div className="pl-art-person"><span className={`pl-art-avatar is-${tone}`}>{initial}</span><strong>{name}</strong></div>
    <div className={`pl-art-person-match is-${tone}`}><Heart fill="currentColor" />{score}% Match</div>
    <ul>{priorities.map(([label, filled]) => <li key={label}><Heart fill={filled ? 'currentColor' : 'none'} /><span>{label}</span></li>)}</ul>
  </div>;
}

export default function PublicFeatureArtwork({ id, alt }) {
  return <div className={`pl-feature-artwork is-${id}`} role="img" aria-label={alt}>
    <div className="pl-art-composition" aria-hidden="true">
      {id === 'priorities' && <div className="pl-art-priorities">{priorityPhotos.map(({ crop, title, tier, tone }) => <div className="pl-art-priority" key={title}>
        <SourcePhoto source="priorities" crop={crop} /><strong>{title}</strong><span className={`pl-art-tier is-${tone}`}>{tier}</span>
      </div>)}</div>}
      {id === 'listings' && <div className="pl-art-listings">
        <div className="pl-art-sources">{[[House, 'Zillow'], [MapPin, 'Realtor.com'], [Laptop, 'Any Listing Website']].map(([Icon, label]) => <div key={label}><Icon /><strong>{label}</strong></div>)}</div>
        <ArrowRight className="pl-art-import-arrow" />
        <div className="pl-art-saved"><strong><Heart />My Saved Homes</strong><div>{homes.map(({ crop }, index) => <SourcePhoto key={index} source="compare" crop={crop} />)}</div></div>
      </div>}
      {id === 'compare' && <div className="pl-art-homes">{homes.map(({ crop, score, tone }) => <div className="pl-art-home" key={score}>
        <SourcePhoto source="compare" crop={crop} /><Match score={score} tone={tone} />
      </div>)}</div>}
      {id === 'collaborate' && <div className="pl-art-collaborate">
        <div className="pl-art-shared-home"><SourcePhoto source="collaborate" crop={[192, 110, 1060, 490]} /></div>
        <div className="pl-art-participants">
          <Participant name="Ciara" initial="C" score={92} tone="sage" priorities={[[ 'Location', true ], [ 'Home Office', true ], [ 'Garage', true ]]} />
          <Participant name="Andrew" initial="A" score={76} tone="gold" priorities={[[ 'Garage', true ], [ 'Finished Basement', false ], [ 'Home Office', true ]]} />
        </div>
      </div>}
    </div>
  </div>;
}
