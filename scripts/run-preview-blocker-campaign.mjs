#!/usr/bin/env node
/** Private, one-shot, focus-independent preview blocker campaign controller. */
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PLAN =
  'breadth-first-preview-blocker-resilience-20260729-v5.6-shared-inspector-parser-remainder';
const FORMAT = 'react-preview-campaign/v2';
const MANIFEST = 'react-preview-campaign/v2';
const PORT = 9945;
const TEMP = '/private/tmp';
const CENSUS_SOURCE_BYTE_LIMIT = 2 * 1024 * 1024;
const CENSUS_NODE_LIMIT = 50_000;
const BLOCKER_CATEGORIES = new Set([
  'build',
  'data',
  'environment',
  'navigation',
  'provider',
  'render',
  'runtime',
  'unsupported',
]);
const BLOCKER_OUTCOMES = new Set([
  'auto-resolved',
  'prevented',
  'rejected',
  'report-only',
  'rolled-back',
  'unavailable',
]);
const PREVIEW_COMMANDS = Object.freeze(['direct-preview', 'page-inspector']);
export const V53_LEXICAL_ROOT = '/tmp/rp56-p0';
export const V53_CANONICAL_ROOT = '/private/tmp/rp56-p0';
export const DARWIN_MAIN_SOCKET = '1.13-main.sock';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);
const inspectorParser = require('./preview-blocker-campaign-host.cjs');
const typescript = require('typescript');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inside = (value, root) => value === root || value.startsWith(`${root}${path.sep}`);
const digestPath = (value) => sha256(path.basename(value));
const option = (args, name) => {
  const index = args.lastIndexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const options = (args, name) =>
  args.flatMap((value, index) => (value === name ? [args[index + 1]] : [])).filter(Boolean);
const sourceHash = async (file) => sha256(await readFile(file));
const sourceStat = async (file) => {
  const link = await lstat(file);
  if (link.isSymbolicLink() || link.nlink !== 1 || !link.isFile())
    throw new Error('Campaign file is not a private regular file.');
  return link;
};
const fail = (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Campaign failed.'}\n`);
  process.exitCode = 1;
};

/** Stable, framework-general blocker families emitted by the static census. */
export const PREVIEW_BLOCKER_SIGNATURE_FAMILIES = Object.freeze([
  'apollo-graphql',
  'authored-throw',
  'browser-capability',
  'dynamic-import',
  'environment',
  'formik',
  'network',
  'portal-dom',
  'provider-context',
  'redirect',
  'redux',
  'router',
  'styled-theme',
  'style-asset',
]);

/** Returns a source-only category for syntax that can affect isolated preview execution. */
function censusFamily(node) {
  if (typescript.isThrowStatement(node)) return 'authored-throw';
  if (typescript.isImportCall(node)) return 'dynamic-import';
  if (typescript.isCallExpression(node)) {
    const text = node.expression.getText();
    if (/^(?:ReactDOM\.)?createPortal$/u.test(text)) return 'portal-dom';
    if (/^(?:window\.)?(?:fetch|XMLHttpRequest)$/u.test(text)) return 'network';
    if (/^(?:history\.)?(?:push|replace)$/u.test(text) || /^navigate$/u.test(text))
      return 'redirect';
  }
  if (typescript.isImportDeclaration(node)) {
    const moduleName =
      typeof node.moduleSpecifier.text === 'string' ? node.moduleSpecifier.text : '';
    if (/\.(?:css|s[ac]ss|less|svg|png|jpe?g|gif|webp|woff2?)$/iu.test(moduleName))
      return 'style-asset';
    if (/(?:apollo|graphql)/iu.test(moduleName)) return 'apollo-graphql';
    if (/formik/iu.test(moduleName)) return 'formik';
    if (/(?:redux|react-redux)/iu.test(moduleName)) return 'redux';
    if (/(?:react-router|router)/iu.test(moduleName)) return 'router';
    if (/(?:styled-components|emotion)/iu.test(moduleName)) return 'styled-theme';
  }
  if (typescript.isIdentifier(node)) {
    if (node.text === 'process' || node.text === 'global') return 'environment';
    if (node.text === 'window' || node.text === 'document' || node.text === 'navigator')
      return 'browser-capability';
    if (/^(?:useContext|createContext|Provider)$/u.test(node.text)) return 'provider-context';
  }
  return undefined;
}

function hasRuntimeExport(source) {
  if (/\.d\.ts$/iu.test(source.fileName)) return false;
  return source.statements.some((statement) => {
    if (typescript.isExportAssignment(statement)) return !statement.isExportEquals;
    if (typescript.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined) return statement.isTypeOnly !== true;
      if (statement.isTypeOnly === true || statement.exportClause?.isTypeOnly === true)
        return false;
      if (typescript.isNamedExports(statement.exportClause))
        return statement.exportClause.elements.some((specifier) => specifier.isTypeOnly !== true);
      return (
        statement.exportClause === undefined || typescript.isNamespaceExport(statement.exportClause)
      );
    }
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword,
    );
    if (!exported) return false;
    if (
      typescript.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === typescript.SyntaxKind.DeclareKeyword,
      )
    )
      return false;
    if (
      typescript.isClassDeclaration(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === typescript.SyntaxKind.DeclareKeyword,
      )
    )
      return false;
    if (
      typescript.isFunctionDeclaration(statement) &&
      (statement.modifiers?.some(
        (modifier) => modifier.kind === typescript.SyntaxKind.DeclareKeyword,
      ) ||
        statement.body === undefined)
    )
      return false;
    return (
      !typescript.isInterfaceDeclaration(statement) &&
      !typescript.isTypeAliasDeclaration(statement) &&
      !typescript.isImportDeclaration(statement)
    );
  });
}

/**
 * Produces a bounded, identifier-free AST signature census for one authored source file.
 * Signature names deliberately contain only family and syntax-kind; paths remain private manifest data.
 */
export function censusPreviewBlockerSource(sourceText, fileName = 'source.tsx') {
  if (Buffer.byteLength(sourceText, 'utf8') > CENSUS_SOURCE_BYTE_LIMIT)
    return Object.freeze({ bucket: 'oversized', exportable: false, signatures: Object.freeze([]) });
  const source = typescript.createSourceFile(
    fileName,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
  );
  const signatures = new Set();
  let nodeCount = 0;
  let overBudget = false;
  const visit = (node) => {
    if (++nodeCount > CENSUS_NODE_LIMIT) {
      overBudget = true;
      return;
    }
    const family = censusFamily(node);
    if (family !== undefined) signatures.add(`${family}:${typescript.SyntaxKind[node.kind]}`);
    typescript.forEachChild(node, visit);
  };
  visit(source);
  if (overBudget)
    return Object.freeze({ bucket: 'oversized', exportable: false, signatures: Object.freeze([]) });
  if (source.parseDiagnostics.length > 0)
    return Object.freeze({ bucket: 'malformed', exportable: false, signatures: Object.freeze([]) });
  return Object.freeze({
    bucket: hasRuntimeExport(source) ? 'ready' : 'non-exportable',
    exportable: hasRuntimeExport(source),
    signatures: Object.freeze([...signatures].sort()),
  });
}

/** Greedily selects files that cover the most uncovered signatures, with lexical tie breaking. */
export function selectPreviewBlockerCensusTargets(candidates, cap = 200) {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 200)
    throw new Error('Campaign target cap is invalid.');
  const remaining = new Set(
    candidates
      .filter((candidate) => candidate.exportable)
      .flatMap((candidate) => candidate.signatures),
  );
  const available = candidates
    .filter((candidate) => candidate.exportable)
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  const breadthStrata = [...new Set(available.map((candidate) => candidate.stratum ?? 'default'))]
    .sort();
  const selected = [];
  // Historical blockers are regression anchors. Retain them even when their signatures are now
  // redundant, before coverage rotation considers newly discovered surfaces.
  for (const candidate of [...available].filter((value) => value.historical === true)) {
    if (selected.length >= cap) break;
    available.splice(available.indexOf(candidate), 1);
    selected.push(candidate);
    candidate.signatures.forEach((signature) => remaining.delete(signature));
  }
  while (available.length > 0 && selected.length < cap) {
    const selectedStratum = breadthStrata
      .slice(selected.length % breadthStrata.length)
      .concat(breadthStrata.slice(0, selected.length % breadthStrata.length))
      .find((stratum) => available.some((candidate) => (candidate.stratum ?? 'default') === stratum));
    const eligible = available.filter(
      (candidate) => (candidate.stratum ?? 'default') === selectedStratum,
    );
    const ranked = (eligible.length > 0 ? eligible : available).sort((left, right) => {
      const leftHistorical = left.historical === true ? 1 : 0;
      const rightHistorical = right.historical === true ? 1 : 0;
      const leftCoverage = left.signatures.filter((signature) => remaining.has(signature)).length;
      const rightCoverage = right.signatures.filter((signature) => remaining.has(signature)).length;
      return rightHistorical - leftHistorical || rightCoverage - leftCoverage ||
        left.sourcePath.localeCompare(right.sourcePath);
    });
    let next = ranked.find((candidate) =>
      candidate.signatures.some((signature) => remaining.has(signature)),
    );
    if (next === undefined)
      next = [...available]
        .sort(
          (left, right) =>
            right.signatures.filter((signature) => remaining.has(signature)).length -
              left.signatures.filter((signature) => remaining.has(signature)).length ||
            left.sourcePath.localeCompare(right.sourcePath),
        )
        .find((candidate) => candidate.signatures.some((signature) => remaining.has(signature)));
    if (next === undefined && remaining.size === 0) next = ranked[0] ?? available[0];
    if (next === undefined) break;
    available.splice(available.indexOf(next), 1);
    selected.push(next);
    next.signatures.forEach((signature) => remaining.delete(signature));
  }
  return Object.freeze({
    selected: Object.freeze(selected),
    uncoveredSignatures: Object.freeze([...remaining].sort()),
  });
}

/**
 * Creates a generic, root-relative breadth bucket without inspecting project identifiers.
 * The first two authored directory levels distinguish page/render surfaces while remaining bounded
 * and deterministic for repositories with arbitrary layouts.
 */
export function derivePreviewBlockerBreadthStratum(sourcePath, root, rootStratum = 'default') {
  const relative = path.relative(root, sourcePath);
  const segments = path.dirname(relative).split(path.sep).filter((value) => value && value !== '.').slice(0, 2);
  const surface = segments.length === 0 ? 'root' : segments.join('/').slice(0, 120);
  return `${rootStratum}:${surface}`;
}

/** Rejects outputs that could overwrite source or follow links outside a private evidence directory. */
export async function validatePreviewBlockerManifestOutput(out, roots) {
  const parent = await realpath(path.dirname(out));
  const resolved = path.join(parent, path.basename(out));
  if (roots.some((root) => inside(resolved, root)))
    throw new Error('Campaign manifest output is inside a source root.');
  return resolved;
}

async function readCensusSnapshot(file) {
  const details = await sourceStat(file);
  if (details.size > CENSUS_SOURCE_BYTE_LIMIT)
    return {
      bytes: undefined,
      sourceHash: undefined,
      sourceSize: details.size,
      census: { bucket: 'oversized', exportable: false, signatures: [] },
    };
  const bytes = await readFile(file);
  const after = await sourceStat(file);
  if (after.size !== details.size || after.mtimeMs !== details.mtimeMs)
    throw new Error('Campaign source changed during census.');
  const text = bytes.toString('utf8');
  return {
    bytes,
    sourceHash: sha256(bytes),
    sourceSize: bytes.length,
    census: censusPreviewBlockerSource(text, file),
  };
}

async function authoredSources(root) {
  const result = [];
  const skippedDirectoryNames = new Set(['.git', '.next', '.turbo', 'dist', 'node_modules']);
  const walk = async (directory) => {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const details = await lstat(file);
      if (details.isSymbolicLink()) continue;
      if (details.isDirectory() && !skippedDirectoryNames.has(name)) await walk(file);
      else if (details.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(name)) result.push(file);
    }
  };
  await walk(root);
  return result;
}

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

async function campaignEvidence(pathname) {
  const bytes = await readFile(pathname);
  return { digest: sha256(bytes), value: JSON.parse(bytes) };
}

export function validateInspectorPort(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/u.test(value))
    throw new Error('Campaign inspector port is invalid.');
  const port = Number(value);
  if (!Number.isInteger(port) || port > 65535)
    throw new Error('Campaign inspector port is invalid.');
  return port;
}
export function createOpenArguments(authority, environment, applicationStdout, applicationStderr) {
  if (
    authority.canonicalRepo !== '/Users/lky/project/reactpreview' ||
    !authority.canonicalRepo ||
    authority.canonicalRepo.includes('undefined')
  )
    throw new Error('Campaign extension development path is invalid.');
  return [
    '-F',
    '-g',
    '-j',
    '-n',
    '-W',
    '--stdout',
    applicationStdout,
    '--stderr',
    applicationStderr,
    '-a',
    '/Applications/Visual Studio Code.app',
    '--args',
    `--user-data-dir=${authority.userdata}`,
    `--extensions-dir=${authority.extensions}`,
    `--logsPath=${authority.logs}`,
    '--disable-extensions',
    '--disable-updates',
    '--disable-telemetry',
    '--disable-experiments',
    '--disable-workspace-trust',
    '--disable-crash-reporter',
    '--use-inmemory-secretstorage',
    '--skip-welcome',
    '--skip-release-notes',
    '--skip-add-to-recently-opened',
    '--log=trace',
    '--log=newdlops.react-file-preview:trace',
    `--extensionDevelopmentPath=${authority.canonicalRepo}`,
    `--extensionTestsPath=${authority.hostPath}`,
    `--inspect-extensions=${PORT}`,
    `--extensionEnvironment=${environment}`,
    authority.workspacePath,
  ];
}
export function classifyLaunchEvidence(e) {
  if (e.spawnError) return 'launcher-spawn-error';
  if (e.launcherExited && !e.mainSeen) return 'launcher-exited-before-main';
  if (e.mainSeen && !e.hostStart) return 'main-exited-before-host-bootstrap';
  if (e.hostAuthorityFailed) return 'host-authority-failed';
  if (e.hostStart && !e.debugVerified) return 'host-debug-failed';
  if (e.extensionFailed) return 'extension-workspace-proof-failed';
  if (e.ambiguous) return 'process-proof-ambiguous';
  if (e.inspectorFailed) return 'inspector-unreachable';
  if (e.proofInvalid) return 'proof-invalid';
  if (e.debugVerified && !e.acknowledged) return 'acknowledgement-failed';
  if (e.scenarioFailed) return 'scenario-failed';
  return e.complete ? 'campaign-complete' : 'unknown-launch-failure';
}
export function createDiagnosticIndex(
  artifacts,
  terminalClassification,
  manifestSha256,
  ledgerSha256 = '',
  coverageCount = 0,
) {
  return {
    format: 'react-preview-campaign-diagnostic-index/v1',
    manifestSha256,
    terminalClassification,
    ledgerSha256,
    coverageCount,
    artifacts: [...artifacts]
      .map(({ name, bytes, sha256: digest }) => ({
        name: path.basename(name),
        bytes,
        sha256: digest,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
export function validateProofAcknowledgement(proof, acknowledgement, authoritySha256) {
  try {
    validateInspectorEndpoint(proof?.inspectorUrl);
  } catch {
    throw new Error('Campaign proof acknowledgement is invalid.');
  }
  if (
    proof.authoritySha256 !== authoritySha256 ||
    acknowledgement?.proofSha256 !== sha256(JSON.stringify(proof))
  )
    throw new Error('Campaign proof acknowledgement is invalid.');
  return true;
}
export function validateInspectorEndpoint(value) {
  const result = inspectorParser.validateInspectorUrl(value);
  if (!result.ok) throw new Error(`Campaign inspector endpoint is invalid: ${result.code}`);
  return { host: result.host, port: result.port };
}
export function processMatches(record, authority) {
  return (
    record &&
    record.command.includes(`--user-data-dir=${authority.userdata}`) &&
    record.command.includes(authority.workspacePath)
  );
}
export function exactPidMatches(record, expected, authority) {
  return (
    record?.pid === expected?.pid &&
    record?.start === expected?.start &&
    processMatches(record, authority)
  );
}
export function ipcSocketCandidates(root = V53_LEXICAL_ROOT) {
  if (root !== V53_LEXICAL_ROOT) throw new Error('Campaign IPC root is fixed.');
  return [
    `${V53_LEXICAL_ROOT}/u/${DARWIN_MAIN_SOCKET}`,
    `${V53_CANONICAL_ROOT}/u/${DARWIN_MAIN_SOCKET}`,
  ];
}
export function validateIpcSocketCandidates(candidates = ipcSocketCandidates()) {
  if (
    !Array.isArray(candidates) ||
    candidates.length !== 2 ||
    new Set(candidates).size !== 2 ||
    candidates.some(
      (value) =>
        typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > 102,
    )
  )
    throw new Error('Campaign IPC path is invalid.');
  return candidates;
}

async function privateDirectory(directory, create = true) {
  if (create) await mkdir(directory, { mode: 0o700, recursive: true });
  const value = await lstat(directory);
  if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== process.getuid?.())
    throw new Error('Campaign private directory is invalid.');
  if ((value.mode & 0o077) !== 0)
    throw new Error('Campaign private directory has broad permissions.');
  return realpath(directory);
}
async function exclusive(file, data = '') {
  const handle = await open(file, 'wx', 0o600);
  try {
    if (data !== '') await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(file, 0o600);
}
async function append(handle, record) {
  await handle.appendFile(`${JSON.stringify(record)}\n`);
  await handle.sync();
}
async function verifyManifest(manifestPath) {
  const resolved = await realpath(manifestPath);
  const bytes = await readFile(resolved);
  const value = JSON.parse(bytes);
  if (value.format !== MANIFEST || !Array.isArray(value.roots) || !Array.isArray(value.targets))
    throw new Error('Invalid campaign manifest.');
  for (const root of value.roots) await privateRoot(root);
  for (const target of value.targets) {
    const source = await realpath(target.sourcePath);
    if (!value.roots.some((root) => inside(source, root)))
      throw new Error('Campaign target is outside approved roots.');
    const details = await sourceStat(source);
    if (details.size !== target.sourceSize || (await sourceHash(source)) !== target.sourceHash)
      throw new Error('Campaign source hash changed.');
  }
  return { path: resolved, bytes, value, sha256: sha256(bytes) };
}
async function privateRoot(root) {
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Campaign root is invalid.');
  return realpath(root);
}
async function portAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/json/list`, (response) => {
      response.resume();
      reject(new Error('Campaign inspector port is already serving HTTP.'));
    });
    request.once('error', resolve);
    request.setTimeout(300, () => {
      request.destroy();
      resolve();
    });
  });
}
async function processSnapshot() {
  const child = spawn('ps', ['-Ao', 'pid,ppid,lstart,command', '-ww'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let text = '';
  child.stdout.on('data', (chunk) => {
    text += chunk;
  });
  await new Promise((resolve) => child.once('close', resolve));
  return text
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const hit = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/u);
      return hit
        ? [{ pid: Number(hit[1]), ppid: Number(hit[2]), start: hit[3].trim(), command: hit[4] }]
        : [];
    });
}
async function httpInspector(endpoint) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: endpoint.host,
        port: endpoint.port,
        path: '/json/list',
        family: endpoint.host === '::1' ? 6 : 4,
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.once('error', reject);
    request.setTimeout(1500, () => request.destroy(new Error('Inspector timeout.')));
  });
}
function controllerPaths(root) {
  return {
    userdata: `${root}/u`,
    extensions: `${root}/e`,
    logs: `${root}/l`,
    evidence: `${root}/c`,
    diagnostics: `${root}/d`,
  };
}
async function createAuthority(manifest, extension, evidence) {
  if (evidence !== V53_LEXICAL_ROOT) throw new Error('Campaign evidence path is fixed.');
  await mkdir(V53_LEXICAL_ROOT, { mode: 0o700 });
  await chmod(V53_LEXICAL_ROOT, 0o700);
  if ((await realpath(V53_LEXICAL_ROOT)) !== V53_CANONICAL_ROOT)
    throw new Error('Campaign IPC root canonical path is invalid.');
  const root = V53_LEXICAL_ROOT;
  const dirs = controllerPaths(root);
  for (const value of Object.values(dirs)) await privateDirectory(value);
  const workspacePath = `${root}/w.code-workspace`;
  await exclusive(
    workspacePath,
    `${JSON.stringify({ folders: manifest.value.roots.map((value) => ({ path: value })) })}\n`,
  );
  const hostPath = path.resolve('scripts/preview-blocker-campaign-host.cjs');
  const packagePath = path.join(extension, 'package.json');
  const mainPath = path.join(extension, 'dist/extension.mjs');
  const workerPath = path.join(extension, 'dist/previewCompilerWorker.js');
  const fixed = {
    proofPath: path.join(root, 'proof.json'),
    acknowledgementPath: path.join(root, 'acknowledgement.json'),
    stopPath: path.join(root, 'stop.json'),
    leasePath: path.join(root, 'lease.json'),
    controllerLogPath: `${root}/c/controller.jsonl`,
    hostStartPath: `${root}/host-start.jsonl`,
    hostEvidencePath: `${root}/h`,
    hostLogPath: `${root}/h/host.jsonl`,
    processLogPath: `${root}/c/process.jsonl`,
    diagnosticIndexPath: path.join(root, 'diagnostic-index.json'),
  };
  const ownership = {
    controllerEvidence: dirs.evidence,
    controllerDiagnostics: dirs.diagnostics,
    hostStart: fixed.hostStartPath,
    hostEvidence: fixed.hostEvidencePath,
    hostLog: fixed.hostLogPath,
  };
  const ownershipDigest = sha256(JSON.stringify(ownership));
  if (extension !== '/Users/lky/project/reactpreview')
    throw new Error('Campaign canonical repository is invalid.');
  const authority = {
    format: 'react-preview-campaign-authority/v1',
    planVersion: PLAN,
    attemptOrdinal: 5,
    priorAttemptOrdinals: [1, 2, 3, 4],
    campaignId: randomBytes(16).toString('hex'),
    hostSessionId: randomBytes(16).toString('hex'),
    creatorUid: process.getuid?.() ?? -1,
    createdAt: Date.now(),
    expiresAt: Date.now() + 35 * 60_000,
    manifestPath: manifest.path,
    manifestSha256: manifest.sha256,
    workspacePath,
    workspaceSha256: await sourceHash(workspacePath),
    rootsDigest: sha256(JSON.stringify(manifest.value.roots)),
    controllerRoot: root,
    canonicalControllerRoot: V53_CANONICAL_ROOT,
    ownershipDigest,
    ...dirs,
    ...fixed,
    canonicalRepo: extension,
    hostPath,
    packageSha256: await sourceHash(packagePath),
    extensionMainSha256: await sourceHash(mainPath),
    workerSha256: await sourceHash(workerPath),
    expectedExtensionId: 'newdlops.react-file-preview',
    expectedMode: 'test',
    commands: ['reactPreview.open', 'reactPreview.openComponentGallery'],
    viewTypes: ['reactPreview.currentFile', 'reactPreview.pageInspector'],
    inspectorPort: PORT,
    startingScenarioOrdinal: 0,
  };
  const authorityPath = path.join(root, 'authority.json');
  await exclusive(authorityPath, `${JSON.stringify(authority)}\n`);
  return { authority, authorityPath, authoritySha256: await sourceHash(authorityPath) };
}
async function preflightIpc(authority) {
  const candidates = validateIpcSocketCandidates();
  if (
    authority.controllerRoot !== V53_LEXICAL_ROOT ||
    authority.userdata !== `${V53_LEXICAL_ROOT}/u` ||
    (await realpath(authority.userdata)) !== `${V53_CANONICAL_ROOT}/u`
  )
    throw new Error('Campaign IPC launch path is invalid.');
  const results = [];
  for (const candidate of candidates) {
    await lstat(candidate)
      .then(() => {
        throw new Error('Campaign IPC socket already exists.');
      })
      .catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(candidate, () => server.close(resolve));
    });
    await lstat(candidate)
      .then(async () => {
        await unlink(candidate);
        throw new Error('Campaign IPC probe cleanup failed.');
      })
      .catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    results.push({
      pathDigest: sha256(candidate),
      bytes: Buffer.byteLength(candidate, 'utf8'),
      bound: true,
      cleaned: true,
    });
  }
  const file = `${authority.diagnostics}/ipc-preflight.json`;
  await exclusive(
    file,
    `${JSON.stringify({ format: 'react-preview-campaign-ipc-preflight/v1', candidates: results })}\n`,
  );
  return results;
}
async function listArtifacts(root) {
  const result = [];
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const file = path.join(dir, name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('Campaign artifact is a symlink.');
      if (info.isDirectory()) await walk(file);
      else if (info.isFile())
        result.push({
          name: path.relative(root, file),
          bytes: info.size,
          sha256: await sourceHash(file),
        });
    }
  }
  await walk(root);
  return result;
}
async function teardown(child, identity, authority) {
  const current = await processSnapshot();
  const matches = current
    .filter((entry) => identity.some((known) => exactPidMatches(entry, known, authority)))
    .sort((a, b) => b.ppid - a.ppid);
  for (const entry of matches) process.kill(entry.pid, 'SIGTERM');
  await sleep(1000);
  for (const entry of await processSnapshot())
    if (matches.some((known) => exactPidMatches(entry, known, authority)))
      process.kill(entry.pid, 'SIGKILL');
  if (!child.killed) child.kill('SIGTERM');
}
async function historicalTargets(inputs) {
  const targets = new Set();
  const visit = async (input) => {
    const details = await lstat(input);
    if (details.isSymbolicLink()) return;
    if (details.isDirectory()) {
      for (const item of await readdir(input)) await visit(path.join(input, item));
      return;
    }
    const content = await readFile(input, 'utf8');
    for (const found of content.matchAll(/"previewTarget"\s*:\s*"((?:\\.|[^"\\])+)"/gu))
      try {
        targets.add(JSON.parse(`"${found[1]}"`));
      } catch {}
  };
  for (const input of inputs) await visit(input);
  return [...targets];
}
async function manifest(args) {
  const roots = await Promise.all(options(args, '--root').map(privateRoot));
  const out = option(args, '--out');
  const cap = Number(option(args, '--cap') ?? '200');
  if (!out || !roots.length || !options(args, '--log').length)
    throw new Error('manifest requires --root, --log, and --out.');
  const output = await validatePreviewBlockerManifestOutput(out, roots);
  const stratumByRoot = new Map(
    options(args, '--stratum')
      .map((value) => value.split('=', 2))
      .filter(([root, stratum]) => root && stratum),
  );
  const historical = await historicalTargets(options(args, '--log'));
  const historicalResolved = new Set();
  for (const candidate of historical) {
    if (!/\.(?:[cm]?[jt]sx?)$/u.test(candidate)) continue;
    if ((await lstat(candidate)).isSymbolicLink())
      throw new Error('Campaign target may not be a symlink.');
    const resolved = await realpath(candidate);
    if (!roots.some((root) => inside(resolved, root)))
      throw new Error('Campaign target is outside an approved root.');
    historicalResolved.add(resolved);
  }
  const candidates = [];
  for (const root of roots)
    for (const file of await authoredSources(root)) {
      const resolved = await realpath(file);
      const snapshot = await readCensusSnapshot(resolved);
      candidates.push({
        ...snapshot.census,
        sourceHash: snapshot.sourceHash,
        sourcePath: resolved,
        sourceSize: snapshot.sourceSize,
        historical: historicalResolved.has(resolved),
        stratum: derivePreviewBlockerBreadthStratum(
          resolved,
          root,
          stratumByRoot.get(root) ?? 'default',
        ),
      });
    }
  for (const resolved of historicalResolved) {
    if (!candidates.some((entry) => entry.sourcePath === resolved)) {
      const snapshot = await readCensusSnapshot(resolved);
      const root = roots.find((value) => inside(resolved, value));
      candidates.push({
        ...snapshot.census,
        sourceHash: snapshot.sourceHash,
        sourcePath: resolved,
        sourceSize: snapshot.sourceSize,
        historical: true,
        stratum: derivePreviewBlockerBreadthStratum(
          resolved,
          root,
          stratumByRoot.get(root) ?? 'default',
        ),
      });
    }
  }
  const selection = selectPreviewBlockerCensusTargets(candidates, cap);
  const targets = selection.selected.map(({ exportable, signatures, bucket, ...target }) => ({
    ...target,
    status: 'ready',
  }));
  const buckets = Object.fromEntries(
    ['malformed', 'non-exportable', 'oversized'].map((bucket) => [
      bucket,
      candidates.filter((candidate) => candidate.bucket === bucket).length,
    ]),
  );
  const unavailableCount = Object.values(buckets).reduce((sum, count) => sum + count, 0);
  const value = {
    format: MANIFEST,
    commands: PREVIEW_COMMANDS,
    id: sha256(JSON.stringify({ roots, targets })).slice(0, 32),
    roots,
    targets,
    unavailableCount,
    census: {
      signatureCount: new Set(candidates.flatMap((candidate) => candidate.signatures)).size,
      uncoveredSignatureCount: selection.uncoveredSignatures.length,
      buckets,
    },
  };
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  process.stdout.write(
    `${JSON.stringify({ format: MANIFEST, manifestHash: sha256(await readFile(output)), readyTargetCount: targets.length, unavailableTargetCount: unavailableCount, uncoveredSignatureCount: selection.uncoveredSignatures.length })}\n`,
  );
}
async function run(args) {
  process.umask(0o077);
  const manifestPath = option(args, '--manifest');
  const extensionArg = option(args, '--extension');
  const evidence = option(args, '--evidence');
  const ledger = option(args, '--launch-ledger');
  const port = validateInspectorPort(option(args, '--inspector-port') ?? String(PORT));
  if (port !== PORT || !manifestPath || !extensionArg || !evidence || !ledger)
    throw new Error('run requires frozen launch arguments.');
  const manifest = await verifyManifest(manifestPath);
  const extension = await realpath(extensionArg);
  const launch = await createAuthority(manifest, extension, evidence);
  const { authority } = launch;
  const ledgerParent = await privateDirectory(path.dirname(ledger), false);
  if (ledgerParent !== path.dirname(manifest.path) || (await lstat(ledger).catch(() => undefined)))
    throw new Error('Campaign launch ledger already exists or is invalid.');
  await portAvailable(PORT);
  const paths = {
    launcherStdout: path.join(authority.diagnostics, 'launcher.stdout'),
    launcherStderr: path.join(authority.diagnostics, 'launcher.stderr'),
    applicationStdout: path.join(authority.diagnostics, 'application.stdout'),
    applicationStderr: path.join(authority.diagnostics, 'application.stderr'),
  };
  for (const file of Object.values(paths)) await exclusive(file);
  await exclusive(authority.controllerLogPath);
  await exclusive(authority.processLogPath);
  const controller = await open(authority.controllerLogPath, 'a');
  const processLog = await open(authority.processLogPath, 'a');
  let sequence = 0;
  const emit = (event, fields = {}) =>
    append(controller, {
      format: FORMAT,
      campaignId: authority.campaignId,
      hostSessionId: authority.hostSessionId,
      writer: 'controller',
      sequence: ++sequence,
      elapsedMs: Date.now() - authority.createdAt,
      event,
      ...fields,
    });
  const environment = JSON.stringify({
    REACT_PREVIEW_CAMPAIGN_AUTHORITY: launch.authorityPath,
    REACT_PREVIEW_CAMPAIGN_AUTHORITY_SHA256: launch.authoritySha256,
  });
  const vector = createOpenArguments(
    authority,
    environment,
    paths.applicationStdout,
    paths.applicationStderr,
  );
  const ipc = await preflightIpc(authority);
  await emit('preflight-complete', {
    ipcCandidates: ipc.map(({ bytes, bound, cleaned }) => ({ bytes, bound, cleaned })),
  });
  await emit('launch-intent', {
    attempt: authority.attemptOrdinal,
    argumentDigest: sha256(JSON.stringify(vector)),
    authorityDigest: launch.authoritySha256,
    inspectorPort: PORT,
    diagnosticDigests: Object.values(paths).map(digestPath),
  });
  const pre = await processSnapshot();
  if (pre.some((entry) => processMatches(entry, authority)))
    throw new Error('Campaign private process exists before spawn.');
  await lstat(authority.hostStartPath)
    .then(() => {
      throw new Error('Campaign host bootstrap already exists.');
    })
    .catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  await lstat(authority.hostEvidencePath)
    .then(() => {
      throw new Error('Campaign host evidence already exists.');
    })
    .catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  const ledgerValue = {
    planVersion: PLAN,
    manifestSha256: manifest.sha256,
    attemptOrdinal: authority.attemptOrdinal,
    priorAttemptOrdinals: authority.priorAttemptOrdinals,
    controllerRootDigest: sha256(authority.controllerRoot),
    ownershipDigest: authority.ownershipDigest,
    launchVectorDigest: sha256(JSON.stringify(vector)),
    createdAt: Date.now(),
  };
  await exclusive(ledger, `${JSON.stringify(ledgerValue)}\n`);
  const ledgerSha = await sourceHash(ledger);
  const descriptors = await Promise.all(
    [paths.launcherStdout, paths.launcherStderr].map((file) => open(file, 'a')),
  );
  let child;
  const evidenceState = {};
  try {
    child = spawn('/usr/bin/open', vector, {
      stdio: ['ignore', descriptors[0].fd, descriptors[1].fd],
    });
    child.once('error', () => {
      evidenceState.spawnError = true;
      void emit('launcher-error');
    });
    child.once('exit', (code, signal) => {
      evidenceState.launcherExited = true;
      void emit('launcher-exit', { code, signal });
    });
    child.once('close', (code, signal) => void emit('launcher-close', { code, signal }));
    await emit('launcher-spawned');
    const deadline = Date.now() + 20_000;
    let identities = [];
    while (Date.now() < deadline) {
      const snapshot = await processSnapshot();
      const matches = snapshot.filter((entry) => processMatches(entry, authority));
      for (const entry of matches)
        await append(processLog, {
          format: FORMAT,
          writer: 'process',
          event: 'process-observed',
          pid: entry.pid,
          ppid: entry.ppid,
          start: entry.start,
          commandDigest: sha256(entry.command),
        });
      if (matches.length > 1) evidenceState.ambiguous = true;
      if (matches.length === 1) {
        identities = matches;
        evidenceState.mainSeen = true;
        await emit('process-verified', { pid: matches[0].pid, start: matches[0].start });
      }
      const application = `${await readFile(paths.applicationStdout, 'utf8').catch(() => '')}\n${await readFile(paths.applicationStderr, 'utf8').catch(() => '')}`;
      if (/(?:extensionDevelopmentPath[^\n]*undefined|\/undefined)/u.test(application)) {
        evidenceState.extensionFailed = true;
        break;
      }
      try {
        const proof = JSON.parse(await readFile(authority.proofPath));
        evidenceState.hostStart = true;
        if (proof.debugVerified) evidenceState.debugVerified = true;
        validateProofAcknowledgement(
          proof,
          { proofSha256: sha256(JSON.stringify(proof)) },
          launch.authoritySha256,
        );
        const pages = await httpInspector(validateInspectorEndpoint(proof.inspectorUrl));
        if (!pages.some((page) => page.webSocketDebuggerUrl === proof.inspectorUrl))
          throw new Error('Inspector proof mismatch.');
        await emit('inspector-verified');
        await exclusive(
          authority.acknowledgementPath,
          `${JSON.stringify({ format: 'react-preview-campaign-ack/v1', proofSha256: sha256(JSON.stringify(proof)), authoritySha256: launch.authoritySha256, controllerSequence: sequence })}\n`,
        );
        evidenceState.acknowledged = true;
        await emit('acknowledgement-written');
        break;
      } catch (error) {
        if (String(error).includes('Inspector proof')) evidenceState.inspectorFailed = true;
      }
      if (evidenceState.launcherExited && !evidenceState.mainSeen) break;
      await sleep(100);
    }
    if (!evidenceState.acknowledged)
      throw new Error('Campaign acknowledgement was not established.');
    await new Promise((resolve) => child.once('close', resolve));
    evidenceState.complete = true;
    await emit('campaign-complete');
  } catch (error) {
    const hostEvents = `${await readFile(authority.hostStartPath, 'utf8').catch(() => '')}\n${await readFile(authority.hostLogPath, 'utf8').catch(() => '')}`;
    evidenceState.hostStart ||= hostEvents.includes('host-start');
    evidenceState.debugVerified ||= hostEvents.includes('debug-verified');
    evidenceState.hostAuthorityFailed = hostEvents.includes('authority-failed');
    evidenceState.extensionFailed = hostEvents.includes('extension-failed');
    const terminal = classifyLaunchEvidence(evidenceState);
    await emit('failure-classified', { terminal, elapsedMs: Date.now() - authority.createdAt });
    await teardown(
      child,
      await processSnapshot().then((items) =>
        items.filter((item) => processMatches(item, authority)),
      ),
      authority,
    );
    await exclusive(
      authority.stopPath,
      `${JSON.stringify({ terminal, expiredAt: Date.now() })}\n`,
    ).catch(() => {});
    await emit('teardown-complete', { terminal });
    const index = createDiagnosticIndex(
      await listArtifacts(authority.controllerRoot),
      terminal,
      manifest.sha256,
      ledgerSha,
      0,
    );
    await exclusive(authority.diagnosticIndexPath, `${JSON.stringify(index)}\n`);
    process.stdout.write(
      `${JSON.stringify({ diagnosticIndexSha256: await sourceHash(authority.diagnosticIndexPath), manifestSha256: manifest.sha256, terminalClassification: terminal, coverageCount: 0 })}\n`,
    );
    throw error;
  } finally {
    await Promise.all(descriptors.map((handle) => handle.close()));
    await controller.close();
    await processLog.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'manifest') await manifest(args);
    else if (command === 'run') await run(args);
    else if (command === 'record') {
      const ledger = option(args, '--ledger');
      const phase = option(args, '--phase');
      const manifestSha256 = option(args, '--manifest-sha256');
      const evidence = option(args, '--evidence');
      if (!ledger || !phase || !manifestSha256 || !evidence)
        throw new Error('record requires ledger, phase, manifest digest, and evidence.');
      const value = await persistPreviewBlockerCampaignPhase(
        ledger,
        phase,
        manifestSha256,
        evidence,
      );
      process.stdout.write(`${JSON.stringify({ format: value.format, phase })}\n`);
    } else if (command === 'compare') {
      const ledger = option(args, '--ledger');
      const manifestSha256 = option(args, '--manifest-sha256');
      const baseline = option(args, '--baseline');
      const after = option(args, '--after');
      if (!ledger || !manifestSha256 || !baseline || !after)
        throw new Error('compare requires ledger, manifest digest, baseline, and after.');
      const baselineEvidence = await campaignEvidence(baseline);
      const afterEvidence = await campaignEvidence(after);
      const ledgerEntries = await Promise.all(
        ['baseline', 'after'].map(async (phase) =>
          JSON.parse(await readFile(`${ledger}.${phase}`, 'utf8')),
        ),
      );
      const value = comparePreviewBlockerCampaignEvidence(
        baselineEvidence.value,
        afterEvidence.value,
        manifestSha256,
        { format: 'react-preview-campaign-phase-ledger/v1', entries: ledgerEntries },
        { baseline: baselineEvidence.digest, after: afterEvidence.digest },
      );
      process.stdout.write(
        `${JSON.stringify({ afterFatalCount: value.afterFatalCount, baselineFatalCount: value.baselineFatalCount })}\n`,
      );
    } else if (command === 'manual')
      throw new Error('Focus-dependent campaign control is unsupported.');
    else throw new Error('Usage: run-preview-blocker-campaign <manifest|run|record|compare> ...');
  } catch (error) {
    fail(error);
  }
