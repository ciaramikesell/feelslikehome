// Every function here takes a Supabase client as its first argument, so the same
// functions work whether they're called from a Server Component (server client) or
// a Client Component (browser client). All queries are scoped by RLS to the signed-in
// user automatically — we never use a secret/service-role key here.

export async function getProfile(supabase, userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

// onboarding_complete is the one thing that must be saved: it is the gate.
// Progress (version + state) is recorded afterwards and best-effort, so a
// failed or not-yet-migrated progress write can never strand someone in
// onboarding after they finished it.
export async function completeOnboarding(supabase, userId, progress = null) {
  const { error } = await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', userId);
  if (error) throw error;
  if (progress) await saveOnboardingProgress(supabase, userId, progress);
}

// PostgREST / Postgres responses for a column that does not exist yet — the
// app can deploy before 2026-10-07-onboarding-state.sql is applied.
const isMissingOnboardingColumn = (error) => error?.code === 'PGRST204' || error?.code === '42703'
  || /onboarding_(state|version)/.test(error?.message || '');

// Persists resumable onboarding progress (src/lib/onboardingFlow.js) on the
// caller's own profile. Never throws: returns false when progress could not
// be saved, and onboarding simply continues (answers themselves are saved
// separately, as participant priorities, and are never at risk here).
export async function saveOnboardingProgress(supabase, userId, { version, state }) {
  try {
    const { error } = await supabase.from('profiles')
      .update({ onboarding_version: version, onboarding_state: state }).eq('id', userId);
    if (!error) return true;
    if (!isMissingOnboardingColumn(error)) console.warn('Onboarding progress not saved', error.code || error.message);
    return false;
  } catch (err) {
    console.warn('Onboarding progress not saved', err?.message);
    return false;
  }
}

// Lightweight profile completion for existing accounts that predate name
// capture at signup — see AppShell's dismissible name prompt. Trimmed and
// null-if-blank so an accidental blank submit can't overwrite a real name
// with an empty string.
export async function updateProfileName(supabase, userId, firstName, lastName) {
  const { error } = await supabase.from('profiles').update({
    first_name: firstName.trim() || null,
    last_name: lastName.trim() || null,
  }).eq('id', userId);
  if (error) throw error;
}

// There is deliberately no "get this account's owned search" helper here: which
// search applies is a collaboration question (owned vs. shared, co-buyer vs.
// Realtor) answered only by resolveActiveSearch / resolveOnboardingSearch in
// collaboration.js.

export async function deleteHome(supabase, homeId) {
  const { error } = await supabase.from('homes').delete().eq('id', homeId);
  if (error) throw error;
}
