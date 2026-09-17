'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import AuthForm from '@/components/auth/AuthForm';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';

const SIGN_UP_HEADLINE = <>Start with the homes<br />you&apos;re already considering.</>;
const SIGN_UP_DESCRIPTION = 'Bring your contenders together and compare them against what actually matters to you.';

function SignUpPageContent() {
  const searchParams = useSearchParams();
  // Intent is routing context and signup metadata only; it grants no authorization.
  const isRealtorEntry = searchParams.get('intent') === 'realtor';
  const redirectTo = sanitizeRedirectPath(searchParams.get('redirect')) || '/';
  return <AuthShell headline={SIGN_UP_HEADLINE} description={SIGN_UP_DESCRIPTION}><AuthForm initialMode="sign-up" redirectTo={redirectTo} isRealtorEntry={isRealtorEntry} /></AuthShell>;
}

export default function SignUpPage() {
  return <Suspense fallback={null}><SignUpPageContent /></Suspense>;
}
