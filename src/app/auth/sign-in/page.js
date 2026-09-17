'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import AuthForm from '@/components/auth/AuthForm';
import { sanitizeRedirectPath } from '@/lib/safeRedirect';

function SignInPageContent() {
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirectPath(searchParams.get('redirect')) || '/';
  return <AuthShell><AuthForm redirectTo={redirectTo} /></AuthShell>;
}

export default function SignInPage() {
  return <Suspense fallback={null}><SignInPageContent /></Suspense>;
}
