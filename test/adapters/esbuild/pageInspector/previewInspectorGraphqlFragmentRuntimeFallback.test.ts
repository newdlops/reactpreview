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

  /** A compile-time Context placeholder is not marked by the runtime fallback WeakSet. */
  it('repairs an unmarked Context list when fragment usage proves a named object root', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      id: 'unread-owner-menubar-fragment',
      hookName: 'getFragmentData',
      requiredPaths: ['warnings', 'warnings.some()', 'warnings.filter()', 'warnings[].isStaffOnly'],
    };
    const contextCompany = Object.freeze([
      Object.freeze({ id: 'context-company' }),
    ]);

    const resolved = fixture.api.resolveFragment(
      () => contextCompany,
      () => ({
        definitions: [{ kind: 'FragmentDefinition', name: { value: 'OwnerMenubar' } }],
      }),
      () => Object.freeze({}),
      metadata,
    ) as { id: string; warnings: { isStaffOnly: boolean }[] };

    expect(resolved.id).toBe('context-company');
    expect(Array.isArray(resolved.warnings)).toBe(true);
    expect(() => resolved.warnings.some(({ isStaffOnly }) => !isStaffOnly)).not.toThrow();
    expect(fixture.api.read()).toEqual([
      expect.objectContaining({
        hookName: 'getFragmentData',
        requiredPaths: expect.arrayContaining(['warnings.some()']),
      }),
    ]);
  });

  it('preserves authored and compiler-proven fragment lists outside the named-root repair', () => {
    const contextList = Object.freeze([Object.freeze({ id: 'context-company' })]);
    const document = () => ({
      definitions: [{ kind: 'FragmentDefinition', name: { value: 'CompanyRow' } }],
    });
    const autoOff = createRuntimeFallbackFixture(false);
    const disabledResult = autoOff.api.resolveFragment(
      () => contextList,
      document,
      () => Object.freeze({}),
      {
        ...createMetadata(),
        id: 'disabled-named-fragment',
        requiredPaths: ['warnings.some()'],
      },
    );
    const listContract = createRuntimeFallbackFixture(true);
    const listResult = listContract.api.resolveFragment(
      () => contextList,
      document,
      () => Object.freeze([]),
      {
        ...createMetadata(),
        id: 'fragment-list-contract',
        requiredPaths: ['[].id'],
      },
    );

    expect(disabledResult).toBe(contextList);
    expect(listResult).toBe(contextList);
  });
});
