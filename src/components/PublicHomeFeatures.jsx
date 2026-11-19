import Image from 'next/image';

const features = [
  {
    id: 'priorities', title: 'Set Your Preferences', copy: 'Decide what matters most to you.',
    alt: 'Illustrated priorities: Home Office is Must Have, Fenced Yard is Important, and Soaking Tub is Nice to Have.',
  },
  {
    id: 'listings', title: 'Import Homes from Anywhere', copy: 'Bring your saved listings together.',
    alt: 'Illustrative listing-source labels leading into a saved collection of three homes.',
  },
  {
    id: 'compare', title: 'Compare What Matters', copy: 'See how each home fits your priorities.',
    alt: 'Three fictional homes with illustrative 92%, 87%, and 76% Match badges.',
  },
  {
    id: 'collaborate', title: 'Search & Decide Together', copy: 'Make decisions with your co-buyer and Realtor.',
    alt: 'Separate fictional Match results for Ciara and Andrew. Ciara’s Location, Home Office and Garage hearts are filled. Andrew’s Garage and Home Office hearts are filled; Finished Basement is outlined.',
  },
];

export default function PublicHomeFeatures() {
  return <section className="pl-how" id="how-it-works" aria-labelledby="how-title" tabIndex={-1}>
    <h2 id="how-title">How it works</h2>
    <div className="pl-editorial-grid">
      {features.map(({ id, title, copy, alt }) => <article className="pl-editorial-feature" key={id} aria-labelledby={`how-${id}`}>
        <Image src={`/images/homepage-previews/${id}.webp`} alt={alt} width={1448} height={1086} loading="lazy"
          sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 1199px) calc((100vw - 80px) / 2), (max-width: 1503px) calc((100vw - 144px) / 4), 340px" />
        <h3 id={`how-${id}`}>{title}</h3>
        <p>{copy}</p>
      </article>)}
    </div>
    <p className="pl-illustration-note">Illustrative mockups and Match results. Listing-source names do not imply affiliation or direct integration.</p>
  </section>;
}
