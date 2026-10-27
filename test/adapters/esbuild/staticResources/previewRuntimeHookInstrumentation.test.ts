/** Covers bindings behavior for previewRuntimeHookInstrumentation. */
/** Verifies authored-source previewRuntimeHookInstrumentation invariants. */
import { describe, expect, it } from 'vitest';

import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

import { applyHookReplacements } from './previewRuntimeHookInstrumentationFixtures';

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

  it('preserves a static custom merge-state initializer instead of guessing its fields', () => {
    const source = [
      `import useMergeState from './merge-state';`,
      'const defaultFilters = { searchTerm: "", userIds: [], myOnly: false, recent: false };',
      'export function Board() {',
      '  const [filters, mergeFilters] = useMergeState(defaultFilters);',
      '  return <main data-active={filters.userIds.includes(1)} onClick={mergeFilters} />;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Board.tsx', source),
    );

    expect(transformed).toContain(
      'Object.freeze({ "searchTerm": "", "userIds": Object.freeze([]), "myOnly": false, "recent": false })',
    );
    expect(transformed).toContain('"fallbackLabel":"authored initial state + no-op setter"');
    expect(transformed).toContain('"preserveSmartValue":true');
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
    expect(transformed).toContain('"userName": "User name"');
    expect(transformed).toContain('"refresh": Object.freeze(() => undefined)');
  });

  /** Emits a learnable call-result candidate while keeping the compiler fallback inert. */
  it('tags a hook callable used as a collection filter predicate for neural learning', () => {
    const source = [
      `import { useRoundFilter } from './use-round-filter';`,
      'export function FeedList({ feeds }) {',
      '  const roundFilter = useRoundFilter();',
      '  const visibleFeeds = feeds.filter((feed) => roundFilter.matches(feed.round));',
      '  return visibleFeeds.map((feed) => <article key={feed.id}>{feed.name}</article>);',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/FeedList.tsx', source),
    );

    expect(transformed).toContain('"matches": Object.freeze(() => undefined)');
    expect(transformed).toContain(
      'path: "matches()", value: (true), role: "collection-filter-predicate"',
    );
    expect(transformed).toContain('"requiredPaths":["matches()"]');
  });

  /** Keeps an opaque package helper from receiving a locally inferred, incomplete list item. */
  it('preserves a neutral collection when a hook list crosses an opaque helper', () => {
    const source = [
      `import { useChat } from '@ai-sdk/react';`,
      'export function ChatCard({ chat }) {',
      '  const { messages, sendMessage } = useChat();',
      '  const nextMessage = chat.next(messages);',
      '  return messages.length === 0 ? <p>Empty</p> : messages.map((message) => (',
      '    <button key={message.id} onClick={() => sendMessage(nextMessage)}>{message.role}</button>',
      '  ));',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/ChatCard.tsx', source),
    );

    expect(transformed).toContain('"messages": Object.freeze([])');
    expect(transformed).toContain('"requiredPaths":["messages","sendMessage()"]');
    expect(transformed).not.toContain('"messages": Object.freeze([Object.freeze({');
  });

  /** A route-filter selection must stay empty so generated page records are not filtered away. */
  it('keeps a tuple selection collection neutral across a filtering helper', () => {
    const source = [
      `import { useRoundFilter } from './use-round-filter';`,
      `import { filterFeeds } from './filter-feeds';`,
      'export function FeedList({ data }) {',
      '  const [selectedRounds] = useRoundFilter();',
      '  const feeds = filterFeeds(data.companyFeeds, selectedRounds);',
      '  if (selectedRounds.length > 0) return null;',
      '  return <main>{feeds.length}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/FeedList.tsx', source),
    );

    expect(transformed).toContain('Object.freeze([Object.freeze([])])');
    expect(transformed).not.toContain('react-file-preview.generated-list-runtime');
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
    expect(transformed).not.toContain('() => ("Query")');
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

  /** Carries JSX guard demand back through an optional query field and a cached-value choice. */
  it('infers deep requirements through a nullish domain-value alias', () => {
    const source = [
      `import { useQuery } from '../use-query';`,
      'export function ApplicationLayout() {',
      '  const { data, loading } = useQuery(DOCUMENT);',
      '  const cachedCompany = {};',
      '  const company = data?.companyWithDeletionStatus ?? cachedCompany;',
      '  if (loading || !company.my.role.hasOwnerAccess) return null;',
      '  return <main>{company.name}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/ApplicationLayout.tsx', source),
    );

    expect(transformed).toContain('"companyWithDeletionStatus": Object.freeze({');
    expect(transformed).toContain('"my": Object.freeze({ "role": Object.freeze({');
    expect(transformed).toContain('"hasOwnerAccess": true');
    expect(transformed).toContain('"name": "Name"');
    expect(transformed).toContain(
      '"requiredPaths":["data.companyWithDeletionStatus.my.role.hasOwnerAccess","data.companyWithDeletionStatus.name","data.companyWithDeletionStatus","loading"]',
    );
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

    expect(transformed).toContain('() => ("Badge")');
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

  /** Treats a property-shaped hook result passed to a JSX event prop as a deferred function call. */
  it('infers deep JSX event properties as callable fallback values', () => {
    const source = [
      `import { useAgreementModals } from './use-agreement-modals';`,
      'export function Panel() {',
      '  const modals = useAgreementModals();',
      '  return <Button onClick={modals.requestBulkUpload}>Upload</Button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Panel.tsx', source),
    );

    expect(transformed).toContain('"requestBulkUpload": Object.freeze(() => undefined)');
    expect(transformed).toContain('"requiredPaths":["requestBulkUpload()"]');
  });

  /**
   * Preserves the iterable return contract of a hook-provided function and chooses the Boolean that
   * continues past an authored early-return guard.
   */
  it('infers a destructured callable result used by a render guard', () => {
    const source = [
      `import { usePagePermissionCheck } from './use-page-permission-check';`,
      'export function Page() {',
      '  const { checkPagePermission } = usePagePermissionCheck();',
      '  const [hasPermission] = checkPagePermission({ pageNameOrUrl: "Dashboard" });',
      '  if (!hasPermission) return <span>Denied</span>;',
      '  return <main>Dashboard</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Page.tsx', source),
    );

    expect(transformed).toContain('"checkPagePermission": (() => {');
    expect(transformed).toContain('const generatedCallResult = (Object.freeze([true]))');
    expect(transformed).toContain(
      'Symbol.for("newdlops.react-file-preview.generated-call-result")',
    );
    expect(transformed).toContain('"requiredPaths":["checkPagePermission()"]');
  });

  /** Preserves a mutation Promise and derives its fulfillment payload from an inline callback. */
  it('infers a Promise-returning tuple callable from a chained then callback', () => {
    const source = [
      `import { useBaseMutation } from './use-mutation';`,
      'export function DownloadButton() {',
      '  const [mutate] = useBaseMutation();',
      '  const handleDownload = () => mutate({ variables: {} }).then(({ data }) => {',
      '    if (data.documentFile) window.open(data.documentFile.url);',
      '  }).finally(() => undefined);',
      '  return <button onClick={handleDownload}>Download</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/DownloadButton.tsx', source),
    );

    expect(transformed).toContain('() => Promise.resolve(generatedCallResult)');
    expect(transformed).toContain('"data": Object.freeze({ "documentFile":');
    expect(transformed).toContain('"url":');
    expect(transformed).toContain('"requiredPaths":["0()"]');
  });

  /** Applies the same iterable result inference to a method called directly from a hook result. */
  it('infers a destructured return from a direct hook property call', () => {
    const source = [
      `import { useGate } from './use-gate';`,
      'export function DirectGate() {',
      '  const [isReady] = useGate().check();',
      '  if (!isReady) return null;',
      '  return <main>Ready</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/DirectGate.tsx', source),
    );

    expect(transformed).toContain('"check": (() => {');
    expect(transformed).toContain('const generatedCallResult = (Object.freeze([true]))');
    expect(transformed).toContain('"requiredPaths":["check()"]');
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
      '() => (Object.freeze({ "initialState": Object.freeze({ "search": "Search" }) }))',
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

    expect(transformed).toContain('"pages": ((__createPreviewItem)');
    expect(transformed).toContain('Object.freeze({ "items": Object.freeze([]) })');
    expect(transformed).toContain('"failurePaths":["data.pages.flatMap()","data.pages[].items"]');
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

    expect(transformed).toContain('"pages": ((__createPreviewItem)');
    expect(transformed).toContain('Object.freeze({ "items": Object.freeze([]) })');
    expect(transformed).toContain('"failurePaths":["data.pages.flatMap()","data.pages[].items"]');
    expect(transformed).toContain('"requiredPaths":["fetchNextPage()","hasNextPage"]');
  });
});
