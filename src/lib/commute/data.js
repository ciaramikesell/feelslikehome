export function rowToCommuteDestination(row) {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    maximumMinutes: row.maximum_minutes ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    normalizedAddress: row.normalized_address || null,
    geocodeStatus: row.geocode_status || 'pending',
    createdAt: row.created_at || null,
  };
}

export async function getCommuteDestinations(supabase, searchId, userId) {
  const { data, error } = await supabase
    .from('commute_destinations')
    .select('*')
    .eq('search_id', searchId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToCommuteDestination);
}
