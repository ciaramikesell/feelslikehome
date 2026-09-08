// Converts the already-sanitized RPC rows into the field-keyed shape consumed by
// Add/Edit Home. Deliberately copy only booleans and the public criterion key:
// unexpected database columns can never leak through this boundary.
export function deriveSharedFactPriorityAwareness(rows = []) {
  return Object.fromEntries(rows.map((row) => [row.field, {
    criterionKey: row.criterion_key,
    selectedByCurrentUser: row.selected_by_current_user === true,
    selectedByCoBuyer: row.selected_by_co_buyer === true,
    selectedByBoth: row.selected_by_both === true,
    coBuyerOnly: row.co_buyer_only === true,
    eligibleForSharedFactCapture: row.eligible_for_shared_fact_capture === true,
  }]));
}
