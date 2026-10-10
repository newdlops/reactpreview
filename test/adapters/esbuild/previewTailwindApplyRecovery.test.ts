/** Verifies that one unknown `@apply` class no longer discards a whole Tailwind stylesheet. */
import { describe, expect, it } from 'vitest';
import {
  processPreviewTailwindWithApplyRecovery,
  removePreviewTailwindApplyClass,
} from '../../../src/adapters/esbuild/previewTailwindApplyRecovery';

describe('removePreviewTailwindApplyClass', () => {
  /** Keeps the other classes, `!important`, and both statement terminators. */
  it('removes one exact token from every @apply list', () => {
    const source = [
      '.a { @apply flex text-s400 p-2; }',
      '.b { @apply text-s400 font-bold !important; color: red; }',
      '.c { @apply text-s400 }',
      '.d { @apply text-s4000; }',
    ].join('\n');

    expect(removePreviewTailwindApplyClass(source, 'text-s400')).toBe(
      [
        '.a { @apply flex p-2; }',
        '.b { @apply font-bold !important; color: red; }',
        '.c { }',
        '.d { @apply text-s4000; }',
      ].join('\n'),
    );
  });
});

describe('processPreviewTailwindWithApplyRecovery', () => {
  /** Retries with the reported class removed for v3 and v4 error texts. */
  it('removes each reported unknown class until compilation succeeds', async () => {
    const attempts: string[] = [];
    const recovered = await processPreviewTailwindWithApplyRecovery(
      '.a { @apply flex text-s400 shadow-card; }',
      (source) => {
        attempts.push(source);
        if (source.includes('text-s400')) {
          return Promise.reject(
            new Error('The `text-s400` class does not exist. If `text-s400` is a custom class…'),
          );
        }
        if (source.includes('shadow-card')) {
          return Promise.reject(new Error('Cannot apply unknown utility class `shadow-card`'));
        }
        return Promise.resolve(`compiled:${source}`);
      },
    );

    expect(recovered).toEqual({
      removedClasses: ['text-s400', 'shadow-card'],
      result: 'compiled:.a { @apply flex; }',
    });
    expect(attempts).toHaveLength(3);
  });

  /** Leaves syntax and adapter failures to the caller's fail-soft path. */
  it('rethrows errors that do not name an unknown @apply class', async () => {
    const failure = new Error('Unexpected token at line 3');

    await expect(
      processPreviewTailwindWithApplyRecovery('.a { @apply flex; }', () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  /** Stops when the reported class is not in any @apply list, instead of looping. */
  it('rethrows when removing the reported class would not change the source', async () => {
    const failure = new Error('The `missing` class does not exist.');

    await expect(
      processPreviewTailwindWithApplyRecovery('.a { @apply flex; }', () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  /** Bounds the number of compilations for stylesheets with many unknown classes. */
  it('gives up after sixteen removed classes', async () => {
    const classes = Array.from({ length: 20 }, (_, index) => `missing-${String(index)}`);
    let attempts = 0;

    await expect(
      processPreviewTailwindWithApplyRecovery(`.a { @apply ${classes.join(' ')}; }`, (source) => {
        attempts += 1;
        const unknown = classes.find((className) => source.includes(`${className} `));
        const last = classes.find((className) => source.includes(`${className};`));
        return Promise.reject(new Error(`The \`${unknown ?? last ?? ''}\` class does not exist.`));
      }),
    ).rejects.toThrow('missing-16');
    expect(attempts).toBe(17);
  });
});
