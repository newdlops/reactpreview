/** Covers contracts behavior for previewRuntimeHookInstrumentation. */
/** Verifies authored-source previewRuntimeHookInstrumentation invariants. */
import { describe, expect, it } from 'vitest';

import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

import { applyHookReplacements } from './previewRuntimeHookInstrumentationFixtures';

describe('createPreviewRuntimeHookReplacements', () => {
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
    expect(replacements[0]?.replacement).toContain('"data": "Data"');
    expect(replacements[0]?.replacement).toContain(
      ', () => (DOCUMENT), () => (queryOptions), () => (useQuery))',
    );
    expect(replacements[0]?.replacement).not.toContain('useTheme()');
    expect(replacements[1]?.replacement).toContain('useAppContext()');
    expect(replacements[1]?.replacement).toContain('"user": Object.freeze({ "name": "Name" })');
  });

  /**
   * Values read only inside untagged template strings are text, so they get key labels instead of
   * `{}` ("[object Object]") or nothing ("undefined차"); tagged templates keep their values.
   */
  it('fills template-interpolated hook values with text labels', () => {
    const source = [
      `import { gql } from '@apollo/client';`,
      `import { useAppContext } from 'legal/app/app-context';`,
      'export function Summary() {',
      '  const { round, vehicle, fragment } = useAppContext();',
      '  const QUERY = gql`query Summary { ...${fragment} }`;',
      "  const columns = [{ key: 'round', cell: `${round}차` }];",
      '  return <p title={columns[0].cell}>{`${vehicle.model} ∙ ${vehicle.licensePlate}`}</p>;',
      '}',
    ].join('\n');

    const replacement = createPreviewRuntimeHookReplacements('/workspace/Summary.tsx', source)[0]
      ?.replacement;

    expect(replacement).toContain('"round": "Round"');
    expect(replacement).toContain(
      '"vehicle": Object.freeze({ "licensePlate": "License plate", "model": "Model" })',
    );
    expect(replacement).not.toContain('"fragment": "Fragment"');
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
    expect(transformed).toContain('"value": "Value"');
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
    expect(replacements[0]?.replacement).toContain('"name": "Name"');
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
    expect(transformed).toContain('"user": Object.freeze({ "name": "Name" })');
    expect(transformed).not.toContain('() => (useMemo(');
    expect(transformed).not.toContain('() => (React.useMemo(');
  });

  /** Keeps a package's own nullish result when it goes back to that package's consumer. */
  it('preserves nullish package hook results that the same package consumes', () => {
    const editorSource = [
      `import { EditorContent, useEditor } from '@tiptap/react';`,
      'export function Editor({ value }) {',
      '  const editor = useEditor({ immediatelyRender: false, content: value });',
      '  useEffect(() => {',
      '    if (!editor) return;',
      '    editor.commands.setContent(value);',
      '  }, [editor, value]);',
      '  return <EditorContent editor={editor} />;',
      '}',
    ].join('\n');
    const stateSource = [
      `import * as Tiptap from '@tiptap/react';`,
      'export function Count() {',
      '  const editor = Tiptap.useEditor({});',
      '  const count = Tiptap.useEditorState({ editor, selector: (state) => state.editor.getText() });',
      '  return <p>{editor.getText()}{count}</p>;',
      '}',
    ].join('\n');
    const localSource = [
      `import { useEditor } from '@tiptap/react';`,
      `import { Surface } from './surface';`,
      'export function Local() {',
      '  const editor = useEditor({});',
      '  return <Surface editor={editor} text={editor.getText()} />;',
      '}',
    ].join('\n');

    const editor = createPreviewRuntimeHookReplacements('/workspace/Editor.tsx', editorSource);
    const state = createPreviewRuntimeHookReplacements('/workspace/Count.tsx', stateSource);
    const local = createPreviewRuntimeHookReplacements('/workspace/Local.tsx', localSource);

    expect(editor[0]?.replacement).toContain('"hookName":"useEditor"');
    expect(editor[0]?.replacement).toContain('"preserveNullish":true');
    expect(editor[0]?.replacement).toContain('"commands.setContent()"');
    expect(state[0]?.replacement).toContain('() => (Tiptap.useEditor({}))');
    expect(state[0]?.replacement).toContain('"preserveNullish":true');
    expect(local[0]?.replacement).toContain('"hookName":"useEditor"');
    expect(local[0]?.replacement).not.toContain('"preserveNullish":true');
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
