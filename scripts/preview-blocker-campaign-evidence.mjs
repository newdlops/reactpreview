/** Compares campaign outcomes and persists phase evidence with content digests. */
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';

export const BLOCKER_CATEGORIES = new Set([
  'build',
  'data',
  'environment',
  'navigation',
  'provider',
  'render',
  'runtime',
  'unsupported',
]);

export const BLOCKER_OUTCOMES = new Set([
  'auto-resolved',
  'prevented',
  'rejected',
  'report-only',
  'rolled-back',
  'unavailable',
]);

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Immutable two-phase campaign ledger; each frozen manifest may be recorded once per phase. */
export function recordPreviewBlockerCampaignPhase(ledger, phase, manifestSha256, evidenceSha256) {
  if (phase !== 'baseline' && phase !== 'after') throw new Error('Campaign phase is invalid.');
  if (!/^[0-9a-f]{64}$/u.test(manifestSha256))
    throw new Error('Campaign manifest digest is invalid.');
  if (!/^[0-9a-f]{64}$/u.test(evidenceSha256))
    throw new Error('Campaign evidence digest is invalid.');
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  if (entries.some((entry) => entry?.phase === phase))
    throw new Error('Campaign phase already recorded.');
  if (entries.length > 0 && entries.some((entry) => entry?.manifestSha256 !== manifestSha256))
    throw new Error('Campaign phases must share one frozen manifest.');
  return Object.freeze({
    format: 'react-preview-campaign-phase-ledger/v1',
    entries: Object.freeze([...entries, Object.freeze({ phase, manifestSha256, evidenceSha256 })]),
  });
}

/** Compares redacted campaign summaries without retaining target paths, messages, or payloads. */
export function comparePreviewBlockerCampaignEvidence(
  baseline,
  after,
  manifestSha256,
  ledger,
  evidenceDigests = {},
) {
  if (!/^[0-9a-f]{64}$/u.test(manifestSha256))
    throw new Error('Campaign manifest digest is invalid.');
  const validate = (summary) => {
    if (
      summary?.format !== 'react-preview-blocker-cases/v2' ||
      summary?.manifestSha256 !== manifestSha256 ||
      !Array.isArray(summary?.scenarioIds) ||
      !summary.scenarioIds.every((id) => /^[0-9a-f]{64}$/u.test(id)) ||
      new Set(summary.scenarioIds).size !== summary.scenarioIds.length ||
      !Array.isArray(summary?.healthyScenarioIds) ||
      !summary.healthyScenarioIds.every((id) => /^[0-9a-f]{64}$/u.test(id)) ||
      new Set(summary.healthyScenarioIds).size !== summary.healthyScenarioIds.length ||
      !summary.healthyScenarioIds.every((id) => summary.scenarioIds.includes(id)) ||
      !Number.isSafeInteger(summary?.counts?.unresolvedScenarioCount) ||
      summary.counts.unresolvedScenarioCount < 0 ||
      summary?.normalized?.categoryOutcomeCounts === null ||
      typeof summary?.normalized?.categoryOutcomeCounts !== 'object' ||
      !Object.values(summary.normalized.categoryOutcomeCounts).every(
        (count) => Number.isSafeInteger(count) && count >= 0,
      ) ||
      !Object.keys(summary.normalized.categoryOutcomeCounts).every((pair) => {
        const parts = pair.split('\0');
        return (
          parts.length === 2 && BLOCKER_CATEGORIES.has(parts[0]) && BLOCKER_OUTCOMES.has(parts[1])
        );
      })
    )
      throw new Error('Campaign evidence is malformed or does not match the frozen manifest.');
  };
  validate(baseline);
  validate(after);
  const baselineScenarios = [...baseline.scenarioIds].sort();
  const afterScenarios = [...after.scenarioIds].sort();
  if (JSON.stringify(baselineScenarios) !== JSON.stringify(afterScenarios))
    throw new Error('Campaign scenarios differ between baseline and after evidence.');
  const baselineDigest = evidenceDigests.baseline ?? sha256(JSON.stringify(baseline));
  const afterDigest = evidenceDigests.after ?? sha256(JSON.stringify(after));
  if (
    ledger?.format !== 'react-preview-campaign-phase-ledger/v1' ||
    !Array.isArray(ledger.entries) ||
    ledger.entries.length !== 2 ||
    ledger.entries[0]?.phase !== 'baseline' ||
    ledger.entries[1]?.phase !== 'after' ||
    ledger.entries[0]?.manifestSha256 !== manifestSha256 ||
    ledger.entries[1]?.manifestSha256 !== manifestSha256 ||
    ledger.entries[0]?.evidenceSha256 !== baselineDigest ||
    ledger.entries[1]?.evidenceSha256 !== afterDigest
  )
    throw new Error('Campaign phase ledger does not bind the captured evidence.');
  const count = (value, key) => (Number.isSafeInteger(value?.scope?.[key]) ? value.scope[key] : -1);
  if (count(baseline, 'targetCount') !== count(after, 'targetCount'))
    throw new Error('Campaign scenarios differ between baseline and after evidence.');
  const fatalKeys = (summary) =>
    new Set(
      Object.entries(summary.normalized.categoryOutcomeCounts)
        .filter(([pair, count]) => pair.endsWith('\0report-only') && count > 0)
        .map(([pair]) => pair),
    );
  const baselineFatal = fatalKeys(baseline);
  const afterFatal = fatalKeys(after);
  for (const key of afterFatal)
    if (!baselineFatal.has(key)) throw new Error('Campaign introduced a new fatal taxonomy.');
  const total = (summary) =>
    Object.entries(summary.normalized.categoryOutcomeCounts)
      .filter(([pair]) => pair.endsWith('\0report-only'))
      .reduce((sum, [, count]) => sum + count, 0);
  if (total(after) > total(baseline)) throw new Error('Campaign fatal total regressed.');
  if (after.counts.unresolvedScenarioCount > baseline.counts.unresolvedScenarioCount)
    throw new Error('Campaign unresolved scenario total regressed.');
  const healthy = (summary) => new Set(summary.healthyScenarioIds ?? []);
  for (const id of healthy(baseline))
    if (!healthy(after).has(id))
      throw new Error('Campaign regressed a previously healthy scenario.');
  if (
    total(after) >= total(baseline) &&
    after.counts.unresolvedScenarioCount >= baseline.counts.unresolvedScenarioCount
  )
    throw new Error('Campaign did not improve fatal or unresolved scenarios.');
  return Object.freeze({
    baselineFatalCount: total(baseline),
    afterFatalCount: total(after),
    phases: ledger,
  });
}

/** Exclusively appends one disk-backed phase record bound to the exact evidence bytes. */
export async function persistPreviewBlockerCampaignPhase(
  ledgerPath,
  phase,
  manifestSha256,
  evidencePath,
) {
  const bytes = await readFile(evidencePath);
  const evidenceSha256 = sha256(bytes);
  const phasePath = `${ledgerPath}.${phase}`;
  const readPhase = async (name) =>
    readFile(`${ledgerPath}.${name}`, 'utf8')
      .then(JSON.parse)
      .catch((error) => (error?.code === 'ENOENT' ? undefined : Promise.reject(error)));
  const existingEntries = [await readPhase('baseline'), await readPhase('after')].filter(Boolean);
  const existing = existingEntries.length === 0 ? undefined : { entries: existingEntries };
  const next = recordPreviewBlockerCampaignPhase(existing, phase, manifestSha256, evidenceSha256);
  const handle = await open(phasePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(next.entries.at(-1))}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return next;
}

export async function campaignEvidence(pathname) {
  const bytes = await readFile(pathname);
  return { digest: sha256(bytes), value: JSON.parse(bytes) };
}
