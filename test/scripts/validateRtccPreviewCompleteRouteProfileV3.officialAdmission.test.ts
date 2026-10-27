/** Covers officialAdmission behavior for validateRtccPreviewCompleteRouteProfileV3. */
/** Verifies authored-source validateRtccPreviewCompleteRouteProfileV3 invariants. */
import './rtccReconstructedSetup';
import { rmSync } from 'node:fs';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { readReconstructedFile } from '../support/rtccReconstructedArchive';

import {
  assertGateSchema,
  buildValidatorGate,
  persistOfficialArtifacts,
  preflightOfficialRun,
} from '../../scripts/validation/rtcc-v3-official-artifacts.mjs';

import {
  isolatedTemp,
  officialArgs,
  officialBody,
  outputNames,
  preparedPreflight,
  projectRoot,
  temporaryDirectories,
} from './validateRtccPreviewCompleteRouteProfileV3Fixtures';

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

describe('complete-route profile v3', () => {
  it('builds a canonical placeholder-free gate in memory only after recorded Sol PASS', () => {
    const writes: unknown[][] = [];
    const result = buildValidatorGate({
      cwd: projectRoot,
      readFile: readReconstructedFile,
      preOfficialSolReview: { status: 'PASS', recordedAt: '2026-08-01T00:00:00.000Z' },
      writeFile: (...args: unknown[]) => {
        writes.push(args);
      },
    });
    expect(result.bytes.endsWith('\n')).toBe(true);
    expect(result.bytes).not.toMatch(/<[^>]+>/);
    expect(result.gate.command.fixedArgumentPrefix).toEqual(officialArgs('x').slice(0, 4));
    expect(result.gate.command.finalArgumentRelation).toBe(
      'final argument equals SHA-256 of raw gate bytes',
    );
    expect(assertGateSchema(result.gate, { bindings: result.gate.bindings })).toBe(true);
    expect(writes).toHaveLength(1);
    expect(() =>
      buildValidatorGate({
        cwd: projectRoot,
        preOfficialSolReview: { status: 'FAIL', recordedAt: 'x' },
        writeFile: () => {
          // The rejected review must fail before this inert writer can be used.
        },
      }),
    ).toThrow();
  });

  it('rejects injectable gate, argv, binding, symlink, and reserved-output mutations', () => {
    const prepared = preparedPreflight();
    const options = prepared.options;
    expect(preflightOfficialRun(options).gateSha256).toBe(prepared.gate.sha256);
    expect(() =>
      preflightOfficialRun({ ...options, argv: [...prepared.argv.slice(0, 4), '0'.repeat(64)] }),
    ).toThrow();
    expect(() =>
      preflightOfficialRun({
        ...options,
        argv: [
          prepared.argv[0],
          prepared.argv[2],
          prepared.argv[1],
          prepared.argv[3],
          prepared.argv[4],
        ],
      }),
    ).toThrow();
    expect(() =>
      preflightOfficialRun({
        ...options,
        lstat: () => ({ isFile: () => true, isSymbolicLink: () => true }),
      }),
    ).toThrow();
    expect(() => preflightOfficialRun({ ...options, exists: () => true })).toThrow(
      'reserved-output-exists',
    );
    expect(() =>
      preflightOfficialRun({
        ...options,
        readFile: (path: string, encoding?: BufferEncoding) =>
          path.endsWith('rtccV3Fixture.ts')
            ? encoding
              ? 'altered'
              : Buffer.from('altered')
            : prepared.read(path, encoding),
      }),
    ).toThrow();
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'stops sequential wx writes at injected failure %i',
    (failureIndex) => {
      const prepared = preparedPreflight();
      const preflight = preflightOfficialRun(prepared.options);
      const body = officialBody();
      const writes: string[] = [];
      const paths = outputNames.map((name) => join(isolatedTemp('rtcc-v3-injected-'), name));
      expect(() =>
        persistOfficialArtifacts({
          paths,
          body,
          expectedExitCode: 1,
          gate: prepared.gate.gate,
          gateSha256: prepared.gate.sha256,
          moduleHashes: prepared.gate.gate.bindings,
          predecessors: preflight.predecessors,
          invocation: preflight.invocation,
          writeFile: (path: string) => {
            if (writes.length === failureIndex) throw new Error('injected');
            writes.push(path);
          },
        }),
      ).toThrow('injected');
      expect(writes).toHaveLength(failureIndex);
    },
  );
});
