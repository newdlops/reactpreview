import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorStableMinPriorityQueue } from '../../../../src/adapters/esbuild/inspector/previewInspectorStableMinPriorityQueue';

interface OracleEntry<Value> {
  readonly ordinal: number;
  readonly value: Value;
}

interface QueueValue {
  readonly id: string;
  readonly priority: number;
}

/** Independent stable array-sort reference used only to verify the heap dequeue sequence. */
function createStableOracle<Value>(
  initialValues: readonly Value[],
  compare: (left: Value, right: Value) => number,
): {
  readonly size: () => number;
  readonly push: (value: Value) => void;
  readonly popMinimum: () => Value | undefined;
} {
  let nextOrdinal = 0;
  const entries: OracleEntry<Value>[] = initialValues.map((value) => ({
    ordinal: nextOrdinal++,
    value,
  }));
  return {
    popMinimum(): Value | undefined {
      entries.sort((left, right) => {
        const compared = compare(left.value, right.value);
        return compared === 0 || Number.isNaN(compared) ? left.ordinal - right.ordinal : compared;
      });
      return entries.shift()?.value;
    },
    push(value: Value): void {
      entries.push({ ordinal: nextOrdinal++, value });
    },
    size: () => entries.length,
  };
}

describe('createPreviewInspectorStableMinPriorityQueue', () => {
  it('matches an independent stable oracle through interleaved pushes and removals', () => {
    const firstTie: QueueValue = Object.freeze({ id: 'first-tie', priority: 1 });
    const secondTie: QueueValue = Object.freeze({ id: 'second-tie', priority: 1 });
    const duplicate: QueueValue = Object.freeze({ id: 'duplicate', priority: 2 });
    const initial: readonly QueueValue[] = [
      Object.freeze({ id: 'late', priority: 3 }),
      firstTie,
      secondTie,
      duplicate,
      duplicate,
    ];
    const compare = (left: QueueValue, right: QueueValue): number => left.priority - right.priority;
    const queue = createPreviewInspectorStableMinPriorityQueue(initial, compare);
    const oracle = createStableOracle(initial, compare);
    const output: QueueValue[] = [];
    const pop = (): void => {
      expect(queue.size).toBe(oracle.size());
      const actual = queue.popMinimum();
      const expected = oracle.popMinimum();
      expect(actual).toBe(expected);
      if (actual !== undefined) output.push(actual);
      expect(queue.size).toBe(oracle.size());
    };
    const push = (value: QueueValue): void => {
      queue.push(value);
      oracle.push(value);
      expect(queue.size).toBe(oracle.size());
    };

    pop();
    push(Object.freeze({ id: 'new-minimum', priority: 0 }));
    pop();
    push(Object.freeze({ id: 'later-tie', priority: 1 }));
    while (queue.size > 0) pop();
    pop();

    expect(output.slice(0, 4).map(({ id }) => id)).toEqual([
      'first-tie',
      'new-minimum',
      'second-tie',
      'later-tie',
    ]);
    expect(output.filter((value) => value === duplicate)).toHaveLength(2);
    expect(output.every((value) => Object.isFrozen(value))).toBe(true);
    expect(Object.keys(firstTie)).toEqual(['id', 'priority']);
  });

  it('treats zero, negative zero, and NaN comparator results as stable ties', () => {
    const values = [{ id: 'initial-a' }, { id: 'initial-b' }, { id: 'pushed-c' }] as const;
    for (const tieResult of [0, -0, Number.NaN]) {
      const queue = createPreviewInspectorStableMinPriorityQueue(
        values.slice(0, 2),
        () => tieResult,
      );
      queue.push(values[2]);
      expect([queue.popMinimum(), queue.popMinimum(), queue.popMinimum()]).toEqual(values);
      expect(queue.size).toBe(0);
    }
  });

  it('uses explicit UTF-16 ordering for punctuation, case, composed text, and non-ASCII text', () => {
    const values = ['🙂', 'é', 'a', '中', 'A', 'e\u0301', '!'];
    const compare = (left: string, right: string): number =>
      left < right ? -1 : left > right ? 1 : 0;
    const queue = createPreviewInspectorStableMinPriorityQueue(values, compare);
    const output: string[] = [];
    while (queue.size > 0) {
      const minimum = queue.popMinimum();
      if (minimum === undefined) throw new Error('Expected one retained string.');
      output.push(minimum);
    }

    expect(output).toEqual(['!', 'A', 'a', 'e\u0301', 'é', '中', '🙂']);
  });

  it('handles empty and single-entry queues without cloning the value', () => {
    const value = { id: 'only' };
    const empty = createPreviewInspectorStableMinPriorityQueue<object>([], () => 0);
    expect(empty.size).toBe(0);
    expect(empty.popMinimum()).toBeUndefined();
    expect(empty.size).toBe(0);

    const single = createPreviewInspectorStableMinPriorityQueue([value], () => 0);
    expect(single.size).toBe(1);
    expect(single.popMinimum()).toBe(value);
    expect(single.size).toBe(0);
  });

  it('bounds the source-inventory directory frontier with exact UTF-16 heap ordering', () => {
    const directoryCount = 3_000;
    const directories = Array.from(
      { length: directoryCount },
      (_, index) => `/workspace/src/${String(directoryCount - index).padStart(4, '0')}-${index % 2 === 0 ? 'é' : '🙂'}`,
    );
    let comparisonCount = 0;
    const queue = createPreviewInspectorStableMinPriorityQueue(['/workspace'], (left, right) => {
      comparisonCount += 1;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    for (const directoryPath of directories) queue.push(directoryPath);
    const drainedDirectories: string[] = [];
    while (queue.size > 0) {
      const directoryPath = queue.popMinimum();
      if (directoryPath === undefined) throw new Error('Expected one retained directory.');
      drainedDirectories.push(directoryPath);
    }
    const totalDirectories = directoryCount + 1;
    expect(drainedDirectories).toEqual(['/workspace', ...directories.slice().sort()]);
    expect(comparisonCount).toBeLessThanOrEqual(
      4 * totalDirectories * Math.ceil(Math.log2(totalDirectories)),
    );

    const comparatorError = new Error('comparator failed');
    const errorQueue = createPreviewInspectorStableMinPriorityQueue([2], () => {
      throw comparatorError;
    });
    expect(() => {
      errorQueue.push(1);
    }).toThrow(comparatorError);

    const source = readFileSync(
      new URL(
        '../../../../src/adapters/esbuild/inspector/previewInspectorStableMinPriorityQueue.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).not.toMatch(/\.(?:sort|shift)\s*\(/u);

    const targetUsagePropsSource = readFileSync(
      new URL('../../../../src/adapters/esbuild/previewTargetUsageProps.ts', import.meta.url),
      'utf8',
    );
    const pendingDirectoriesStart = targetUsagePropsSource.indexOf('const pendingDirectories');
    const pendingDirectoriesEnd = targetUsagePropsSource.indexOf(
      '\n}\n\n/**',
      pendingDirectoriesStart,
    );
    const pendingDirectories = targetUsagePropsSource.slice(
      pendingDirectoriesStart,
      pendingDirectoriesEnd,
    );
    expect(pendingDirectories).toContain('createPreviewInspectorStableMinPriorityQueue');
    expect(pendingDirectories).toContain('pendingDirectories.popMinimum()');
    expect(pendingDirectories).toContain('pendingDirectories.push(entryPath)');
    expect(pendingDirectories).toContain('left < right ? -1 : left > right ? 1 : 0');
    expect(pendingDirectories).not.toMatch(/pendingDirectories\.(?:sort|shift)\s*\(/u);
  });
});
