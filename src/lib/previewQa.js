// Gate for the temporary Step 2 Preview QA harness (/qa/step-2). See
// docs/onboarding-step2-preview-qa.md. Remove this file with the harness.
//
// Allowed only:
//   • in local development (next dev), or
//   • on a Vercel *Preview* deployment, reached through that deployment's own
//     branch or deployment URL — never a production domain, even if a Preview
//     build were promoted.
// The harness makes no Supabase reads or writes beyond confirming the visitor
// is signed in; every save on it is in memory.

const PRODUCTION_HOSTS = /(^|\.)feelslikehome\.app$/i;

export function previewQaAllowed({ nodeEnv, vercelEnv, host, branchUrl, deploymentUrl } = {}) {
  if (nodeEnv === 'development') return true;
  if (vercelEnv !== 'preview') return false;
  const name = String(host || '').toLowerCase().split(':')[0];
  if (!name || PRODUCTION_HOSTS.test(name)) return false;
  return [branchUrl, deploymentUrl].some((url) => url && String(url).toLowerCase() === name);
}

export function previewQaAllowedHere(host) {
  return previewQaAllowed({
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    host,
    branchUrl: process.env.VERCEL_BRANCH_URL,
    deploymentUrl: process.env.VERCEL_URL,
  });
}
