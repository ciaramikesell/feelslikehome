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

// Every user has exactly one row here in V1 (enforced by a unique constraint on user_id).
// The table itself supports more than one search per user, so multi-search is a future
// UI feature, not a future migration.
export async function getSearch(supabase, userId) {
  const { data, error } = await supabase.from('searches').select('id,user_id,created_at,updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteHome(supabase, homeId) {
  const { error } = await supabase.from('homes').delete().eq('id', homeId);
  if (error) throw error;
}
