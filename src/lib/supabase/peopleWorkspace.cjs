// Kept as CommonJS so the same request-path loader can be exercised directly
// by Node's regression suite as well as by the Next.js Server Component.
async function loadPeopleWorkspace(supabase, userId, loaders) {
  const { getRealtorRelationships, getProspectiveSearches } = loaders;
  const [clients, drafts] = await Promise.all([
    getRealtorRelationships(supabase, userId),
    getProspectiveSearches(supabase),
  ]);

  return { clients, drafts };
}

module.exports = { loadPeopleWorkspace };
