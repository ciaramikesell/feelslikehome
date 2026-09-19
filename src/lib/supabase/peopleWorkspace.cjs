// Kept as CommonJS so the same request-path loader can be exercised directly
// by Node's regression suite as well as by the Next.js Server Component.
//
// The client roster and the prospective-search drafts are independent reads
// — a failure in one (a transient hiccup, a query error) must never take
// down the other, and neither must be confused with its own legitimate
// empty state ("this Realtor has zero clients/drafts" is success, not
// error). Promise.allSettled keeps them isolated; *Error flags let the page
// render a real error notice only for the section that actually failed.
async function loadPeopleWorkspace(supabase, userId, loaders) {
  const { getRealtorRelationships, getProspectiveSearches } = loaders;
  const [clientsResult, draftsResult] = await Promise.allSettled([
    getRealtorRelationships(supabase, userId),
    getProspectiveSearches(supabase),
  ]);

  if (clientsResult.status === 'rejected') console.error('People workspace: could not load client roster', clientsResult.reason);
  if (draftsResult.status === 'rejected') console.error('People workspace: could not load prospective search drafts', draftsResult.reason);

  return {
    clients: clientsResult.status === 'fulfilled' ? clientsResult.value : [],
    clientsError: clientsResult.status === 'rejected',
    drafts: draftsResult.status === 'fulfilled' ? draftsResult.value : [],
    draftsError: draftsResult.status === 'rejected',
  };
}

module.exports = { loadPeopleWorkspace };
