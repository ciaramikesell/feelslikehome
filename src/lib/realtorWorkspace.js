// Small executable seam for the root Realtor workspace. Keeping composition
// separate from Next rendering lets tests exercise the same zero-row success
// path used in production without mocking a client-detail route.
export async function loadRealtorWorkspace({ supabase, userId, loadRelationships, loadDrafts }) {
  const [relationships, prospective] = await Promise.all([
    loadRelationships(supabase, userId),
    loadDrafts(supabase),
  ]);
  return { relationships, prospective };
}
