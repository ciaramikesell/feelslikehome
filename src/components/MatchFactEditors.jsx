'use client';

import { MultiSelectField, SelectField } from '@/components/FactFields';
import { CONDITION_FACT_CHOICES, LAYOUT_FACT_CHOICES, PROPERTY_TYPE_CHOICES, layoutPatch, layoutValues } from '@/lib/homeFacts';

// These are shared property facts, not personal Yes/No answers. Offer them only
// when the viewer ranked the corresponding priority; use the existing writer
// and scorer rather than creating a second answer or a household score.
export default function MatchFactEditors({ home, match, editor }) {
  const selected = new Set((match?.allSelected || []).map(({ key }) => key));
  const fields = [];
  if (selected.has('preferredPropertyTypes')) fields.push({ id: 'hf-propertyType', label: 'Property type', control: <SelectField id="hf-propertyType" value={home.propertyType} choices={PROPERTY_TYPE_CHOICES} failed={editor.failed.includes('propertyType')} onCommit={(propertyType) => editor.saveShared({ propertyType })} /> });
  if (selected.has('homeLayout') || selected.has('primaryBedroomLocation')) fields.push({ id: 'hf-layout', label: 'Home layout', control: <MultiSelectField id="hf-layout" label="Home layout" values={layoutValues(home)} choices={LAYOUT_FACT_CHOICES} failed={editor.failed.includes('homeLayout') || editor.failed.includes('primaryBedroomLocation')} onCommit={(next) => editor.saveShared(layoutPatch(home, next))} /> });
  if (selected.has('homeCondition')) fields.push({ id: 'hf-homeCondition', label: 'Home condition', control: <MultiSelectField id="hf-homeCondition" label="Home condition" values={home.homeCondition} choices={CONDITION_FACT_CHOICES} failed={editor.failed.includes('homeCondition')} onCommit={(homeCondition) => editor.saveShared({ homeCondition })} /> });
  if (!fields.length) return null;
  return <section className="flh-match-facts" aria-label="Property facts for your ranked priorities">
    <p>Property facts for your priorities. Changes are shared with this search; personal Yes/No answers below stay yours.</p>
    {fields.map(({ id, label, control }) => <div key={id}><label htmlFor={id}>{label}</label>{control}</div>)}
  </section>;
}
