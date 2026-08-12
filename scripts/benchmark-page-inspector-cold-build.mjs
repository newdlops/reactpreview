/** Runs isolated fixed-fixture Page Inspector cold builds and reports a median compile duration. */
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const arguments_ = process.argv.slice(2);
const sampleIndex = arguments_.indexOf('--samples');
const baselineIndex = arguments_.indexOf('--baseline-ms');
const targetIndex = arguments_.indexOf('--target');
const workspaceIndex = arguments_.indexOf('--workspace');
const cpuProfileDirectoryIndex = arguments_.indexOf('--cpu-profile-dir');
const samples = sampleIndex < 0 ? 9 : Number(arguments_[sampleIndex + 1]);
const baselineMs = baselineIndex < 0 ? undefined : Number(arguments_[baselineIndex + 1]);
const targetArgument = targetIndex < 0 ? undefined : arguments_[targetIndex + 1];
const workspaceArgument = workspaceIndex < 0 ? undefined : arguments_[workspaceIndex + 1];
const cpuProfileDirectoryArgument =
  cpuProfileDirectoryIndex < 0 ? undefined : arguments_[cpuProfileDirectoryIndex + 1];
const targetPath = targetArgument === undefined ? undefined : path.resolve(targetArgument);
const workspaceRoot = workspaceArgument === undefined ? undefined : path.resolve(workspaceArgument);
const cpuProfileDirectory =
  cpuProfileDirectoryArgument === undefined ? undefined : path.resolve(cpuProfileDirectoryArgument);
if (
  !Number.isInteger(samples) ||
  samples < 1 ||
  !Number.isFinite(baselineMs ?? 0) ||
  (targetPath === undefined) !== (workspaceRoot === undefined)
) {
  throw new Error(
    'Usage: node scripts/benchmark-page-inspector-cold-build.mjs --samples <positive integer> [--baseline-ms <number>] [--target <tsx> --workspace <root>] [--cpu-profile-dir <directory>]',
  );
}

if (cpuProfileDirectory !== undefined) await mkdir(cpuProfileDirectory, { recursive: true });

const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-cold-benchmark-'));
const runtimePath = path.join(runtimeRoot, 'fixture.cjs');
try {
  await build({
    bundle: true,
    entryPoints: [path.resolve('test/performance/pageInspectorColdBuildFixture.ts')],
    external: ['esbuild', 'typescript', 'vscode'],
    format: 'cjs',
    logLevel: 'silent',
    outfile: runtimePath,
    platform: 'node',
    sourcemap: false,
    target: 'node22',
  });
  const durations = [];
  const profiles = [];
  for (let index = 0; index < samples; index += 1) {
    const profile = await new Promise((resolve, reject) => {
      const invocation =
        targetPath === undefined
          ? `require(${JSON.stringify(runtimePath)}).runPageInspectorColdBuildFixture().then(value => process.stdout.write(JSON.stringify({ durationMs: value }))).catch(error => { process.stderr.write(error.stack || String(error)); process.exitCode = 1; });`
          : `require(${JSON.stringify(runtimePath)}).runPageInspectorTargetColdBuild(${JSON.stringify(targetPath)}, ${JSON.stringify(workspaceRoot)}).then(value => process.stdout.write(JSON.stringify(value))).catch(error => { process.stderr.write(error.stack || String(error)); process.exitCode = 1; });`;
      const wallStartedAt = performance.now();
      const childArguments = [
        ...(cpuProfileDirectory === undefined
          ? []
          : ['--cpu-prof', `--cpu-prof-dir=${cpuProfileDirectory}`]),
        '-e',
        invocation,
      ];
      const child = spawn(process.execPath, childArguments, {
        env: { ...process.env, NODE_PATH: path.resolve('node_modules') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) reject(new Error(stderr || `Cold sample ${index + 1} failed.`));
        else {
          const value = JSON.parse(stdout);
          if (!Number.isFinite(value.durationMs))
            reject(new Error(`Cold sample ${index + 1} emitted an invalid duration.`));
          else resolve({ ...value, wallDurationMs: performance.now() - wallStartedAt });
        }
      });
    });
    profiles.push(profile);
    durations.push(profile.durationMs);
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  process.stdout.write(`${JSON.stringify({ durationsMs: durations, medianMs, profiles })}\n`);
  if (baselineMs !== undefined && medianMs > baselineMs * 0.5) process.exitCode = 1;
} finally {
  await rm(runtimeRoot, { force: true, recursive: true });
}
