/** Verifies optional projector chains and where the Redux seed may add them. */
import { describe, expect, it } from 'vitest';
import { collectPreviewReduxAutomaticState } from '../../../../src/adapters/esbuild/previewReduxAutomaticState';
import { collectPreviewReselectStateRequirements } from '../../../../src/adapters/esbuild/staticResources/previewReselectStateContainerPaths';

const SOURCE_PATH = '/workspace/src/store/callBlock.slice.ts';

describe('optional Reselect projector chains', () => {
  /** Each chain keeps the receiver of its first `?.`; array-method receivers are collections. */
  it('collects read-only optional chains with their receiver prefix', () => {
    const requirements = collectPreviewReselectStateRequirements(
      SOURCE_PATH,
      [
        "import { createSelector } from '@reduxjs/toolkit';",
        'const callBlockState = (state) => state.callBlock.callBlock;',
        'export const selectAt = createSelector(callBlockState, ({ report }) =>',
        '  format(report?.dataAggregatedAt?.value));',
        'export const selectCount = createSelector(callBlockState, (value) =>',
        '  value.report?.cancelled?.rideCancelCount?.value);',
        'export const selectIds = createSelector(callBlockState, ({ report }) =>',
        '  report?.items?.map((item) => item?.id));',
        'export const selectFirst = createSelector(callBlockState, ({ report }) => report?.rows?.[0]);',
        'export const selectTotal = createSelector(callBlockState, ({ report }) => report.total.value);',
      ].join('\n'),
    );

    expect(requirements.optionalChainPaths).toEqual([
      { collection: true, path: ['callBlock', 'callBlock', 'report', 'items'], receiverLength: 3 },
      {
        path: ['callBlock', 'callBlock', 'report', 'dataAggregatedAt', 'value'],
        receiverLength: 3,
      },
      {
        path: ['callBlock', 'callBlock', 'report', 'cancelled', 'rideCancelCount', 'value'],
        receiverLength: 3,
      },
    ]);
  });

  /**
   * Optional leaves join the seed only below a receiver another selector already seeded, and only
   * counts, dates, and collections: text and flags stay with the project defaults and the fallback.
   */
  it('seeds optional leaves below an existing receiver with neutral and timestamp values', async () => {
    const source = [
      "import { createSelector } from '@reduxjs/toolkit';",
      'const callBlockState = (state) => state.callBlock;',
      'export const selectRate = createSelector(callBlockState, ({ report }) =>',
      '  report.dispatch.count.value / report.dispatch.total.value);',
      'export const selectAt = createSelector(callBlockState, ({ report }) =>',
      '  String(report?.dataAggregatedAt?.value));',
      'export const selectCancel = createSelector(callBlockState, ({ report }) =>',
      '  report?.rideCancelCount?.value);',
      'export const selectItems = createSelector(callBlockState, ({ report }) =>',
      '  report?.items?.length);',
      'export const selectKept = createSelector(callBlockState, ({ report }) =>',
      '  report?.dispatch?.total?.value);',
      'export const selectOther = createSelector(callBlockState, ({ other }) => other?.createdAt);',
      'export const selectStatus = createSelector(callBlockState, ({ report }) => ({',
      '  status: report?.callBanStatus?.currentStatus,',
      '  individual: report?.isIndividualBusiness,',
      '  started: report?.callBanStatus?.startedInfos.map((info) => info.id),',
      '}));',
    ].join('\n');
    const state = (await collectPreviewReduxAutomaticState({
      readSource: () => source,
      sourcePaths: [SOURCE_PATH],
    })) as { readonly callBlock: Record<string, unknown> };
    const report = state.callBlock.report as Record<string, unknown>;

    expect(report.dataAggregatedAt).toEqual({ value: Date.parse('2026-01-15T09:00:00.000Z') });
    expect(report.rideCancelCount).toEqual({ value: 0 });
    expect(report.items).toEqual([]);
    expect((report.dispatch as { total: unknown }).total).toEqual({ value: 1 });
    expect(state.callBlock.other).toBeUndefined();
    expect(report.callBanStatus).toEqual({ startedInfos: [] });
    expect(report).not.toHaveProperty('isIndividualBusiness');
  });
});
