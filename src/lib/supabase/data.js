// Every function here takes a Supabase client as its first argument, so the same
// functions work whether they're called from a Server Component (server client) or
// a Client Component (browser client). All queries are scoped by RLS to the signed-in
// user automatically — we never use a secret/service-role key here.

export async function getProfile(supabase, userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function completeOnboarding(supabase, userId) {
  const { error } = await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', userId);
  if (error) throw error;
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
