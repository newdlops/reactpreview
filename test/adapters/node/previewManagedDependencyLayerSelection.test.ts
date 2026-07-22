/** Verifies that reproducible dependency layers cannot be hidden by locally observed package bytes. */
import { describe, expect, it } from 'vitest';
import {
  selectCompatiblePreviewManagedLayers,
  type PreviewManagedDependencyLayerCoverage,
} from '../../../src/adapters/node/previewManagedDependencyLayerSelection';
import type { PreviewManagedPackageIdentity } from '../../../src/adapters/node/previewManagedDependencyAdmission';

/** Concrete test descriptor retaining a readable label through generic layer selection. */
interface TestLayer {
  readonly coverage: PreviewManagedDependencyLayerCoverage;
  readonly label: string;
  readonly packages: readonly PreviewManagedPackageIdentity[];
}

describe('selectCompatiblePreviewManagedLayers', () => {
  /** A patched local install must not suppress the exact lockfile archive used by other projects. */
  it('keeps the lockfile layer and discards a conflicting reached layer', () => {
    const selected = selectCompatiblePreviewManagedLayers([
      layer('lock', 'lockfile', [pkg('alpha', 'official')]),
      layer('local-patch', 'reached', [pkg('alpha', 'patched')]),
    ]);

    expect(selected.map(({ label }) => label)).toEqual(['lock']);
  });

  /** Non-conflicting private packages remain reusable beside authoritative public packages. */
  it('keeps an unrelated reached layer beside a lockfile layer', () => {
    const selected = selectCompatiblePreviewManagedLayers([
      layer('lock', 'lockfile', [pkg('alpha', 'official')]),
      layer('private', 'reached', [pkg('private-ui', 'private')]),
    ]);

    expect(selected.map(({ label }) => label)).toEqual(['lock', 'private']);
  });

  /** Neither of two competing locally learned byte sets receives arbitrary precedence. */
  it('discards both conflicting reached layers', () => {
    const selected = selectCompatiblePreviewManagedLayers([
      layer('first', 'reached', [pkg('alpha', 'first')]),
      layer('second', 'reached', [pkg('alpha', 'second')]),
      layer('other', 'reached', [pkg('bravo', 'same')]),
    ]);

    expect(selected.map(({ label }) => label)).toEqual(['other']);
  });

  /** Project lock bytes replace a merely compatible bundled runtime at the same package slot. */
  it('prefers a lockfile layer over a conflicting bundled seed', () => {
    const selected = selectCompatiblePreviewManagedLayers([
      layer('bundled', 'bundled', [pkg('react', 'bundled')]),
      layer('locked', 'lockfile', [pkg('react', 'locked')]),
    ]);

    expect(selected.map(({ label }) => label)).toEqual(['locked']);
  });

  /** Competing exact lock evidence invalidates the complete environment rather than guessing. */
  it('fails closed for conflicting lockfile layers', () => {
    const selected = selectCompatiblePreviewManagedLayers([
      layer('first-lock', 'lockfile', [pkg('react', 'first')]),
      layer('second-lock', 'lockfile', [pkg('react', 'second')]),
    ]);

    expect(selected).toEqual([]);
  });
});

/** Creates one immutable test layer with its persisted evidence class. */
function layer(
  label: string,
  coverage: PreviewManagedDependencyLayerCoverage,
  packages: readonly PreviewManagedPackageIdentity[],
): TestLayer {
  return Object.freeze({ coverage, label, packages });
}

/** Creates a valid package identity while allowing tests to vary only its content digest. */
function pkg(name: string, contentDigest: string): PreviewManagedPackageIdentity {
  return Object.freeze({
    contentDigest,
    name,
    relativePath: name,
    version: '1.0.0',
  });
}
