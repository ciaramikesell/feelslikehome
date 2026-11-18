import { notFound } from 'next/navigation';
import { guestOnboardingEnabled } from '@/lib/guest/config';

export const dynamic = 'force-dynamic';

export default function GuestLayout({ children }) {
  if (!guestOnboardingEnabled()) notFound();
  return children;
}
