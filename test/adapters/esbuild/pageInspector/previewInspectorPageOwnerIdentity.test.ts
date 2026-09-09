/** Prevents similarly named pages and loading shells from proving a different authored page. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageExecutionContextRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageExecutionContextRuntimeSource';

/** Evaluates the production identity matcher, including Unicode source names and bounded wrappers. */
function matches(expected: unknown, actual: unknown): unknown {
  return vm.runInNewContext(
    `${createPreviewInspectorPageExecutionContextRuntimeSource()}
      matchesPreviewInspectorPageExecutionOwnerName(expected, actual);`,
    { expected, actual },
    { timeout: 1_000 },
  );
}

describe('page owner identity', () => {
  it.each([
    ['UsersPage', 'ArchivedUsersPage'],
    ['UsersPage', 'UsersPageSkeleton'],
    ['UsersPageSkeleton', 'UsersPage'],
    ['PatientLayout', 'PatientLayoutError'],
    ['PatientLayout', 'OtherPatientLayout'],
    ['Page', 'OtherPage'],
    ['Memo', 'Memo(UsersPage)'],
    ['UsersPage', 'Memo(ArchivedUsersPage)'],
    ['UsersPage', 'Memo(UsersPage, ErrorPage)'],
    ['UsersPage', 'Memo(UsersPage)Error'],
    ['UsersPage', 'Memo(UsersPage'],
    ['', ''],
    [null, 'UsersPage'],
    ['UsersPage', 'Memo('.repeat(40) + 'UsersPage' + ')'.repeat(40)],
    ['환자페이지', '다른환자페이지'],
  ])('rejects a different identity %j / %j', (expected, actual) => {
    expect(matches(expected, actual)).toBe(false);
  });

  it.each([
    ['UsersPage', 'UsersPage'],
    ['PatientLayout', 'patient-layout'],
    ['UsersPage', 'Memo(UsersPage)'],
    ['UsersPage', 'ForwardRef(UsersPage)'],
    ['UsersPage', 'withRouter(Connect(UsersPage))'],
    ['Memo(UsersPage)', 'UsersPage'],
    ['Memo(UsersPage)', 'withRouter(UsersPage)'],
    ['UsersPage', 'React.memo( UsersPage )'],
    ['환자페이지', 'Memo(환자페이지)'],
  ])('preserves a delimited wrapper alias %j / %j', (expected, actual) => {
    expect(matches(expected, actual)).toBe(true);
  });
});
