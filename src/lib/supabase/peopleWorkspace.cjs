// Kept as CommonJS so the same request-path loader can be exercised directly
// by Node's regression suite as well as by the Next.js Server Component.
//
// My Clients reads three things, all under the caller's own access:
//   clients    — searches the Realtor is on right now (search_members)
//   records    — the Realtor's own private client records (owner-only RLS)
//   priorities — the buyers' preference documents for those searches only,
//                read live and reduced to a summary by the page; never stored
async function loadPeopleWorkspace(supabase, userId, loaders) {
  const { getRealtorRelationships, getClientRecords, getClientSearchPriorities } = loaders;
  const [clients, records] = await Promise.all([
    getRealtorRelationships(supabase, userId),
    getClientRecords(supabase),
  ]);
  const priorities = clients.length ? await getClientSearchPriorities(supabase, clients.map((client) => client.id)) : [];
  return { clients, records, priorities };
}

module.exports = { loadPeopleWorkspace };
