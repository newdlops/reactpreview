/** Verifies generated fragment values against the operations that consume them. */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

describe('Preview Inspector GraphQL fragment runtime fallback', () => {
  /** Repairs an upstream Auto container before an Array callback can observe the fragment value. */
  it('materializes a fragment collection and its callback item contract before project code', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'getFragmentData',
      requiredPaths: ['warnings', 'warnings.some()', 'warnings[].isStaffOnly'],
    };
    const upstream = fixture.api.resolve(
      () => undefined,
      () => Object.freeze({ company: Object.freeze([Object.freeze({ id: 'preview-company' })]) }),
      {
        ...createMetadata(),
        id: 'company-context',
        requiredPaths: ['company.[]'],
      },
    ) as { company: object[] };

    const resolved = fixture.api.resolveFragment(
      () => upstream.company,
      () => ({
        definitions: [{ kind: 'FragmentDefinition', name: { value: 'OwnerMenubar' } }],
      }),
      () => Object.freeze({}),
      metadata,
    ) as { warnings: { isStaffOnly: boolean }[] };

    expect(Array.isArray(upstream.company)).toBe(true);
    expect(resolved).toMatchObject({ id: 'preview-company' });
    expect(resolved.warnings).toEqual([{ id: 'preview-1', isStaffOnly: true, name: 'name' }]);
    expect(() => resolved.warnings.some(({ isStaffOnly }) => !isStaffOnly)).not.toThrow();
    expect(resolved.warnings.some(({ isStaffOnly }) => !isStaffOnly)).toBe(false);
  });
});
