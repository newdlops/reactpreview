/** Verifies when the Redux seed may create an absent optional receiver such as an API result. */
import { describe, expect, it } from 'vitest';
import {
  collectPreviewReduxAutomaticState,
  collectPreviewReduxAutomaticStateParts,
} from '../../../src/adapters/esbuild/previewReduxAutomaticState';

const SLICE_PATH = '/workspace/src/store/driveReport.slice.ts';
const COMPONENT_PATH = '/workspace/src/pages/DriveStatus.tsx';

/** A slice whose API result is optional, absent from the initial state, and read only via `?.`. */
const SLICE_SOURCE = [
  "import { createSelector, createSlice } from '@reduxjs/toolkit';",
  'interface StateType { isReady: boolean; getDriveReportResult?: Report }',
  'const slice = createSlice({',
  "  name: 'driveReport',",
  '  initialState: { isReady: false } as StateType,',
  '  reducers: {',
  '    success: (state, action) => { state.getDriveReportResult = action.payload },',
  '  },',
  '});',
  'const driveReportState = (state) => state.driveReport;',
  'export const selectReady = createSelector(driveReportState, (state) => state.isReady);',
  'export const selectYearMonth = createSelector(driveReportState, (state) => ({',
  '  year: Initializer.number(state.getDriveReportResult?.currentYearMonth?.year),',
  '  month: Initializer.number(state.getDriveReportResult?.currentYearMonth?.month),',
  '}));',
  'export const selectScore = createSelector(driveReportState, (state) =>',
  '  Initializer.number(state.getDriveReportResult?.satisfactionStatus?.data?.satisfactionRate));',
].join('\n');

/**
 * Builds the seed for the slice plus one optional component source.
 *
 * @param componentSource Extra frontier source, or undefined for the slice alone.
 * @param extraSlice Extra selector lines appended to the slice.
 * @returns The `driveReport` slice of the generated state.
 */
async function seedDriveReport(
  componentSource?: string,
  extraSlice: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const sources = new Map<string, string>([[SLICE_PATH, [SLICE_SOURCE, ...extraSlice].join('\n')]]);
  if (componentSource !== undefined) sources.set(COMPONENT_PATH, componentSource);
  const state = (await collectPreviewReduxAutomaticState({
    readSource: (sourcePath) => sources.get(sourcePath),
    sourcePaths: [...sources.keys()],
  })) as { readonly driveReport?: Record<string, unknown> } | undefined;
  return state?.driveReport ?? {};
}

describe('absent optional Redux receivers', () => {
  /** The year/month selector sees the sample day instead of the project's `-1` sentinel. */
  it('creates an absent API result read only through optional chains', async () => {
    const report = (await seedDriveReport()).getDriveReportResult;

    expect(report).toEqual({
      currentYearMonth: { month: 1, year: 2026 },
      satisfactionStatus: { data: { satisfactionRate: 0 } },
    });
  });

  /** Anything that can branch on the receiver's existence keeps it absent. */
  it.each([
    ['a condition', 'if (state.driveReport.getDriveReportResult) render();'],
    ['a negation', 'const empty = !state.driveReport.getDriveReportResult;'],
    ['a null comparison', 'const empty = state.driveReport.getDriveReportResult == null;'],
    ['a ternary test', 'const view = report.getDriveReportResult ? 1 : 2;'],
    ['a logical operand', 'const view = report.getDriveReportResult && 1;'],
    ['a returned value', 'const read = (state) => state.driveReport.getDriveReportResult;'],
    ['an argument', 'track(state.driveReport.getDriveReportResult);'],
    ['a spread', 'const copy = { ...state.driveReport.getDriveReportResult };'],
    ['a typeof operand', 'const kind = typeof state.driveReport.getDriveReportResult;'],
    ['an in operand', "const has = 'year' in state.driveReport.getDriveReportResult;"],
    ['a destructuring', 'const { getDriveReportResult } = state.driveReport;'],
  ])('keeps the receiver absent when %s observes it', async (_label, line) => {
    const report = (await seedDriveReport(`export function DriveStatus() { ${line} }`))
      .getDriveReportResult;

    expect(report).toBeUndefined();
  });

  /** A container some selector returns whole may be tested by a component, so its chain is skipped. */
  it('skips chains through a returned container but keeps sibling chains', async () => {
    const report = (
      await seedDriveReport(undefined, [
        'export const selectTagStatus = createSelector(driveReportState, (state) =>',
        '  state.getDriveReportResult?.positiveTagStatus?.data);',
        'export const selectTagCount = createSelector(driveReportState, (state) =>',
        '  Initializer.number(state.getDriveReportResult?.positiveTagStatus?.data?.totalCount?.value));',
      ])
    ).getDriveReportResult as Record<string, unknown>;

    expect(report.currentYearMonth).toEqual({ month: 1, year: 2026 });
    expect(report).not.toHaveProperty('positiveTagStatus');
  });

  /** An application's own store is shown only the fields that absent-receiver chains created. */
  it('exposes only absent-receiver fields as the overlay for application stores', async () => {
    const parts = await collectPreviewReduxAutomaticStateParts({
      readSource: () => SLICE_SOURCE,
      sourcePaths: [SLICE_PATH],
    });

    expect(parts?.state.driveReport).toHaveProperty('isReady', false);
    expect(parts?.absentReceiverOverlay).toEqual({
      driveReport: {
        getDriveReportResult: {
          currentYearMonth: { month: 1, year: 2026 },
          satisfactionStatus: { data: { satisfactionRate: 0 } },
        },
      },
    });
  });

  /** Chains below a receiver other evidence already seeded leave the overlay empty. */
  it('leaves the overlay empty when every receiver already exists', async () => {
    const parts = await collectPreviewReduxAutomaticStateParts({
      readSource: () =>
        [
          SLICE_SOURCE,
          'export const selectSeeded = createSelector(driveReportState, (state) =>',
          '  state.getDriveReportResult.recentDuration);',
        ].join('\n'),
      sourcePaths: [SLICE_PATH],
    });

    expect(parts?.absentReceiverOverlay).toBeUndefined();
  });
});
