/** Source admission follows caller priority while raw reads remain concurrent and phase caps stay intact. */
import assert from 'node:assert/strict';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import {
  createPreviewInspectorFastSourceReaders,
  type PreviewInspectorFastSourceReaders,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorFastSourceReaders';

const MEBIBYTE = 1024 * 1024;
const FIRST = '/virtual/admission/first.tsx';
const SECOND = '/virtual/admission/second.tsx';

/** Provides controlled completion without real disk delays or wall-clock assertions. */
function createSourceGate(): {
  readonly promise: Promise<string | undefined>;
  readonly resolve: (value: string | undefined) => void;
  readonly reject: (reason: unknown) => void;
} {
  let fulfill: ((value: string | undefined) => void) | undefined;
  let fail: ((reason: unknown) => void) | undefined;
  const promise = new Promise<string | undefined>((resolve, reject) => {
    fulfill = resolve;
    fail = reject;
  });
  return {
    promise,
    resolve: (value) => {
      assert(fulfill);
      fulfill(value);
    },
    reject: (reason) => {
      assert(fail);
      fail(reason);
    },
  };
}

const LANES: readonly {
  readonly lane: keyof PreviewInspectorFastSourceReaders;
  readonly sourceBytes: number;
}[] = [
  { lane: 'entry', sourceBytes: 1.5 * MEBIBYTE },
  { lane: 'forward', sourceBytes: 4 * MEBIBYTE },
  { lane: 'reverse', sourceBytes: 4 * MEBIBYTE },
  { lane: 'subtree', sourceBytes: 1.5 * MEBIBYTE },
];

for (const finishSecondFirst of [false, true]) {
  it.each(LANES)(
    `keeps the first requested $lane source when finishSecondFirst=${String(finishSecondFirst)}`,
    async ({ lane, sourceBytes }) => {
      const first = createSourceGate();
      const second = createSourceGate();
      const readSource = vi.fn((sourcePath: string) =>
        sourcePath === FIRST ? first.promise : second.promise,
      );
      const readers = createPreviewInspectorFastSourceReaders(readSource);
      const firstText = 'a'.repeat(sourceBytes);
      const secondText = 'b'.repeat(sourceBytes);
      const requested = [readers[lane](FIRST), readers[lane](SECOND)];
      expect(readSource.mock.calls).toEqual([[FIRST], [SECOND]]);
      if (finishSecondFirst) {
        second.resolve(secondText);
        await yieldTurn();
        first.resolve(firstText);
      } else {
        first.resolve(firstText);
        await yieldTurn();
        second.resolve(secondText);
      }
      expect(await Promise.all(requested)).toEqual([firstText, undefined]);
    },
  );
}

it('shares duplicate pending paths and charges one source once across lanes', async () => {
  const first = createSourceGate();
  const second = createSourceGate();
  const readSource = vi.fn((sourcePath: string) =>
    sourcePath === FIRST ? first.promise : second.promise,
  );
  const readers = createPreviewInspectorFastSourceReaders(readSource);
  const text = 'a'.repeat(4 * MEBIBYTE);
  const requested = [readers.reverse(FIRST), readers.reverse(FIRST), readers.reverse(SECOND)];
  second.resolve('b'.repeat(4 * MEBIBYTE));
  await yieldTurn();
  first.resolve(text);
  expect(await Promise.all(requested)).toEqual([text, text, undefined]);
  expect(await readers.entry(FIRST)).toBe(text);
  expect(readSource.mock.calls).toEqual([[FIRST], [SECOND]]);
});

it('propagates an early raw rejection without letting later admissions pass a pending predecessor', async () => {
  const first = createSourceGate();
  const failed = createSourceGate();
  const third = createSourceGate();
  const failure = new Error('fixture read failed');
  const readers = createPreviewInspectorFastSourceReaders((sourcePath) => {
    if (sourcePath === FIRST) return first.promise;
    return sourcePath === SECOND ? failed.promise : third.promise;
  });
  const text = 'a'.repeat(4 * MEBIBYTE);
  const requested = Promise.allSettled([
    readers.reverse(FIRST),
    readers.reverse(SECOND),
    readers.reverse('/virtual/admission/third.tsx'),
  ]);
  failed.reject(failure);
  third.resolve('c'.repeat(4 * MEBIBYTE));
  await yieldTurn();
  first.resolve(text);
  expect(await requested).toEqual([
    { status: 'fulfilled', value: text },
    { status: 'rejected', reason: failure },
    { status: 'fulfilled', value: undefined },
  ]);
});

it('reports a raw read error without waiting for an unrelated earlier source', async () => {
  const first = createSourceGate();
  const failed = createSourceGate();
  const failure = new Error('fixture immediate read failure');
  const readers = createPreviewInspectorFastSourceReaders((sourcePath) =>
    sourcePath === FIRST ? first.promise : failed.promise,
  );
  const earlier = readers.reverse(FIRST);
  let observed = false;
  const rejected = readers.reverse(SECOND).catch((error: unknown) => {
    expect(error).toBe(failure);
    observed = true;
  });
  failed.reject(failure);
  await yieldTurn();
  try {
    expect(observed).toBe(true);
  } finally {
    first.resolve('first');
    await Promise.all([earlier, rejected]);
  }
});

it('keeps shared-source accounting stable when lanes have overlapping requests', async () => {
  const gates = new Map([
    ['first', createSourceGate()],
    ['shared', createSourceGate()],
    ['last', createSourceGate()],
  ]);
  const readers = createPreviewInspectorFastSourceReaders((sourcePath) => {
    const gate = gates.get(sourcePath.split('/').at(-1) ?? '');
    assert(gate);
    return gate.promise;
  });
  const text = 'a'.repeat(4 * MEBIBYTE);
  const requested = [
    readers.reverse('/virtual/first'),
    readers.reverse('/virtual/shared'),
    readers.forward('/virtual/shared'),
    readers.forward('/virtual/last'),
  ];
  gates.get('last')?.resolve(text);
  gates.get('shared')?.resolve(text);
  await yieldTurn();
  gates.get('first')?.resolve(text);
  expect(await Promise.all(requested)).toEqual([text, undefined, text, undefined]);
});

it('keeps admitted text available while an unrelated new source is pending', async () => {
  const pending = createSourceGate();
  const text = 'a'.repeat(4 * MEBIBYTE);
  const readers = createPreviewInspectorFastSourceReaders((sourcePath) =>
    sourcePath === FIRST ? Promise.resolve(text) : pending.promise,
  );
  expect(await readers.forward(FIRST)).toBe(text);
  const later = readers.reverse(SECOND);
  let available = false;
  const alreadyAdmitted = readers.entry(FIRST).then((value) => {
    expect(value).toBe(text);
    available = true;
  });
  await yieldTurn();
  try {
    expect(available).toBe(true);
  } finally {
    pending.resolve('b');
    await Promise.all([later, alreadyAdmitted]);
  }
});

it('charges UTF-8 bytes in priority order rather than counting characters', async () => {
  const first = createSourceGate();
  const second = createSourceGate();
  const readers = createPreviewInspectorFastSourceReaders((sourcePath) =>
    sourcePath === FIRST ? first.promise : second.promise,
  );
  const text = '가'.repeat(400_000);
  const requested = [readers.entry(FIRST), readers.entry(SECOND)];
  second.resolve('나'.repeat(400_000));
  await yieldTurn();
  first.resolve(text);
  expect(await Promise.all(requested)).toEqual([text, undefined]);
});
