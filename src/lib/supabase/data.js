// Every function here takes a Supabase client as its first argument, so the same
// functions work whether they're called from a Server Component (server client) or
// a Client Component (browser client). All queries are scoped by RLS to the signed-in
// user automatically — we never use a secret/service-role key here.

function rowToHome(row) {
  return {
    id: row.id,
    address: row.address || '',
    crossroads: row.crossroads || '',
    listingUrl: row.listing_url || '',
    photoUrl: row.photo_url || '',
    price: row.price || '',
    estMonthly: row.est_monthly || '',
    sqft: row.sqft || '',
    beds: row.beds || '',
    baths: row.baths || '',
    lotSize: row.lot_size || '',
    garageSpaces: row.garage_spaces || '',
    yearBuilt: row.year_built || '',
    daysOnMarket: row.days_on_market || '',
    homeLayout: row.home_layout || [],
    primaryBedroomLocation: row.primary_bedroom_location || '',
    secondaryBedroomLocation: row.secondary_bedroom_location || '',
    status: row.status || 'Considering',
    reaction: row.reaction || null,
    rejectionReason: row.rejection_reason || '',
    ratings: row.ratings || {},
    checks: row.checks || {},
    notes: row.notes || '',
    pros: row.pros || '',
    cons: row.cons || '',
    // Auto Enrichment 1.0 — nullable, informational only, never contribute to Match.
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    hoaFeeMonthly: row.hoa_fee_monthly ?? null,
    propertyTaxAnnual: row.property_tax_annual ?? null,
    propertyTaxYear: row.property_tax_year ?? null,
  };
}

function homeToRow(home, userId, searchId) {
  return {
    ...(home.id ? { id: home.id } : {}),
    user_id: userId,
    search_id: searchId,
    address: home.address || '',
    crossroads: home.crossroads || '',
    listing_url: home.listingUrl || '',
    photo_url: home.photoUrl || '',
    price: home.price || '',
    est_monthly: home.estMonthly || '',
    sqft: home.sqft || '',
    beds: home.beds || '',
    baths: home.baths || '',
    lot_size: home.lotSize || '',
    garage_spaces: home.garageSpaces || '',
    year_built: home.yearBuilt || '',
    days_on_market: home.daysOnMarket || '',
    home_layout: home.homeLayout || [],
    primary_bedroom_location: home.primaryBedroomLocation || '',
    secondary_bedroom_location: home.secondaryBedroomLocation || '',
    status: home.status || 'Considering',
    reaction: home.reaction || null,
    rejection_reason: home.rejectionReason || '',
    ratings: home.ratings || {},
    checks: home.checks || {},
    notes: home.notes || '',
    pros: home.pros || '',
    cons: home.cons || '',
    // Auto Enrichment 1.0 — plain nullable numerics, mirrors rowToHome above.
    latitude: home.latitude ?? null,
    longitude: home.longitude ?? null,
    hoa_fee_monthly: home.hoaFeeMonthly ?? null,
    property_tax_annual: home.propertyTaxAnnual ?? null,
    property_tax_year: home.propertyTaxYear ?? null,
    updated_at: new Date().toISOString(),
  };
}

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
  const { data, error } = await supabase.from('searches').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSearchPriorities(supabase, searchId, priorities) {
  const { error } = await supabase.from('searches').update({ priorities, updated_at: new Date().toISOString() }).eq('id', searchId);
  if (error) throw error;
}

export async function getHomes(supabase, userId) {
  const { data, error } = await supabase.from('homes').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToHome);
}

export async function saveHome(supabase, home, userId, searchId) {
  const row = homeToRow(home, userId, searchId);
  const { data, error } = await supabase.from('homes').upsert(row).select().single();
  if (error) throw error;
  return rowToHome(data);
}

export async function deleteHome(supabase, homeId) {
  const { error } = await supabase.from('homes').delete().eq('id', homeId);
  if (error) throw error;
}
