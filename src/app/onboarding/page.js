import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/data';
import { normalizePriorities } from '@/lib/constants';
import { getCommuteDestinations, needsSharedSearchSetup, resolveCollaboratorSearchContext, resolveOnboardingSearch, resolvePriorities } from '@/lib/supabase/collaboration';
import { beginOnboarding, onboardingStepsFor } from '@/lib/onboardingFlow';
import Onboarding from '@/components/onboarding/Onboarding';

// Places That Matter (Step 2) are this person's own commute destinations on
// this search. Loaded only when the flow actually includes that step, and a
// failed read is reported on the screen rather than shown as "no places".
async function initialPlacesFor(supabase, progress, searchId, userId) {
  if (!onboardingStepsFor(progress.version, progress.state).includes('locations')) return { initialPlaces: [], placesError: null };
  try {
    return { initialPlaces: await getCommuteDestinations(supabase, searchId, userId), placesError: null };
  } catch {
    return { initialPlaces: [], placesError: 'Couldn’t load your saved places. You can add them later in My Search.' };
  }
}

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const profile = await getProfile(supabase, user.id);

  // The active decision-making search, not the account's owned search: an
  // invited co-buyer onboards into the shared search they just joined.
  const { search, role } = await resolveOnboardingSearch(supabase, user.id);

  // Two different things live behind this route:
  // - account onboarding: once per account (profiles.onboarding_complete);
  // - shared-search setup: an already-onboarded co-buyer has no preferences of
  //   their own on the search they joined (same predicate as the (app) layout
  //   gate, so the two can never disagree). Anyone else goes to their Homes.
  const sharedSetup = Boolean(profile?.onboarding_complete);
  if (sharedSetup && !(await needsSharedSearchSetup(supabase, user.id, search, role === 'owner'))) redirect('/homes');
  const priorities = await resolvePriorities(supabase, search, user.id);

  const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || null;

  if (sharedSetup) {
    // Who invited them (for the heading) and their own search (for the "not
    // now" exit). Nothing is read from or copied out of either person's
    // preferences; the setup starts from this person's own (empty) document.
    const [collaborator, { data: owned }] = await Promise.all([
      resolveCollaboratorSearchContext(supabase, search).catch(() => null),
      supabase.from('searches').select('id').eq('user_id', user.id).maybeSingle(),
    ]);
    // Ephemeral: shared-search setup never reads or writes account onboarding progress.
    const progress = beginOnboarding({ context: { searchId: search.id, role } });
    const places = await initialPlacesFor(supabase, progress, search.id, user.id);
    return (
      <Onboarding
        {...places}
        mode="shared_search_setup"
        userId={user.id}
        searchId={search.id}
        initialPriorities={normalizePriorities(priorities)}
        initialProgress={progress}
        ownerName={collaborator?.displayName || null}
        ownedSearchId={owned?.id || null}
        appVersion={appVersion}
      />
    );
  }

  // Resume where this person left off, against this search. Missing columns
  // (migration not yet applied) read as a fresh start, exactly as before.
  const progress = beginOnboarding({
    storedVersion: profile?.onboarding_version ?? null,
    storedState: profile?.onboarding_state ?? null,
    context: { searchId: search.id, role },
  });

  const places = await initialPlacesFor(supabase, progress, search.id, user.id);
  return <Onboarding {...places} userId={user.id} searchId={search.id} initialPriorities={normalizePriorities(priorities)} initialProgress={progress} appVersion={appVersion} />;
}
