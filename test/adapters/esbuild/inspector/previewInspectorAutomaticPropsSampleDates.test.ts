/** Verifies that typed sample dates in emitted automatic props land on the preview's current day. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorAutomaticPropsSampleDateStatements } from '../../../../src/adapters/esbuild/inspector/previewInspectorAutomaticPropsSampleDates';
import { createPreviewSampleDateApiExpression } from '../../../../src/adapters/esbuild/previewSampleDateRuntimeSource';

/** Runs the emitted statements against one descriptor with the day fixed to 2026-10-06. */
function rebase(descriptor: unknown): unknown {
  const source = [
    `${createPreviewSampleDateApiExpression()}.baseOverride = new Date(2026, 9, 6, 12);`,
    `const descriptor = ${JSON.stringify(descriptor)};`,
    ...createPreviewInspectorAutomaticPropsSampleDateStatements('descriptor'),
    'globalThis.__result = JSON.stringify(descriptor);',
  ].join('\n');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return JSON.parse(context.__result as string) as unknown;
}

describe('automatic props sample dates', () => {
  /** SimSheet's typed weeks showed January 15; authored text and other fields stay as emitted. */
  it('rebases canonical dates in candidate and target automatic props only', () => {
    expect(
      rebase({
        automaticProps: { at: '2026-01-15' },
        inspector: {
          pageCandidates: [
            {
              id: 'page',
              rootAutomaticProps: {
                label: 'Release 2026-01-15',
                weeks: { current: '2026-01-15', past: ['2026-01-15'] },
              },
              routeLocation: '2026-01-15',
              targetAutomaticProps: { stamp: '2026-01-15T09:00:00.000Z' },
            },
          ],
          targetAutomaticProps: { rows: [{ due: '2026-01-15', name: 'Name' }] },
        },
      }),
    ).toEqual({
      automaticProps: { at: '2026-01-15' },
      inspector: {
        pageCandidates: [
          {
            id: 'page',
            rootAutomaticProps: {
              label: 'Release 2026-01-15',
              weeks: { current: '2026-10-06', past: ['2026-10-06'] },
            },
            routeLocation: '2026-01-15',
            targetAutomaticProps: { stamp: '2026-10-06T09:00:00.000Z' },
          },
        ],
        targetAutomaticProps: { rows: [{ due: '2026-10-06', name: 'Name' }] },
      },
    });
  });

  /** Typed list items carry the canonical day minus their index and keep that order on screen. */
  it('rebases per-item canonical dates to the current day minus the item index', () => {
    expect(
      rebase({
        inspector: {
          targetAutomaticProps: {
            future: ['2026-01-15', '2026-01-14', '2026-01-13'],
            stamps: ['2026-01-14T09:00:00.000Z', '2026-01-06T09:00:00.000Z'],
            // Ten days back is outside the generated-list window and stays authored text.
            older: '2026-01-05',
          },
        },
      }),
    ).toEqual({
      inspector: {
        targetAutomaticProps: {
          future: ['2026-10-06', '2026-10-05', '2026-10-04'],
          stamps: ['2026-10-05T09:00:00.000Z', '2026-09-27T09:00:00.000Z'],
          older: '2026-01-05',
        },
      },
    });
  });

  /** Future-named typed lists carry later canonical days, which land after the current day. */
  it('rebases later canonical days to the days after today', () => {
    expect(
      rebase({
        inspector: {
          targetAutomaticProps: {
            future: ['2026-01-15', '2026-01-16', '2026-01-17'],
            stamp: '2026-01-24T09:00:00.000Z',
            later: '2026-01-25',
          },
        },
      }),
    ).toEqual({
      inspector: {
        targetAutomaticProps: {
          future: ['2026-10-06', '2026-10-07', '2026-10-08'],
          stamp: '2026-10-15T09:00:00.000Z',
          later: '2026-01-25',
        },
      },
    });
  });

  /** Year-less table days near the canonical day land on recent days in the same format. */
  it('rebases canonical month/day text to the current day', () => {
    expect(
      rebase({
        inspector: {
          targetAutomaticProps: {
            depleteMD: ['1/15', '1/14', '1/16'],
            padded: '01/13',
            far: '1/25',
            other: '3/4',
          },
        },
      }),
    ).toEqual({
      inspector: {
        targetAutomaticProps: {
          depleteMD: ['10/6', '10/5', '10/7'],
          padded: '10/04',
          far: '1/25',
          other: '3/4',
        },
      },
    });
  });
});
