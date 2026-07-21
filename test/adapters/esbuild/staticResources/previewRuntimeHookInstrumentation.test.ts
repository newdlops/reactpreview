/** Verifies syntax-only hook circuit breakers without executing project modules or React hooks. */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('createPreviewRuntimeHookReplacements', () => {
  /** Preserves the authored query default and substitutes only an inert setter after failure. */
  it('instruments use-query-params with a local render-only tuple', () => {
    const source = [
      `import { JsonParam, useQueryParam, withDefault } from 'use-query-params';`,
      'export function List({ variables }) {',
      '  const [filters, setFilters] = useQueryParam(',
      "    'where',",
      '    withDefault(JsonParam, variables?.where || {}),',
      '  );',
      '  return <button onClick={() => setFilters(filters)}>{Object.keys(filters).length}</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/List.tsx', source),
    );

    expect(transformed).toContain('.resolveRuntimeHook(');
    expect(transformed).toContain('() => (useQueryParam(');
    expect(transformed).toContain('variables?.where || {}');
    expect(transformed).toContain('Object.freeze(() => undefined)');
    expect(transformed).toContain('"hookName":"useQueryParam"');
    expect(transformed).toContain('"fallbackLabel":"static query value + no-op setter"');
    expect(transformed).toContain('"ownerName":"List"');
    expect(transformed).toContain('"requiredPaths":["0","1()"]');
  });

  /** Infers boolean and destructured object fields for project-alias custom hooks. */
  it('creates bounded static values from custom-hook bindings', () => {
    const source = [
      `import { useIsSuspendedSubscription, usePagePermissionCheck } from 'common/ui/hooks';`,
      'export function Page() {',
      '  const suspended = useIsSuspendedSubscription();',
      '  const { isStaffMode, userName, refresh } = usePagePermissionCheck();',
      '  return <main>{suspended ? "paused" : userName}<button onClick={refresh}>{String(isStaffMode)}</button></main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source),
    );

    expect(transformed.match(/\.resolveRuntimeHook\(/gu)).toHaveLength(2);
    expect(transformed).toContain('() => (false)');
    expect(transformed).toContain('"isStaffMode": false');
    expect(transformed).toContain('"userName": "userName"');
    expect(transformed).toContain('"refresh": Object.freeze(() => undefined)');
  });

  /** Retains named query fields and flattens properties proven through an object rest binding. */
  it('infers a settled query result from QueryRenderer object-rest destructuring', () => {
    const source = [
      `import { useQuery } from '../use-query';`,
      'export function QueryRenderer({ query, children, loader }) {',
      '  const { loading, data, ...result } = useQuery(query);',
      '  if (result.fallback) return result.fallback;',
      '  if (loading && !data) return loader;',
      '  if (!data) return null;',
      '  return children({ data, ...result });',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/QueryRenderer.tsx', source),
    );

    expect(transformed).toContain('"loading": false');
    expect(transformed).toContain('"data": Object.freeze({})');
    expect(transformed).toContain('...(');
    expect(transformed).toContain('"fallback": null');
    expect(transformed).toContain('"requiredPaths":["loading","data","fallback"]');
    expect(transformed).not.toContain('() => ("query")');
  });

  /** Keeps an aliased data property at its source query-result key beside flattened rest fields. */
  it('preserves source keys for aliased object-rest query bindings', () => {
    const source = [
      `import { useQuery } from '../use-query';`,
      'export function QueryRenderer({ query, children }) {',
      '  const { data: resultData, ...result } = useQuery(query);',
      '  if (!resultData || result.fallback) return null;',
      '  return children({ data: resultData, ...result });',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/QueryRenderer.tsx', source),
    );

    expect(transformed).toContain('"data": Object.freeze({})');
    expect(transformed).toContain('"fallback": null');
    expect(transformed).toContain('"requiredPaths":["data","fallback"]');
  });

  /** Uses the local result key instead of an arbitrary sentence for directly rendered hook text. */
  it('renders a direct generated scalar as its bounded binding key', () => {
    const source = [
      `import { useRemoteThing } from './use-remote-thing';`,
      'export function Badge() {',
      '  const badge = useRemoteThing();',
      '  return <span>{badge}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Badge.tsx', source),
    );

    expect(transformed).toContain('() => ("badge")');
    expect(transformed).toContain('"fallbackLabel":"generated rendered key text"');
  });

  /** Resolves responsive hook flags from the preview viewport instead of hiding desktop shells. */
  it('uses the current viewport for deterministic responsive booleans', () => {
    const source = [
      `import { useAdaptiveDesign } from './use-adaptive-design';`,
      'export function Layout() {',
      '  const { isLargeScreen, isMobile } = useAdaptiveDesign();',
      '  return isLargeScreen ? <aside /> : isMobile ? <nav /> : <main />;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Layout.tsx', source),
    );

    expect(transformed).toContain(
      `"isLargeScreen": (typeof globalThis !== 'undefined' && Number(globalThis.innerWidth) >= 1024)`,
    );
    expect(transformed).toContain(
      `"isMobile": (typeof globalThis !== 'undefined' && Number(globalThis.innerWidth) < 768)`,
    );
    expect(transformed).toContain('"fallbackLabel":"generated object fields"');
  });

  /** Preserves callable demand for destructured modal actions and JSX event callbacks. */
  it('infers destructured direct calls and event handlers as functions', () => {
    const source = [
      `import { useCalendarEventModal } from './use-calendar-event-modal';`,
      'export function Page() {',
      '  const { showCreate, renderModalForm } = useCalendarEventModal();',
      '  return <button onClick={showCreate}>{renderModalForm()}</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source),
    );

    expect(transformed).toContain('"showCreate": Object.freeze(() => undefined)');
    expect(transformed).toContain('"renderModalForm": Object.freeze(() => undefined)');
    expect(transformed).toContain('"requiredPaths":["showCreate()","renderModalForm()"]');
  });

  /** Follows required property reads so a generated object does not fail at the next access. */
  it('materializes nested callable and numeric fields from local hook-result usage', () => {
    const source = [
      `import { usePagination } from '../pagination/use-pagination';`,
      'export function List() {',
      '  const paginationContext = usePagination();',
      '  paginationContext.helpers.setPage(1);',
      '  return <span>{paginationContext.page}/{paginationContext.perPage}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/List.tsx', source),
    );

    expect(transformed).toContain(
      '"helpers": Object.freeze({ "setPage": Object.freeze(() => undefined) })',
    );
    expect(transformed).toContain('"page": 0');
    expect(transformed).toContain('"perPage": 0');
    expect(transformed).toContain('"fallbackLabel":"generated required property shape"');
    expect(transformed).toContain('"requiredPaths":["helpers.setPage()","page","perPage"]');
  });

  /** Preserves real nullish sentinels while giving a thrown hook an optional-path failure shape. */
  it('materializes optional-only paths only for the hook failure fallback', () => {
    const source = [
      `import { useUrlSync } from './use-url-sync';`,
      `import { useMemo } from 'react';`,
      'export function Table({ namespace }) {',
      '  const handler = useUrlSync(namespace);',
      '  const context = useMemo(() => ({ handler }), [handler]);',
      '  return <input data-context={String(context)} value={handler?.initialState.search ?? ""} />;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Table.tsx', source),
    );

    expect(transformed).toContain(
      '() => (Object.freeze({ "initialState": Object.freeze({ "search": "search" }) }))',
    );
    expect(transformed).toContain('"failurePaths":["initialState.search"]');
    expect(transformed).toContain('"fallbackLabel":"generated optional failure shape"');
    expect(transformed).toContain('"preserveNullish":true');
    expect(transformed).toContain('"requiredPaths":[]');
  });

  /** Shapes a failed hook while keeping optional descendants out of ordinary required paths. */
  it('records an optional destructured collection as failure-only evidence', () => {
    const source = [
      `import { useInfiniteFeedbacks } from './use-infinite-feedbacks';`,
      'export function FeedbackPage() {',
      '  const { data } = useInfiniteFeedbacks();',
      '  const feedbacks = data?.pages.flatMap((page) => page.items) ?? [];',
      '  return <main>{feedbacks.length}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/FeedbackPage.tsx', source),
    );

    expect(transformed).toContain(
      'Object.freeze({ "data": Object.freeze({ "pages": Object.freeze([]) }) })',
    );
    expect(transformed).toContain('"failurePaths":["data.pages.flatMap()"]');
    expect(transformed).toContain('"requiredPaths":[]');
    expect(transformed).not.toContain('"requiredPaths":["data"]');
  });

  /** Gives a swallowed infinite-query failure the collection receiver required by optional data. */
  it('shapes an optional nested collection for a failed custom hook result', () => {
    const source = [
      `import { useInfiniteFeedbacks } from './use-infinite-feedbacks';`,
      `import { useMemo } from 'react';`,
      'export function FeedbackPage() {',
      '  const { data, fetchNextPage, hasNextPage } = useInfiniteFeedbacks();',
      '  const feedbacks = useMemo(',
      '    () => data?.pages.flatMap((page) => page.items) ?? [],',
      '    [data],',
      '  );',
      '  return <button onClick={fetchNextPage}>{hasNextPage ? feedbacks.length : 0}</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/FeedbackPage.tsx', source),
    );

    expect(transformed).toContain('"data": Object.freeze({ "pages": Object.freeze([]) })');
    expect(transformed).toContain('"failurePaths":["data.pages.flatMap()"]');
    expect(transformed).toContain('"requiredPaths":["fetchNextPage()","hasNextPage"]');
  });

  /** Carries collection demand back through a pure memo identity and later object destructuring. */
  it('infers nested collections through a bounded useMemo identity alias', () => {
    const source = [
      `import { useMemo } from 'react';`,
      `import { useGetUserProfile } from './use-get-user-profile';`,
      'export function ProfilePage() {',
      '  const userQuery = useGetUserProfile();',
      '  const userProfile = useMemo(() => userQuery.data, [userQuery.data]);',
      '  if (!userProfile) return null;',
      '  const { name, genres } = userProfile;',
      '  return <main><h1>{name}</h1>{genres.map((genre) => <span key={genre}>{genre}</span>)}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/ProfilePage.tsx', source),
    );

    expect(transformed).toContain('"data": Object.freeze({ "genres": Object.freeze([]) })');
    expect(transformed).toContain('"requiredPaths":["data","data.genres.map()"]');
  });

  /** Refuses memo callbacks that execute project code instead of returning an identity projection. */
  it('does not propagate collection demand through a computed useMemo value', () => {
    const source = [
      `import { useMemo } from 'react';`,
      `import { useGetUserProfile } from './use-get-user-profile';`,
      'export function ProfilePage() {',
      '  const userQuery = useGetUserProfile();',
      '  const userProfile = useMemo(() => normalize(userQuery.data), [userQuery.data]);',
      '  const { genres } = userProfile;',
      '  return <main>{genres.map((genre) => <span key={genre}>{genre}</span>)}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/ProfilePage.tsx', source),
    );

    expect(transformed).toContain('"data": Object.freeze({})');
    expect(transformed).not.toContain('data.genres.map()');
  });

  /** Retains the receiver of a dynamic JSON-scalar lookup as a demanded object container. */
  it('infers descendants read through a computed GraphQL scalar property', () => {
    const source = [
      `import { useQuery } from './use-query';`,
      'export function CompanyStep() {',
      '  const { data: surveyData } = useQuery(SURVEY_QUERY);',
      '  const answer = surveyData &&',
      '    surveyData.userDetailedSurvey?.surveyResult.data[QUESTION_KEYS.USAGE];',
      '  return <main>{String(answer)}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/CompanyStep.tsx', source),
    );

    expect(transformed).toContain('"surveyResult": Object.freeze({ "data": Object.freeze({}) })');
    expect(transformed).toContain('"requiredPaths":["data.userDetailedSurvey.surveyResult.data"]');
  });

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
    expect(transformed).toContain('() => ("pageLayoutState")');
    expect(transformed).toContain('() => ("indicatorType")');
    expect(transformed).not.toContain('() => (State.Loading)');
    expect(transformed).not.toContain('() => (Type.OVERLAY)');
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

    expect(transformed).toContain('"shortName": "shortName"');
    expect(transformed).toContain('"name": "name"');
    expect(transformed).toContain('"subscription": Object.freeze({})');
    expect(transformed).toContain('"requiredPaths":["shortName","name","subscription"]');
  });

  /** Shapes one list item from callback reads so Auto values renders content instead of an empty list. */
  it('infers array callback item fields for a visible one-item preview', () => {
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

    expect(transformed).toContain('Object.freeze([Object.freeze({');
    expect(transformed).toContain('"email": "preview@example.invalid"');
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"name": "name"');
    expect(transformed).toContain('"requiredPaths":["[].id","[].name","[].email"]');
  });

  /** Instruments state and Context wrapper hooks while leaving React-owned hooks to their bridges. */
  it('wraps supported state-library and Context hooks but not React-owned hooks', () => {
    const source = [
      `import { useState } from 'react';`,
      `import { useQuery } from '@apollo/client';`,
      `import { useTheme } from 'styled-components';`,
      `import { useAppContext } from 'legal/app/app-context';`,
      'export function Page() {',
      '  const [count] = useState(0);',
      '  const theme = useTheme();',
      '  const queryOptions = { variables: { companyId: "1" } };',
      '  const query = useQuery(DOCUMENT, queryOptions);',
      '  const { user } = useAppContext();',
      '  return <main style={{ color: theme.color.primary }}>{count}{query.data}{user.name}</main>;',
      '}',
    ].join('\n');

    const replacements = createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source);

    expect(replacements).toHaveLength(2);
    expect(replacements[0]?.replacement).toContain('useQuery(DOCUMENT, queryOptions)');
    expect(replacements[0]?.replacement).toContain('"data": Object.freeze({})');
    expect(replacements[0]?.replacement).toContain(', () => (DOCUMENT), () => (queryOptions))');
    expect(replacements[0]?.replacement).not.toContain('useTheme()');
    expect(replacements[1]?.replacement).toContain('useAppContext()');
    expect(replacements[1]?.replacement).toContain('"user": Object.freeze({ "name": "name" })');
  });

  /** Supplies an inert fragment carrier when an unbridged project Context exposes GraphQL data. */
  it('infers aliased Context fragment values without knowing a project schema', () => {
    const source = [
      `import { useCompanyContext } from './company-context';`,
      'export function Modal() {',
      '  const { company: companyFragment, refetch } = useCompanyContext();',
      '  const { name } = getFragmentData(FRAGMENT, companyFragment);',
      '  return <button onClick={refetch}>{name}</button>;',
      '}',
    ].join('\n');

    const replacements = createPreviewRuntimeHookReplacements('/workspace/Modal.tsx', source);

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('"company": Object.freeze({})');
    expect(replacements[0]?.replacement).toContain('"refetch": Object.freeze(() => undefined)');
    expect(replacements[0]?.replacement).toContain('"requiredPaths":["company","refetch()"]');
  });

  /** Keeps semantic guard sentinels neutral and never captures a later local in a hook fallback. */
  it('uses deterministic semantic values before unsafe direct-condition evidence', () => {
    const source = [
      `import { useQuery } from './use-query';`,
      `import { useParams } from 'react-router-dom';`,
      'export function Layout() {',
      '  const { companyId = "" } = useParams();',
      '  const { data, loading, fallback } = useQuery(DOCUMENT);',
      '  const companyFromSelector = { id: "authored" };',
      '  if (!data || fallback || loading) return null;',
      '  return companyFromSelector?.id === companyId ? <main /> : null;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Layout.tsx', source),
    );

    expect(transformed).toContain('"companyId": "preview-id"');
    expect(transformed).toContain('"data": Object.freeze({})');
    expect(transformed).toContain('"loading": false');
    expect(transformed).toContain('"fallback": null');
    expect(transformed).toContain(', () => (DOCUMENT))');
  });

  /** Creates Formik tuple fields that can render even when the installed hook has no Provider. */
  it('infers semantic Formik field values and helper methods from tuple usage', () => {
    const source = [
      `import { useField } from 'formik';`,
      'export function NameField() {',
      '  const [field, meta, helpers] = useField("name");',
      '  return <input value={field.value} aria-invalid={meta.touched} onChange={() => helpers.setValue("next")} />;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/NameField.tsx', source),
    );

    expect(transformed).toContain('useField("name")');
    expect(transformed).toContain('"value": "value"');
    expect(transformed).toContain('"touched": false');
    expect(transformed).toContain('"setValue": Object.freeze(() => undefined)');
  });

  /** Uses local demand evidence rather than a package-name allowlist for third-party hooks. */
  it('instruments arbitrary external hooks only when their result shape is locally proven', () => {
    const source = [
      `import { useRemoteThing } from '@vendor/side-effectful-sdk';`,
      'export function View() {',
      '  const value = useRemoteThing();',
      '  return value.name;',
      '}',
    ].join('\n');

    const replacements = createPreviewRuntimeHookReplacements('/workspace/View.tsx', source);

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('useRemoteThing()');
    expect(replacements[0]?.replacement).toContain('"name": "name"');
  });

  /** Handles callable and conditional hook bindings without guessing their package semantics. */
  it('infers direct function and boolean use for unknown hook return values', () => {
    const source = [
      `import { useFeatureFlag, useTranslator } from 'unknown-runtime';`,
      'export function View() {',
      '  const enabled = useFeatureFlag();',
      '  const translate = useTranslator();',
      '  return enabled ? <span>{translate("title")}</span> : null;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/View.tsx', source),
    );

    expect(transformed.match(/\.resolveRuntimeHook\(/gu)).toHaveLength(2);
    expect(transformed).toContain('() => (false)');
    expect(transformed).toContain('Object.freeze(() => undefined)');
  });

  /** Completes direct raw React Context reads without admitting unrelated built-in React hooks. */
  it('instruments only useContext from the React module', () => {
    const source = [
      `import React, { useContext, useMemo } from 'react';`,
      'export function View() {',
      '  const app = useContext(AppContext);',
      '  const memo = useMemo(() => 1, []);',
      '  const namespaceValue = React.useContext(CompanyContext);',
      '  const namespaceMemo = React.useMemo(() => 2, []);',
      '  return app.user.name + namespaceValue.company.name + memo + namespaceMemo;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/View.tsx', source),
    );

    expect(transformed.match(/\.resolveRuntimeHook\(/gu)).toHaveLength(2);
    expect(transformed).toContain('() => (useContext(AppContext))');
    expect(transformed).toContain('() => (React.useContext(CompanyContext))');
    expect(transformed).toContain('"user": Object.freeze({ "name": "name" })');
    expect(transformed).not.toContain('() => (useMemo(');
    expect(transformed).not.toContain('() => (React.useMemo(');
  });

  /** Keeps one outer replacement when nested hook arguments overlap the same source range. */
  it('selects a deterministic non-overlapping hook edge', () => {
    const source = [
      `import { useCount, useFilter } from './hooks';`,
      'export function Page() {',
      '  const total = useCount(useFilter());',
      '  return total;',
      '}',
    ].join('\n');

    const replacements = createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source);

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('useCount(useFilter())');
  });
});

/** Applies test replacements with the same right-to-left offset policy as the source transformer. */
function applyHookReplacements(
  source: string,
  replacements: ReturnType<typeof createPreviewRuntimeHookReplacements>,
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
