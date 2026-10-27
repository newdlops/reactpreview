/** Keeps inert callback wrappers from erasing the exact injected Route-slot identity. */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewInspectorRouteFactoryEvidence,
  type PreviewInspectorRouteFactoryEvidence,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorRouteFactory';

const BODY =
  '<Layout><Routes>{own}{nested}<Route path="*" element={<NotFound />} /></Routes></Layout>';
const CALLBACK = `({ entries: own, branches: nested }) => ${BODY}`;
const DECOY = '({ other: decoy }) => <Routes>{decoy}</Routes>';

/** One inert source snapshot and the exact factory evidence collected from it. */
interface CallbackFixture {
  /** Factory owner metadata, without importing or evaluating the source snapshot. */
  readonly evidence: PreviewInspectorRouteFactoryEvidence;
  /** Original UTF-16 source used to validate JSX occurrence offsets after unwrapping. */
  readonly sourceText: string;
}

/** Parses only fixture syntax; opaque callbacks and their potential side effects stay unexecuted. */
function collect(callback: string, trailingCallback?: string, preamble = ''): CallbackFixture {
  const sourceText = `${preamble}\nexport const FeatureApp = createFeatureModule('/feature', { ListPage }, [NestedApp], ${callback}${trailingCallback === undefined ? '' : `, ${trailingCallback}`});`;
  const sourceFile = ts.createSourceFile(
    '/workspace/feature-app.tsx',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const evidence = collectPreviewInspectorRouteFactoryEvidence(sourceFile).find(
    (item) => item.componentName === 'FeatureApp',
  );
  if (evidence === undefined) throw new Error('The fixture must retain its outer factory owner.');
  return { evidence, sourceText };
}

/** Asserts original alias identities and offsets rather than the wrapper's normalized spelling. */
function expectOriginalSlots(fixture: CallbackFixture): void {
  expect(fixture.evidence).toMatchObject({
    basePath: '/feature',
    componentName: 'FeatureApp',
    hasWildcardFallback: true,
  });
  expect(
    fixture.evidence.routeSlots.map(({ localName, propertyName }) => ({
      localName,
      propertyName,
    })),
  ).toEqual([
    { localName: 'own', propertyName: 'entries' },
    { localName: 'nested', propertyName: 'branches' },
  ]);
  for (const slot of fixture.evidence.routeSlots) {
    expect(
      fixture.sourceText.slice(
        slot.occurrenceStart,
        slot.occurrenceStart + slot.localName.length + 2,
      ),
    ).toBe(`{${slot.localName}}`);
  }
  expect(Object.isFrozen(fixture.evidence.routeSlots)).toBe(true);
  expect(fixture.evidence.choices.map((choice) => choice.componentName)).toEqual([
    'ListPage',
    'NestedApp',
  ]);
}

describe('route-factory callbacks inside inert expression wrappers', () => {
  it.each([
    ['parenthesized arrow', `(${CALLBACK})`],
    ['nested parentheses', `(((${CALLBACK})))`],
    ['type assertion', `((${CALLBACK}) as Wrapper)`],
    ['satisfies expression', `((${CALLBACK}) satisfies Wrapper)`],
    ['non-null expression', `(${CALLBACK})!`],
    ['mixed inert wrappers', `(((${CALLBACK}) satisfies Wrapper) as Wrapper)!`],
    [
      'parenthesized function',
      `(function ({ entries: own, branches: nested }) { return ${BODY}; })`,
    ],
  ])('preserves the returned contract for a %s', (_label, callback) => {
    expectOriginalSlots(collect(callback));
  });

  it('uses the first wrapped callback before an unrelated later inline callback', () => {
    expectOriginalSlots(collect(`(${CALLBACK}) satisfies Wrapper`, DECOY));
  });

  it('keeps a bare first callback ahead of a later wrapped callback', () => {
    expectOriginalSlots(collect(CALLBACK, `(${DECOY}) satisfies Wrapper`));
  });

  it('retains a wrapped fallback-only callback without inventing parameter slots', () => {
    const fixture = collect('(() => <Routes><Route path="*" element={<NotFound />} /></Routes>)');
    expect(fixture.evidence.routeSlots).toEqual([]);
    expect(fixture.evidence.hasWildcardFallback).toBe(true);
  });

  it.each([
    ['higher-order call', `decorate(${CALLBACK})`, ''],
    ['identifier alias', 'callback', `const callback = ${CALLBACK};`],
    ['conditional expression', `(ready ? (${CALLBACK}) : (${DECOY}))`, ''],
    ['comma expression', `(observe(), (${CALLBACK}))`, ''],
  ])('leaves a %s unproved', (_label, callback, preamble) => {
    const fixture = collect(callback, undefined, preamble);
    expect(fixture.evidence.routeSlots).toEqual([]);
    expect(fixture.evidence.hasWildcardFallback).toBe(false);
    expect(fixture.evidence.choices.map((choice) => choice.componentName)).toEqual([
      'ListPage',
      'NestedApp',
    ]);
  });
});
