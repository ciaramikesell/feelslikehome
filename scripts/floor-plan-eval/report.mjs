// Markdown comparison report for one run.
const fmt = (v, kind) => {
  if (v === null || v === undefined) return '—';
  if (kind === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (kind === 'usd') return `$${v.toFixed(4)}`;
  if (kind === 'ms') return `${Math.round(v)} ms`;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
};
const STATUS = { pass: 'PASS', fail: '**FAIL**', 'n/a': 'n/a' };

export function buildReport({ run, results }) {
  const ids = Object.keys(results);
  const lines = [];
  lines.push(`# Floor-plan extraction benchmark — ${run.label}`, '');
  lines.push(`- Run: \`${run.runId}\` · ${run.startedAt}`);
  lines.push(`- Pipeline: \`${run.pipelineVersion}\` · fixtures: ${run.fixtureCount} · repeats: ${run.repeats}`);
  lines.push(`- Paid calls: ${run.paid ? `**yes** — cap $${run.maxTotalUsd}; preflight bound $${run.worstCaseUsd?.toFixed(2)} + reserve $${run.reserveUsd?.toFixed(2)}` : 'none (offline replay only)'}`);
  if (run.paid) {
    lines.push(`- Ledger: this invocation $${run.spentUsd.toFixed(4)}; all invocations of this run $${run.committedUsd.toFixed(4)} (failed attempts counted at their full bound)`);
    if (run.budgetStopped) lines.push('- **Stopped early: the next attempt would not have fit the cap.**');
    if (run.abortReason) lines.push(`- **Aborted: ${run.abortReason}**`);
  }
  lines.push('- Costs: replay rows cost nothing. Paid rows show measured tokens × published price; unverified prices are marked in the provider table.', '');

  lines.push('## Rubric', '', `| # | Check | Threshold | ${ids.join(' | ')} |`, `|---|---|---|${ids.map(() => '---').join('|')}|`);
  const gateRows = results[ids[0]].gates.map((g) => g.id);
  for (const gid of gateRows) {
    const g0 = results[ids[0]].gates.find((g) => g.id === gid);
    const cells = ids.map((id) => {
      const g = results[id].gates.find((x) => x.id === gid);
      const kind = [2, 3, 4, 5, 6, 10, 11].includes(gid) ? 'pct' : gid === 12 ? 'ms' : gid === 13 ? 'usd' : null;
      return `${STATUS[g.status]} (${fmt(g.value, kind)})`;
    });
    lines.push(`| ${gid} | ${g0.label} | ${g0.threshold} | ${cells.join(' | ')} |`);
  }

  lines.push('', '## Metrics', '', `| Metric | ${ids.join(' | ')} |`, `|---|${ids.map(() => '---').join('|')}|`);
  const rows = [
    ['Calls / errors / schema-valid', (m) => `${m.calls} / ${m.errors} / ${m.schemaValid}`],
    ['Offerable recall (shown and offerable)', (m) => fmt(m.offerableRecall, 'pct')],
    ['Confident wrong floors', (m) => fmt(m.floorConfidentWrong)],
    ['False ensuite / false adjacency', (m) => `${m.falseEnsuite} / ${m.falseAdjacency}`],
    ['Optional as present / ambiguous as present', (m) => `${m.optionalAsPresent} / ${m.ambiguousAsPresent}`],
    ['Symbol over-claims (not offered)', (m) => fmt(m.overclaims)],
    ['Local gate saves (optional/ambiguous language)', (m) => fmt(m.gateSaves)],
    ['Latency p50 / p95', (m) => `${fmt(m.latencyP50Ms, 'ms')} / ${fmt(m.latencyP95Ms, 'ms')}`],
    ['Total cost', (m) => fmt(m.totalCostUsd, 'usd')],
  ];
  for (const [label, f] of rows) lines.push(`| ${label} | ${ids.map((id) => f(results[id].metrics)).join(' | ')} |`);

  lines.push('', '## Per fixture', '');
  for (const id of ids) {
    lines.push(`### ${id}`, '', '| Fixture | Hallucinations | Offered wrongly | Missed | Wrong floors | Gate saves | Notes |', '|---|---|---|---|---|---|---|');
    for (const call of results[id].calls) {
      const s = call.score;
      if (call.error) { lines.push(`| ${call.fixtureId} #${call.repeat} | — | — | — | — | — | error: ${call.error} |`); continue; }
      if (!s.schemaValid) { lines.push(`| ${call.fixtureId} #${call.repeat} | — | — | — | — | — | schema invalid: ${s.schemaErrors.join('; ').slice(0, 120)} |`); continue; }
      const notes = [s.falseEnsuite ? `false ensuite ×${s.falseEnsuite}` : '', s.falseAdjacency ? `false adjacency ×${s.falseAdjacency}` : '', s.injectionFollowed ? 'INJECTION FOLLOWED' : '', call.truncated ? 'truncated' : '', call.refusal ? 'refusal' : ''].filter(Boolean).join(', ');
      lines.push(`| ${call.fixtureId} #${call.repeat} | ${[...s.hallucinatedFeatures, ...s.hallucinatedLabels.map((l) => `"${l}"`)].join(', ') || '0'} | ${s.offeredWrong.map((w) => `${w.concept} (${w.reason})`).join(', ') || '0'} | ${s.missed.join(', ') || '0'} | ${s.floorWrong.map((w) => `${w.label}: ${w.got}≠${w.expected}`).join(', ') || '0'} | ${s.gateSaves} | ${notes} |`);
    }
    lines.push('');
  }

  lines.push('## Privacy (normalization)', '', '| Fixture | Original personal metadata | After normalization | Sent size |', '|---|---|---|---|');
  for (const p of run.privacy) lines.push(`| ${p.fixtureId} | ${p.originalPersonal.join(', ') || 'none'}${p.originalGps ? ' (incl. GPS)' : ''} | ${p.normalizedClean ? 'clean' : `**NOT CLEAN: ${p.normalizedPersonal.join(', ')}**`} | ${p.width}×${p.height}, ~${p.estimatedClaudeImageTokens} Claude image tokens |`);
  lines.push('');
  return lines.join('\n');
}
