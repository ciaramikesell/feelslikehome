import Link from 'next/link';
import { Footprints, Heart, Archive as ArchiveIcon } from 'lucide-react';

const ITEMS = [
  { key: 'tour', label: 'Want to Tour', href: '/tour', Icon: Footprints },
  { key: 'favorites', label: 'Favorites', href: '/favorites', Icon: Heart },
  { key: 'archive', label: 'Archived', href: '/archive', Icon: ArchiveIcon },
];

/**
 * A lightweight secondary nav that groups the "decision workspace" (Want to Tour,
 * Favorites, Archived) together — these are three views onto the same stage of the
 * shopping journey, not separate top-level destinations. Want to Tour always shows;
 * Favorites/Archived only appear once there's something in them (existing records
 * still count, so this never strands legacy data).
 */
export default function DecisionNav({ active, hasFavorites, hasArchived, children }) {
  const items = ITEMS.filter((i) => {
    if (i.key === 'favorites') return hasFavorites;
    if (i.key === 'archive') return hasArchived;
    return true;
  });

  return (
    <div className="hh-decision-layout">
      <nav className="hh-decision-rail">
        {items.map(({ key, label, href, Icon }) => (
          <Link key={key} href={href} className={`hh-decision-item ${active === key ? 'active' : ''}`}>
            <Icon size={15} /> {label}
          </Link>
        ))}
      </nav>
      <div className="hh-decision-content">{children}</div>
    </div>
  );
}
