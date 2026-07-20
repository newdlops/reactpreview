/** Verifies canonical hook-requirement identity independently from runtime fallback rendering. */
import { describe, expect, it } from 'vitest';
import { createRuntimeFallbackFixture } from './support/previewInspectorRuntimeFallbackFixture';

describe('Preview Inspector runtime fallback path signature', () => {
  /** Prevents equivalent property sets in a different discovery order from reopening Smart mode. */
  it('sorts required paths before creating the retained Smart signature', () => {
    const fixture = createRuntimeFallbackFixture(true);

    expect(fixture.api.pathSignature(['session.user.id', 'session.roles.0'])).toBe(
      fixture.api.pathSignature(['session.roles.0', 'session.user.id']),
    );
  });
});
