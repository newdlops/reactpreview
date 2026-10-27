/** Covers renderState behavior for previewRuntimeHookInstrumentation. */
/** Verifies authored-source previewRuntimeHookInstrumentation invariants. */
import { describe, expect, it } from 'vitest';

import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

import { applyHookReplacements } from './previewRuntimeHookInstrumentationFixtures';

describe('createPreviewRuntimeHookReplacements', () => {
  /** Keeps failed selector state usable without triggering negative time sentinels or overlays. */
  it('uses optional selector paths and comparison-safe scalar defaults', () => {
    const source = [
      `import { useSelector } from 'react-redux';`,
      'export function Status() {',
      '  const driveStatus = useSelector(selectDriveStatus);',
      '  const pageLayoutState = useSelector(selectPageLayoutState);',
      '  const indicatorType = useSelector(selectIndicatorType);',
      '  const visible = pageLayoutState === State.Loading && indicatorType === Type.OVERLAY;',
      '  return <main data-visible={visible}>{driveStatus?.timeSeconds}{driveStatus?.day}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Status.tsx', source),
    );

    expect(transformed).toContain('"timeSeconds": 0');
    expect(transformed).toContain('"failurePaths":["timeSeconds","day"]');
    expect(transformed).toContain('() => ("Page layout state")');
    expect(transformed).toContain('() => ("Indicator type")');
    expect(transformed).not.toContain('() => (State.Loading)');
    expect(transformed).not.toContain('() => (Type.OVERLAY)');
  });

  /** Exposes authored visible states so the local residual can learn the useful discriminator. */
  it('emits ranked render-state candidates as target-guided Smart metadata', () => {
    const source = [
      `import { usePanel } from './panel-context';`,
      'export function Panel() {',
      '  const { state, currentWidth, close } = usePanel();',
      '  if (state.status === "closed" || state.status === "failed") return null;',
      '  return <aside style={{ width: currentWidth }}>',
      '    {state.status === "loading" && <Loader onCancel={close} />}',
      '    {(state.status === "open" || state.status === "closing") && (',
      '      <iframe src={state.iframeUrl} title="Panel" />',
      '    )}',
      '  </aside>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Panel.tsx', source),
    );

    expect(transformed).toContain(
      'path: "state.status", value: ("open"), deterministicRank: 0, role: "render-state"',
    );
    expect(transformed).toContain(
      'path: "state.status", value: ("loading"), deterministicRank: 1, role: "render-state"',
    );
    expect(transformed).toContain(
      'path: "state.status", value: ("closing"), deterministicRank: 2, role: "render-state"',
    );
    expect(transformed).toContain('path: "currentWidth"');
    expect(transformed).toContain('Number(globalThis.innerWidth)');
    expect(transformed).toContain(
      '"requiredPaths":["state.status","state.iframeUrl","currentWidth","close()"]',
    );
  });

  /** Keeps a visible query-loading return available as a reproducible time checkpoint. */
  it('emits a transient early-return state for a loading surface', () => {
    const source = [
      `import { useGetContentDetails } from './use-content-details';`,
      'export function DetailBottomSheetContent({ contentId }) {',
      '  const { data: contentData, status } = useGetContentDetails(contentId);',
      '  if (status === "pending") return <DetailBottomSheetSkeleton />;',
      '  if (status === "error") return <p>Failed</p>;',
      '  if (!contentData) return null;',
      '  return <article>{contentData.title}</article>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/DetailBottomSheetContent.tsx', source),
    );

    expect(transformed).toContain(
      'path: "status", value: ("pending"), deterministicRank: 0, role: "render-state"',
    );
    expect(transformed).not.toContain('path: "status", value: ("error"), deterministicRank:');
  });

  /** Recovers a page-state literal when a local render helper owns the selected JSX branch. */
  it('coordinates a derived completion gate before a descendant render branch', () => {
    const source = [
      `import { useSummary } from './use-summary';`,
      'export function Dashboard() {',
      '  const summaryHandle = useSummary();',
      '  const { status, summaryTree, requiresManagerConfirmation } = summaryHandle;',
      '  const hasCompletedSummary = status === "COMPLETED" && summaryTree != null;',
      '  if (hasCompletedSummary && requiresManagerConfirmation) return <Navigate />;',
      '  const renderBody = () => {',
      '    if (hasCompletedSummary) {',
      '      return <section><InfoMappingCard /><Summary tree={summaryTree} /></section>;',
      '    }',
      '    return <Intro />;',
      '  };',
      '  return <main>{renderBody()}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Dashboard.tsx', source),
    );

    expect(transformed).toContain('path: "status", value: ("COMPLETED")');
    expect(transformed).toContain('"requiresManagerConfirmation": false');
    expect(transformed).toContain(
      '"requiredPaths":["status","summaryTree","requiresManagerConfirmation"]',
    );
  });

  /** Marks a destructured selector count as non-negative when it feeds an Array length. */
  it('constrains destructured hook values used by a single-argument Array constructor', () => {
    const source = [
      `import { useSelector } from 'react-redux';`,
      'export function RideCancelCountGraph() {',
      '  const { rideCancelCount } = useSelector(selectCancelledRideConditionStatus);',
      '  const circles = new Array(Math.min(5, rideCancelCount)).fill(null);',
      '  return <main>{circles.length}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/RideCancelCountGraph.tsx', source),
    );

    expect(transformed).toContain('"rideCancelCount": 0');
    expect(transformed).toContain('"nonNegativeNumberPaths":["rideCancelCount"]');
    expect(transformed).toContain('"requiredPaths":["rideCancelCount"]');
  });

  /** Tags fire-and-forget hooks so their caught exceptions remain console warnings, not blockers. */
  it('marks ignored hook results as passive runtime isolation', () => {
    const source = [
      `import { usePageAnalytics } from './analytics';`,
      'export function Page() {',
      '  usePageAnalytics();',
      '  return <main />;',
      '}',
    ].join('\n');
    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source),
    );

    expect(transformed).toContain('"passive":true');
    expect(transformed).toContain('"requiredPaths":[]');
  });

  /** Completes optional descendants when another hard use proves that the fallback root must exist. */
  it('closes the optional property shape of a deterministically materialized hook value', () => {
    const source = [
      `import { useUrlSync } from './use-url-sync';`,
      'export function Table() {',
      '  const handler = useUrlSync();',
      '  if (handler) handler.updateUrl({ page: 1 });',
      '  return <span>{handler?.initialState.page ?? 1}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Table.tsx', source),
    );

    expect(transformed).toContain('"initialState": Object.freeze({ "page": 0 })');
    expect(transformed).toContain('"updateUrl": Object.freeze(() => undefined)');
    expect(transformed).toContain('"requiredPaths":["updateUrl()","initialState.page"]');
  });

  /** Follows a later object destructure so Redux-like selectors receive typed visual shell fields. */
  it('infers fields destructured after assigning the hook result', () => {
    const source = [
      `import { useSelector } from './use-selector';`,
      'export function Topbar() {',
      '  const company = useSelector((state) => state.company);',
      '  if (!company) return null;',
      '  const { shortName, name, subscription } = company;',
      '  return <header>{shortName}{name}{String(subscription)}</header>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Topbar.tsx', source),
    );

    expect(transformed).toContain('"shortName": "Short name"');
    expect(transformed).toContain('"name": "Name"');
    expect(transformed).toContain('"subscription": Object.freeze({})');
    expect(transformed).toContain('"requiredPaths":["shortName","name","subscription"]');
  });

  /** Shapes sample rows from callback reads so Auto values render content instead of an empty list. */
  it('infers array callback item fields for a visible sample-list preview', () => {
    const source = [
      `import { useEmployees } from './use-employees';`,
      'export function EmployeeList() {',
      '  const employees = useEmployees();',
      '  return employees.map((employee) => <div key={employee.id}>{employee.name} · {employee.email}</div>);',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/EmployeeList.tsx', source),
    );

    expect(transformed).toContain('react-file-preview.generated-list-runtime');
    expect(transformed).toContain('() => (Object.freeze({');
    expect(transformed).toContain('"email": "preview@example.invalid"');
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"name": "Name"');
    expect(transformed).toContain('"requiredPaths":["[].id","[].name","[].email"]');
  });

  /** Correlates package-owned table data with locally authored column and row callback contracts. */
  it('infers date-safe rows from sibling JSX table configuration', () => {
    const source = [
      `import usePatientCarePlans from './use-patient-care-plans';`,
      'export function CarePlanTable() {',
      '  const { data, status } = usePatientCarePlans("patient-id");',
      '  if (data === undefined || status === "loading") return null;',
      '  return <Table',
      '    getID={(row) => row.id}',
      '    data={data}',
      '    columns={[',
      '      { label: "Title", key: "title" },',
      '      { key: "startDate", formatter: (row) => format(new Date(row.startDate)) },',
      '      { key: "endDate", formatter: (row) => format(new Date(row.endDate)) },',
      '      { label: "Status", key: "status" },',
      '    ]}',
      '    actions={[{ label: "View", action: (row) => navigate(row.id) }]}',
      '  />;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/CarePlanTable.tsx', source),
    );

    expect(transformed).toContain('"endDate": "2026-01-15T09:00:00.000Z"');
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"startDate": "2026-01-15T09:00:00.000Z"');
    expect(transformed).toContain('"status": "PREVIEW"');
    expect(transformed).toContain('"title": "Title"');
    expect(transformed).toContain('data.[].startDate');
    expect(transformed).toContain('data.[].endDate');
  });

  /** Combines a nested query collection, sibling row config, and its empty-state guard. */
  it('materializes nested table rows and continues beyond a zero-count early return', () => {
    const source = [
      `import usePatients from './use-patients';`,
      'export function PatientsTable() {',
      '  const { data, status } = usePatients({ queryString: "" });',
      '  if (data === undefined || status === "loading") return <p>Loading</p>;',
      '  if (data.totalCount === 0) return <p>No patients</p>;',
      '  return <Table',
      '    data={data.patients}',
      '    getID={(row) => row.id}',
      '    columns={[',
      '      { key: "code" },',
      '      { key: "givenName" },',
      '      { key: "familyName" },',
      '      { key: "dateOfBirth", formatter: (row) => formatDate(row.dateOfBirth) },',
      '    ]}',
      '    actions={[{ label: "View", action: (row) => navigate(row.id) }]}',
      '  />;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/PatientsTable.tsx', source),
    );

    expect(transformed).toContain('"totalCount": 1');
    expect(transformed).toContain('"patients": ((__createPreviewItem)');
    expect(transformed).toContain('"code": "Code"');
    expect(transformed).toContain('"dateOfBirth": "2026-01-15T09:00:00.000Z"');
    expect(transformed).toContain('"givenName": "Given name"');
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"renderGuardPaths":["data.totalCount","status"]');
    expect(transformed).toContain('data.patients[].familyName');
  });

  /** Keeps ReactNode-style Context arrays renderable when their map callback returns each item. */
  it('infers a scalar item for an identity map that flows directly into React children', () => {
    const source = [
      `import { useButtons } from './button-toolbar-provider';`,
      'export function ButtonToolBar() {',
      '  const buttons = useButtons();',
      '  if (buttons.length === 0) return null;',
      '  return <div className="button-toolbar">{buttons.map((button) => button)}</div>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/ButtonToolBar.tsx', source),
    );

    expect(transformed).toContain('react-file-preview.generated-list-runtime');
    expect(transformed).toContain('() => ("Button")');
    expect(transformed).toContain('"requiredPaths":["[]"]');
    expect(transformed).not.toContain('Object.freeze({ id: "preview-id", name: "name" })');
  });

  /** Retains root collection demand through a value-choice alias instead of emitting an empty object. */
  it('infers an array root through a nullish or fallback alias', () => {
    const source = [
      `import { useRows } from './use-rows';`,
      'export function RowList() {',
      '  const response = useRows();',
      '  const data = response || {};',
      '  return data.map((row) => <span>{String(row)}</span>);',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/RowList.tsx', source),
    );

    expect(transformed).toContain('() => (Object.freeze([]))');
    expect(transformed).toContain('"requiredPaths":["map()"]');
  });
});
