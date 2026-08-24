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
    expect(transformed).toContain('"userName": "userName"');
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
    expect(transformed).toContain('"name": "name"');
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

  /**
   * Preserves a cross-module helper's collection contract when its query value is selected through
   * an authored empty-array default and TypeScript array annotation.
   */
  it('materializes an array-valued query field before it reaches an imported helper', () => {
    const source = [
      `import { useQuery } from './use-query';`,
      `import { buildRows } from './build-rows';`,
      `import type { Item } from './types';`,
      'export function Panel() {',
      '  const { data } = useQuery();',
      '  const rows = useMemo(() => {',
      '    const items = (data?.items ?? []) as Item[];',
      '    return buildRows(items);',
      '  }, [data]);',
      '  return <main>{rows.length}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Panel.tsx', source),
    );

    expect(transformed).toContain('"items": Object.freeze([])');
    expect(transformed).toContain('"failurePaths":["data.items[]"]');
  });

  /** Carries an exact property-access argument into an imported helper's Array contract. */
  it('materializes a nested query collection passed directly to an imported helper', () => {
    const source = [
      `import { useQuery } from './use-query';`,
      `import { filterFeeds } from './filter-feeds';`,
      'export function FeedList() {',
      '  const { data, loading } = useQuery();',
      '  if (loading || !data) return null;',
      '  const feeds = filterFeeds(data.companyFeeds, []);',
      '  return <main>{feeds.length}</main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements(
        '/workspace/FeedList.tsx',
        source,
        undefined,
        undefined,
        (localName, parameterIndex) =>
          localName === 'filterFeeds' && parameterIndex === 0
            ? {
                expression: 'Object.freeze({ __typename: "ClosingFeed", id: "preview-id" })',
                requiredPaths: ['__typename', 'id'],
              }
            : undefined,
      ),
    );

    expect(transformed).toContain('"companyFeeds": ((__createPreviewItem)');
    expect(transformed).toContain('__typename: "ClosingFeed"');
    expect(transformed).toContain(
      '"requiredPaths":["data.companyFeeds.imported-helper-array-parameter()","data.companyFeeds[].__typename","data.companyFeeds[].id","loading"]',
    );
  });

  /**
   * Carries callback-item demand through every nested collection instead of stopping after the
   * first `forEach`. This mirrors navigation trees where a generated category must contain groups,
   * pages, and route arrays before the authored shell can mount.
   */
  it('materializes deeply nested collection callback items for authored navigation shells', () => {
    const source = [
      `import { useCompanyOwnerNavigationData } from './use-company-owner-navigation-data';`,
      'export function Navigation() {',
      '  const navigation = useCompanyOwnerNavigationData();',
      '  const selected = navigation.find((category) => {',
      '    const routes: (RegExp | string)[] = [];',
      '    category.pageGroups.forEach((group) => {',
      '      group.pages.forEach((page) => {',
      '        if (page.activeRoutes) routes.push(...page.activeRoutes);',
      '      });',
      '    });',
      '    return routes.includes(location.pathname);',
      '  });',
      '  return <aside>{selected?.name}</aside>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Navigation.tsx', source),
    );

    expect(transformed.match(/react-file-preview\.generated-list-runtime/gu)).toHaveLength(4);
    expect(transformed).toContain('new RegExp(".*")');
    expect(transformed).toContain(
      '"requiredPaths":["[].pageGroups.forEach()","[].pageGroups[].pages.forEach()","[].pageGroups[].pages[].activeRoutes[]"]',
    );
  });

  /** Completes an immutable literal-zero item alias without evaluating the authored hook result. */
  it('materializes nested collection demand through an exact indexed item alias', () => {
    const source = [
      `import { useCreateGrantedRsuFormContext } from './create-granted-rsu-wizard-form';`,
      'export function EditGrantedRsu() {',
      '  const { formikProps: { values: { rsuInputs } } } = useCreateGrantedRsuFormContext();',
      '  const rsuInput = rsuInputs[0];',
      '  const totalQuantity = rsuInput.rsuInput.grantQuantity;',
      '  const currentQuantity = rsuInput.vestingItemsInput.filter((vestingItem) => vestingItem.quantityNum).reduce((sum, vestingItem) => sum + vestingItem.quantityDen, 0);',
      '  return <div data-current={currentQuantity} data-total={totalQuantity} />;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/EditGrantedRsu.tsx', source),
    );

    expect(transformed).toContain('"rsuInputs": ((__createPreviewItem)');
    expect(transformed).toContain('"rsuInput": Object.freeze({ "grantQuantity": 0 })');
    expect(transformed).toContain('"grantQuantity": 0');
    expect(transformed).toContain('"vestingItemsInput": ((__createPreviewItem)');
    expect(transformed).toContain('"quantityNum": 0');
    expect(transformed).toContain('"quantityDen": 0');
    expect(transformed).toContain('formikProps.values.rsuInputs.[].rsuInput.grantQuantity');
    expect(transformed).toContain('formikProps.values.rsuInputs.[].vestingItemsInput.filter()');
    expect(transformed).toContain(
      'formikProps.values.rsuInputs.[].vestingItemsInput[].quantityNum',
    );
    expect(transformed).toContain(
      'formikProps.values.rsuInputs.[].vestingItemsInput[].quantityDen',
    );
    expect(transformed).not.toContain('Object.freeze({ [0]: Object.freeze({}) })');
    expect(transformed).not.toContain('formikProps.values.rsuInputs.[0]');
  });

  /** Rejects aliases whose item selection can change or short-circuit at runtime. */
  it('fails closed for computed or optional indexed item aliases', () => {
    const sources = ['const rsuInput = rsuInputs[index];', 'const rsuInput = rsuInputs?.[0];'];
    for (const alias of sources) {
      const source = [
        `import { useGrantedRsuWizard } from './use-granted-rsu-wizard';`,
        'export function EditGrantedRsu() {',
        '  const { data: { rsuInputs } } = useGrantedRsuWizard();',
        `  ${alias}`,
        '  return <span>{rsuInput.grantQuantity}</span>;',
        '}',
      ].join('\n');
      const transformed = applyHookReplacements(
        source,
        createPreviewRuntimeHookReplacements('/workspace/EditGrantedRsu.tsx', source),
      );
      expect(transformed).not.toContain('data.rsuInputs[].grantQuantity');
    }
  });

  /**
   * Carries collection-item demand through a uniquely declared same-file formatter/helper call.
   */
  it('materializes fields read by a local helper invoked from an array callback', () => {
    const source = [
      `import { useAppContext } from './use-app-context';`,
      'function getCompanyLink(company) {',
      '  const { my: { role: { hasOwnerAccess } } } = company;',
      '  return hasOwnerAccess ? company.id : company.shortName;',
      '}',
      'export function CompanyList() {',
      '  const { companies } = useAppContext();',
      '  return <nav>{companies.map((company) => (',
      '    <a href={getCompanyLink(company)}>{company.name}</a>',
      '  ))}</nav>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/CompanyList.tsx', source),
    );

    expect(transformed).toContain(
      'Object.freeze(Object.assign({}, Object.freeze({ "name": "name" }), Object.freeze({ "id": "preview-id", "my": Object.freeze({ "role": Object.freeze({ "hasOwnerAccess": true }) })',
    );
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"shortName": "shortName"');
    expect(transformed).toContain('"companies.[].my.role.hasOwnerAccess"');
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

    expect(transformed).toContain('"shortName": "shortName"');
    expect(transformed).toContain('"name": "name"');
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
    expect(transformed).toContain('"name": "name"');
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

    expect(transformed).toContain('"endDate": "2024-01-01T00:00:00.000Z"');
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"startDate": "2024-01-01T00:00:00.000Z"');
    expect(transformed).toContain('"status": "PREVIEW"');
    expect(transformed).toContain('"title": "title"');
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
    expect(transformed).toContain('"code": "code"');
    expect(transformed).toContain('"dateOfBirth": "2024-01-01T00:00:00.000Z"');
    expect(transformed).toContain('"givenName": "givenName"');
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
    expect(transformed).toContain('() => ("button")');
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

  /** Reuses authored Nuqs parser defaults so registry-backed query values stay in their domain. */
  it('recovers a local useQueryStates parser map without executing its provider', () => {
    const source = [
      `import { useQueryStates, parseAsStringLiteral } from 'nuqs';`,
      `import { DEFAULTS } from './defaults';`,
      'const parsers = {',
      `  theme: parseAsStringLiteral(['neutral']).withDefault(DEFAULTS.theme),`,
      `  template: parseAsStringLiteral(['next']).withDefault('next').withOptions({ shallow: true }),`,
      '};',
      'export function Form() {',
      '  const [params, setParams] = useQueryStates(parsers);',
      '  return <button onClick={() => setParams({})}>{params.theme}{params.template}</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Form.tsx', source),
    );

    expect(transformed).toContain('"theme": (DEFAULTS.theme)');
    expect(transformed).toContain('"template": (\'next\')');
    expect(transformed).toContain('"requiredPaths":["0.theme","0.template","1()"]');
    expect(transformed).toContain('"evidence":"authored query-state parser defaults"');
  });

  /** Never borrows a same-name module parser map when a component parameter owns the call binding. */
  it('fails closed for a shadowed useQueryStates parser-map identifier', () => {
    const source = [
      `import { useQueryStates, parseAsString } from 'nuqs';`,
      `const parsers = { theme: parseAsString.withDefault('module-theme') };`,
      'export function Form({ parsers }) {',
      '  const [params] = useQueryStates(parsers);',
      '  return <span>{params.theme}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Form.tsx', source),
    );

    expect(transformed).not.toContain('"theme": (\'module-theme\')');
    expect(transformed).not.toContain('authored query-state parser defaults');
  });

  /** Infers the caller-owned tuple behind an imported HTTP hook facade such as useApi.get. */
  it('wraps bounded data-hook facade methods with their downstream state contract', () => {
    const source = [
      `import useApi from 'shared/hooks/api';`,
      'export function Project() {',
      `  const [{ data, error, setLocalData }, fetchProject] = useApi.get('/project');`,
      '  if (!data) return null;',
      '  if (error) return <div>Error</div>;',
      '  return data.project.users.map(user => <span key={user.id}>{user.name}</span>);',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Project.jsx', source),
    );

    expect(transformed).toContain("resolveRuntimeHook(() => (useApi.get('/project'))");
    expect(transformed).toContain('"hookName":"useApi.get"');
    expect(transformed).toContain('"data": Object.freeze({ "project": Object.freeze({ "users":');
    expect(transformed).toContain('react-file-preview.generated-list-runtime');
    expect(transformed).toContain('"error": null');
    expect(transformed).toContain('"setLocalData": Object.freeze(() => undefined)');
    expect(transformed).toContain('"requiredPaths":["0.data.project.users.map()"');
  });

  /** Leaves a projected inner hook nullish so an instrumented facade caller can repair its tuple. */
  it('preserves direct lower-case hook-wrapper returns for caller-owned inference', () => {
    const source = [
      `import useQuery from './query';`,
      'export default {',
      '  get: (...args) => useQuery(...args),',
      '};',
    ].join('\n');

    const replacements = createPreviewRuntimeHookReplacements('/workspace/api/index.js', source);

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacement).toContain('() => (undefined)');
    expect(replacements[0]?.replacement).toContain(
      '"fallbackLabel":"preserved hook-wrapper result"',
    );
    expect(replacements[0]?.replacement).toContain('"passive":true');
    expect(replacements[0]?.replacement).toContain('"preserveNullish":true');
    expect(replacements[0]?.replacement).toContain('"requiredPaths":[]');
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
    expect(replacements[0]?.replacement).toContain('"data": "data"');
    expect(replacements[0]?.replacement).toContain(
      ', () => (DOCUMENT), () => (queryOptions), () => (useQuery))',
    );
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

  /** Lets an authored binding initializer satisfy a missing route param without inventing data. */
  it('omits defaulted hook fields from generated values and required paths', () => {
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

    expect(transformed).not.toContain('"companyId": "preview-id"');
    expect(transformed).toContain('Object.freeze({})');
    expect(transformed).not.toContain('"requiredPaths":["companyId"]');
    expect(transformed).toContain('"data": Object.freeze({})');
    expect(transformed).toContain('"loading": false');
    expect(transformed).toContain('"fallback": null');
    expect(transformed).toContain(', () => (DOCUMENT), undefined, () => (useQuery))');
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

  /** Carries package-agnostic identity evidence so runtime learning can align generated references. */
  it('tags a literal identity field value as a neural semantic demand', () => {
    const source = [
      `import { useProjectField } from './use-project-field';`,
      'export function Chairperson() {',
      '  const { value, helpers: { setValue } } = useProjectField("chairpersonId");',
      '  return <button onClick={() => setValue(value)}>{value}</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Chairperson.tsx', source),
    );

    expect(transformed).toContain('"semanticValueDemand":{"kind":"identity","path":"value"}');
  });

  /** Requires an actual identifier token and leaves ordinary text field values independent. */
  it('does not tag a text field whose name merely ends with the letters id', () => {
    const source = [
      `import { useProjectField } from './use-project-field';`,
      'export function Validation() {',
      '  const { value } = useProjectField("valid");',
      '  return <span>{value}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Validation.tsx', source),
    );

    expect(transformed).not.toContain('semanticValueDemand');
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

  /** Treats String prototype calls as receiver evidence instead of generating callable properties. */
  it('infers a string receiver for nested hook values used through string-only methods', () => {
    const source = [
      `import { useDesignParams } from './use-design-params';`,
      'export function ProjectForm() {',
      '  const [params, setParams] = useDesignParams();',
      '  const framework = getFramework(params.template ?? "next");',
      '  const monorepo = params.template?.endsWith("-monorepo") ?? false;',
      '  return <button onClick={setParams}>{framework.replace("next", "vite") + String(monorepo)}</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/ProjectForm.tsx', source),
    );

    expect(transformed).toContain('"template": "template"');
    expect(transformed).toContain('"requiredPaths":["0.template.endsWith()","1()"]');
    expect(transformed).not.toContain('"endsWith": Object.freeze(() => undefined)');
  });

  /** Keeps object APIs callable when their method name also exists on String.prototype. */
  it('does not classify a semantic router replace method as a string receiver', () => {
    const source = [
      `import { useRouter } from 'next/navigation';`,
      'export function RedirectButton() {',
      '  const router = useRouter();',
      '  return <button onClick={() => router.replace("/next")}>Next</button>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/RedirectButton.tsx', source),
    );

    expect(transformed).toContain('"replace": Object.freeze(() => undefined)');
    expect(transformed).toContain('"requiredPaths":["replace()"]');
  });

  /** A rendered length is the result of an Array read, not the shape of its receiver. */
  it('keeps a nested hook field array-shaped when length is rendered before map', () => {
    const source = [
      `import { useMeetingDraftSaver } from './use-meeting-draft-saver';`,
      'export function DraftSaveHeader() {',
      '  const { meetingFormValues } = useMeetingDraftSaver();',
      '  return <main>',
      '    <span>{meetingFormValues.agendaSelection.length}</span>',
      '    {meetingFormValues.agendaSelection.map(createAgendaText).join(", ")}',
      '  </main>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/DraftSaveHeader.tsx', source),
    );

    expect(transformed).toContain('"agendaSelection": Object.freeze([])');
    expect(transformed).not.toContain('"agendaSelection": 0');
    expect(transformed).toContain('meetingFormValues.agendaSelection.map()');
  });

  /** A derived length guard needs a real item so downstream collection controls can mount. */
  it('populates a hook collection whose const length alias guards the rendered page', () => {
    const source = [
      `import { useLatestContents } from './use-latest-contents';`,
      'export function Carousel() {',
      '  const latestContentsQuery = useLatestContents();',
      '  const { data: contents, status } = latestContentsQuery;',
      '  const contentsLength = contents?.length ?? 0;',
      '  const extended = contentsLength ? Array(21).fill(contents).flat() : [];',
      "  if (status === 'pending') return <p>Loading</p>;",
      '  if (!contentsLength) return <p>Empty</p>;',
      '  return extended.map((content) => <button key={content.id}>{content.name}</button>);',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/Carousel.tsx', source),
    );

    expect(transformed).toContain('react-file-preview.generated-list-runtime');
    expect(transformed).toContain('Object.freeze({ id: "preview-id", name: "name" })');
    expect(transformed).toContain('"requiredPaths":["status","data.length"]');
    expect(transformed).not.toContain('"data": Object.freeze([])');
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
    expect(transformed).toContain('undefined, undefined, () => (AppContext)');
    expect(transformed).toContain('undefined, undefined, () => (CompanyContext)');
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
