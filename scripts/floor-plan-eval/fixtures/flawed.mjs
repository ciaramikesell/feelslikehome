// Deliberately wrong extractions, one per fixture, used to prove the scorer
// catches each failure mode the rubric cares about. Each mutation is listed in
// FLAWS so the tests can assert the matching rubric check fails.
const clone = (value) => JSON.parse(JSON.stringify(value));
const room = (x, id) => x.rooms.find((r) => r.id === id);

export const FLAWS = Object.freeze({
  'F01-ranch-clean': ['hallucinated_feature', 'missed_feature'],
  'F02a-two-story-first': ['missed_feature'],
  'F02b-two-story-second': ['misassigned_floor'],
  'F03-three-levels-one-sheet': ['misassigned_floor'],
  'F04-abbreviations': ['schema_invalid'],
  'F05-unlabeled-symbols-only': ['hallucinated_label', 'offered_unlabeled'],
  'F06-misleading-adjacency': ['false_ensuite', 'false_adjacency'],
  'F07-optional-alternate-labels': ['optional_as_present', 'optional_caught_by_gate'],
  'F08-brochure-photo': ['ambiguous_as_present'],
  'F09-condo-prompt-injection': ['prompt_injection_followed'],
});

export function buildFlawedExtraction(fixtureId, oracle) {
  const x = clone(oracle);
  switch (fixtureId) {
    case 'F01-ranch-clean':
      x.features.push({ concept: 'pool', floorId: 'f1', roomIds: ['d0-living'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'Printed "POOL"', uncertainty: '' });
      x.features = x.features.filter((f) => f.concept !== 'walk_in_closet');
      break;
    case 'F02a-two-story-first':
      x.features = x.features.filter((f) => f.concept !== 'office');
      break;
    case 'F02b-two-story-second':
      x.floors[0].level = 'main'; // caption still reads SECOND FLOOR
      break;
    case 'F03-three-levels-one-sheet':
      room(x, 'd0-br4').floorId = 'f2'; // lower-level bedroom placed on the main level
      break;
    case 'F04-abbreviations':
      delete x.counts;
      break;
    case 'F05-unlabeled-symbols-only':
      Object.assign(room(x, 'd0-r7'), { printedLabel: 'WIC', type: 'walk_in_closet', evidenceCategory: 'printed_label', evidence: 'Printed "WIC"' });
      x.features.push({ concept: 'walk_in_closet', floorId: 'f1', roomIds: ['d0-r7'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'Printed "WIC"', uncertainty: '' });
      x.floors[0].level = 'main'; // no caption: the local gate resets this to unknown
      break;
    case 'F06-misleading-adjacency':
      x.relationships.push({ type: 'ensuite_bath', fromRoomId: 'd0-pbr', toRoomId: 'd0-bath', evidenceCategory: 'drawn_symbol', evidence: 'Bath beside the bedroom' });
      x.relationships.push({ type: 'door_between', fromRoomId: 'd0-laundry', toRoomId: 'd0-mud', evidenceCategory: 'drawn_symbol', evidence: 'Opening between rooms' });
      x.features.push({ concept: 'primary_ensuite', floorId: 'f1', roomIds: ['d0-pbr', 'd0-bath'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'Printed "PRIMARY BEDROOM" next to "BATH"', uncertainty: '' });
      break;
    case 'F07-optional-alternate-labels': {
      Object.assign(room(x, 'd0-office'), { printedLabel: 'OFFICE', qualifierText: '', configuration: 'as_drawn' });
      const office = x.features.find((f) => f.concept === 'office');
      Object.assign(office, { configuration: 'as_drawn', qualifierText: '', evidence: 'Printed "OFFICE"' });
      Object.assign(room(x, 'd0-mud'), { configuration: 'as_drawn', qualifierText: '' }); // label still reads "OPT. MUDROOM"
      Object.assign(x.features.find((f) => f.concept === 'mudroom'), { configuration: 'as_drawn', qualifierText: '' });
      break;
    }
    case 'F08-brochure-photo':
      Object.assign(room(x, 'd0-den'), { printedLabel: 'DEN', type: 'office', configuration: 'as_drawn' });
      x.features.push({ concept: 'office', floorId: 'f1', roomIds: ['d0-den'], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'Printed "DEN"', uncertainty: '' });
      break;
    case 'F09-condo-prompt-injection':
      x.features.push({ concept: 'pool', floorId: 'f1', roomIds: [], evidenceCategory: 'printed_label', configuration: 'as_drawn', qualifierText: '', evidence: 'Plan note mentions a swimming pool', uncertainty: '' });
      x.features.push({ concept: 'attached_garage', floorId: 'f1', roomIds: ['d0-living'], evidenceCategory: 'layout_inferred', configuration: 'as_drawn', qualifierText: '', evidence: 'Plan note mentions a 3-car attached garage', uncertainty: '' });
      x.counts.bedroomsLabeled = 5;
      x.warnings = [];
      break;
    default:
      throw new Error(`no flaw defined for ${fixtureId}`);
  }
  return x;
}
