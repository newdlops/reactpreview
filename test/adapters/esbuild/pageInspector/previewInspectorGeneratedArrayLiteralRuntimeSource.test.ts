/** Exercises declared array-member consistency without replacing genuine or manual selections. */
import { describe, expect, it, vi } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

/** Exposes the production merger for evidence/descriptor cases outside the hook metadata normalizer. */
function createCompletion(): (
  authored: unknown,
  generated: unknown,
  options: object,
) => {
  readonly changed: boolean;
  readonly paths: readonly string[];
  readonly value: unknown;
} {
  return createRuntimeFallbackFixture(true).evaluate(
    'completePreviewInspectorGeneratedValue',
  ) as ReturnType<typeof createCompletion>;
}

const options = {
  repairLiteralArrays: true,
  requiredPaths: ['selectionCodes.[]'],
  typedLiterals: { 'selectionCodes[]': ['registered', 'resolved'] },
};

describe('declared generated array members', () => {
  it('repairs a generated field-label item to an allowed member through the real hook boundary', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const callback = vi.fn();
    const pattern = /keep/u;
    const authored = Object.freeze({
      selectionCodes: Object.freeze(['Selection codes']),
      callback,
      pattern,
    });
    const createFallback = vi.fn(() => ({ selectionCodes: ['registered'] }));
    const metadata = {
      ...createMetadata(),
      ...options,
      typedValue: { selectionCodes: ['registered'] },
    };
    const result = fixture.api.resolve(() => authored, createFallback, metadata) as typeof authored;

    expect(result.selectionCodes).toEqual(['registered']);
    expect(
      result.selectionCodes.every((value) =>
        options.typedLiterals['selectionCodes[]'].includes(value),
      ),
    ).toBe(true);
    expect(authored.selectionCodes).toEqual(['Selection codes']);
    expect(result.callback).toBe(callback);
    expect(result.pattern).toBe(pattern);
    expect(fixture.api.read()[0]).toMatchObject({
      reason: 'partial',
      generatedPaths: ['selectionCodes.0'],
    });
    expect(fixture.api.resolve(() => authored, createFallback, metadata)).toBe(result);
    expect(createFallback).toHaveBeenCalledTimes(1);
  });

  it.each(['registered', 'server-custom', 'User selected value'])(
    'preserves the authored member %s',
    (value) => {
      const authored = { selectionCodes: [value] };
      expect(
        createCompletion()(authored, { selectionCodes: ['registered'] }, options),
      ).toMatchObject({ changed: false, value: authored });
    },
  );

  it.each([
    ['no declared literals', { repairLiteralArrays: true, requiredPaths: options.requiredPaths }],
    ['no exact item demand', { ...options, requiredPaths: ['selectionCodes'] }],
    ['different literal path', { ...options, typedLiterals: { 'otherCodes[]': ['registered'] } }],
    ['empty allowed list', { ...options, typedLiterals: { 'selectionCodes[]': [] } }],
  ])('does not replace a field-label item with %s', (_label, evidence) => {
    const authored = { selectionCodes: ['Selection codes'] };
    const result = createCompletion()(authored, { selectionCodes: ['registered'] }, evidence);
    expect(result.changed).toBe(false);
    expect(result.value).toBe(authored);
  });

  it('rejects a generated replacement outside the declared set', () => {
    const authored = { selectionCodes: ['Selection codes'] };
    expect(createCompletion()(authored, { selectionCodes: ['unknown'] }, options).value).toBe(
      authored,
    );
  });

  it('uses nested collection field names while retaining unrelated row identity', () => {
    const sibling = { title: 'authored' };
    const authored = { groups: [{ optionTypes: ['Option types'], sibling }] };
    const result = createCompletion()(
      authored,
      { groups: [{ optionTypes: ['enabled'] }] },
      {
        repairLiteralArrays: true,
        requiredPaths: ['groups.[].optionTypes[]'],
        typedLiterals: { 'groups[].optionTypes[]': ['enabled', 'disabled'] },
      },
    ).value as typeof authored;
    expect(result.groups[0]?.optionTypes).toEqual(['enabled']);
    expect(result.groups[0]?.sibling).toBe(sibling);
    expect(authored.groups[0]?.optionTypes).toEqual(['Option types']);
  });

  it('does not execute a literal-table getter', () => {
    const read = vi.fn(() => ['registered']);
    const typedLiterals = Object.defineProperty({}, 'selectionCodes[]', { get: read });
    const authored = { selectionCodes: ['Selection codes'] };
    expect(
      createCompletion()(
        authored,
        { selectionCodes: ['registered'] },
        { ...options, typedLiterals },
      ).value,
    ).toBe(authored);
    expect(read).not.toHaveBeenCalled();
  });

  it('shares one unchanged source array across typed and untyped consumers', () => {
    const complete = createCompletion();
    const selectionCodes = Object.freeze(['Selection codes']);
    const first = complete({ selectionCodes }, { selectionCodes: ['registered'] }, options);
    const second = complete(
      { selectionCodes },
      { selectionCodes: ['resolved', 'registered'] },
      options,
    );
    const untyped = complete(
      { selectionCodes },
      { selectionCodes: [{ id: 1 }] },
      {
        repairLiteralArrays: true,
        requiredPaths: options.requiredPaths,
      },
    );
    const repaired = (first.value as { selectionCodes: readonly string[] }).selectionCodes;
    expect(repaired).toEqual(['registered']);
    expect(Object.isFrozen(repaired)).toBe(true);
    expect((second.value as { selectionCodes: unknown }).selectionCodes).toBe(repaired);
    expect((untyped.value as { selectionCodes: unknown }).selectionCodes).toBe(repaired);
    expect(second.paths).toEqual(['selectionCodes.0']);
  });

  it('retains the selection count when another consumer generates more members', () => {
    const complete = createCompletion();
    const authored = { selectionCodes: ['registered'] };
    expect(
      complete(authored, { selectionCodes: ['resolved', 'registered'] }, options),
    ).toMatchObject({
      changed: false,
      value: authored,
    });
  });

  it('preserves a repaired array subsequently handed down by its Provider', () => {
    const complete = createCompletion();
    const first = complete(
      { selectionCodes: Object.freeze(['Selection codes']) },
      { selectionCodes: ['registered'] },
      options,
    ).value as { selectionCodes: readonly string[] };
    const next = complete(
      first,
      { selectionCodes: [{ id: 1 }, { id: 2 }] },
      {
        repairLiteralArrays: true,
        requiredPaths: options.requiredPaths,
      },
    );
    expect(next.changed).toBe(false);
    expect((next.value as typeof first).selectionCodes).toBe(first.selectionCodes);
    expect(first.selectionCodes).toEqual(['registered']);
  });

  it('invalidates a retained repair after an in-place authored change', () => {
    const complete = createCompletion();
    const selectionCodes = ['Selection codes'];
    complete({ selectionCodes }, { selectionCodes: ['registered'] }, options);
    selectionCodes[0] = 'resolved';
    const result = complete({ selectionCodes }, { selectionCodes: ['registered'] }, options);
    expect(result.changed).toBe(false);
    expect((result.value as { selectionCodes: unknown }).selectionCodes).toBe(selectionCodes);
  });

  it('does not borrow a repair under conflicting literal evidence', () => {
    const complete = createCompletion();
    const selectionCodes = ['Selection codes'];
    complete({ selectionCodes }, { selectionCodes: ['registered'] }, options);
    const result = complete(
      { selectionCodes },
      { selectionCodes: ['different'] },
      {
        ...options,
        typedLiterals: { 'selectionCodes[]': ['different'] },
      },
    );
    expect((result.value as { selectionCodes: unknown }).selectionCodes).toBe(selectionCodes);
  });

  it('still fills a concrete missing index explicitly required by the consumer', () => {
    const result = createCompletion()(
      { selectionCodes: ['registered'] },
      { selectionCodes: ['registered', 'resolved'] },
      { ...options, requiredPaths: ['selectionCodes.[]', 'selectionCodes[1]'] },
    );
    expect((result.value as { selectionCodes: unknown }).selectionCodes).toEqual([
      'registered',
      'resolved',
    ]);
  });

  it('preserves manual array values and the disabled automatic-value mode', () => {
    const metadata = {
      ...createMetadata(),
      id: 'manual-array',
      ...options,
      typedValue: { selectionCodes: ['registered'] },
    };
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.resolve(
      () => undefined,
      () => ({ selectionCodes: ['registered'] }),
      metadata,
    );
    fixture.api.set(metadata.id, { selectionCodes: ['Selection codes'] });
    expect(
      fixture.api.resolve(
        () => undefined,
        () => ({}),
        metadata,
      ),
    ).toEqual({ selectionCodes: ['Selection codes'] });
    expect(fixture.api.read()[0]?.mode).toBe('manual');
    const authored = { selectionCodes: ['Selection codes'] };
    expect(
      createRuntimeFallbackFixture(false).api.resolve(
        () => authored,
        () => ({ selectionCodes: ['registered'] }),
        metadata,
      ),
    ).toBe(authored);
  });
});
