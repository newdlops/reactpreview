/** Covers collections behavior for previewRuntimeHookInstrumentation. */
/** Verifies authored-source previewRuntimeHookInstrumentation invariants. */
import { describe, expect, it } from 'vitest';

import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

import { applyHookReplacements } from './previewRuntimeHookInstrumentationFixtures';

describe('createPreviewRuntimeHookReplacements', () => {
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
      'Object.freeze(Object.assign({}, Object.freeze({ "name": "Name" }), Object.freeze({ "id": "preview-id", "my": Object.freeze({ "role": Object.freeze({ "hasOwnerAccess": true }) })',
    );
    expect(transformed).toContain('"id": "preview-id"');
    expect(transformed).toContain('"shortName": "Short name"');
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

    expect(transformed).toContain('"data": Object.freeze({ "genres": ((__createPreviewItem)');
    expect(transformed).toContain('() => ("Genre")');
    expect(transformed).toContain('"requiredPaths":["data","data.genres.map()","data.genres[]"]');
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
});
