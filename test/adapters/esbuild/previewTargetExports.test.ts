/**
 * Verifies ordered target-export and conservative styled-theme import selection from editor text.
 * Inline snapshots exercise the same TSX parser path used for unsaved active documents without
 * resolving or evaluating any workspace module.
 */
import { describe, expect, it } from 'vitest';
import {
  selectPreviewPrimaryTargetExport,
  selectPreviewTargetExports,
  selectPreviewThemeImport,
  shouldPreferPreviewModulePageContext,
} from '../../../src/adapters/esbuild/previewTargetExports';
import { PreviewCompilationError } from '../../../src/domain/preview';

describe('selectPreviewTargetExports', () => {
  /** Preserves declaration order instead of moving a later default ahead of named components. */
  it('returns named and default runtime exports in source order', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/Preview.tsx',
      [
        'export const FirstPreview = () => <nav />;',
        'export default function MainPreview() { return <main />; }',
        'export class LastPreview { render() { return <aside />; } }',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'FirstPreview', exportName: 'FirstPreview', kind: 'explicit' },
      { displayName: 'MainPreview', exportName: 'default', kind: 'explicit' },
      { displayName: 'LastPreview', exportName: 'LastPreview', kind: 'explicit' },
    ]);
  });

  /** Keeps each eligible element at its exact position within one explicit export clause. */
  it('preserves local export clause order and resolves a default display name', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/Preview.tsx',
      [
        'const FirstPreview = () => <main />;',
        'const MainPreview = () => <main />;',
        'const LastPreview = () => <main />;',
        'export { FirstPreview, MainPreview as default, LastPreview };',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'FirstPreview', exportName: 'FirstPreview', kind: 'explicit' },
      { displayName: 'MainPreview', exportName: 'default', kind: 'explicit' },
      { displayName: 'LastPreview', exportName: 'LastPreview', kind: 'explicit' },
    ]);
  });

  /** Treats explicit external aliases as runtime slots without resolving the referenced module. */
  it('collects external re-exports in clause order', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/index.ts',
      "export { First, default as MainPreview, helper, Last as LastPreview } from './parts';",
    );

    expect(selection).toEqual([
      { displayName: 'First', exportName: 'First', kind: 'explicit' },
      { displayName: 'MainPreview', exportName: 'MainPreview', kind: 'explicit' },
      { displayName: 'LastPreview', exportName: 'LastPreview', kind: 'explicit' },
    ]);
  });

  /** Leaves a positional placeholder for every value star while erasing a type-only star. */
  it('retains bare runtime wildcard export positions', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/index.ts',
      [
        'export const Before = () => null;',
        "export * from './middle';",
        "export type * from './types';",
        'export const After = () => null;',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'Before', exportName: 'Before', kind: 'explicit' },
      { kind: 'wildcard' },
      { displayName: 'After', exportName: 'After', kind: 'explicit' },
    ]);
  });

  /** Excludes erased, ambient, lowercase, and type-only aliases while retaining runtime values. */
  it('filters declarations that cannot be component gallery entries', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/parts.tsx',
      [
        'export interface InterfacePreview { value: string }',
        'export type AliasPreview = { value: string };',
        'export declare class AmbientPreview {}',
        'export const helper = 1;',
        'const RuntimePreview = () => <main />;',
        'type TypePreview = { value: string };',
        'export { RuntimePreview, type TypePreview };',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'RuntimePreview', exportName: 'RuntimePreview', kind: 'explicit' },
    ]);
  });

  /** Returns all PascalCase candidates instead of turning a plural component file into ambiguity. */
  it('keeps multiple named components without filename heuristics', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/second-preview.tsx',
      [
        'export const FirstPreview = () => <main />;',
        'export const SecondPreview = () => <aside />;',
      ].join('\n'),
    );

    expect(selection.map((slot) => (slot.kind === 'explicit' ? slot.exportName : '*'))).toEqual([
      'FirstPreview',
      'SecondPreview',
    ]);
  });

  /** Seeds parent-page discovery from the component instead of adjacent runtime constants. */
  it('prefers a component-role export over fragment and Context constants', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/company-register-modal.tsx',
      [
        'export const COMPANY_REGISTER_MODAL_FRAGMENT = gql`fragment Company on Company { id }`;',
        'export const CompanyRegisterModalContext = createContext(null);',
        'export function CompanyRegisterModal() { return <dialog />; }',
      ].join('\n'),
    );

    expect(selectPreviewPrimaryTargetExport(selection)).toBe('CompanyRegisterModal');
  });

  /** Separates page data modules from actual component functions before Next page promotion. */
  it('prefers module page context only for definitely non-component export values', () => {
    expect(
      shouldPreferPreviewModulePageContext(
        '/workspace/navigation.tsx',
        'export const NavigationItems = [{ label: "Home" }];',
        'NavigationItems',
      ),
    ).toBe(true);
    expect(
      shouldPreferPreviewModulePageContext(
        '/workspace/registry.tsx',
        'const registry = { title: "Home" }; export default registry;',
        'default',
      ),
    ).toBe(true);
    expect(
      shouldPreferPreviewModulePageContext(
        '/workspace/page-card.tsx',
        'export default function PageCard() { return <article />; }',
        'default',
      ),
    ).toBe(false);
    expect(
      shouldPreferPreviewModulePageContext(
        '/workspace/widget.tsx',
        'export const Widget = () => <section />;',
        'Widget',
      ),
    ).toBe(false);
  });

  /** Prevents a hook module's adjacent gql value from becoming Page Inspector's mount target. */
  it('excludes an exported gql mutation even when it is the only uppercase runtime value', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/use-company-phone-modal.tsx',
      [
        "import documentTag from 'graphql-tag';",
        'type PhoneMutation = unknown;',
        'export const COMPANY_CREATE_EDIT_USER_PHONE_MUTATION: typeof PhoneMutation = documentTag`mutation EditPhone { editPhone }`;',
        'export const useCompanyPhoneModal = () => ({ show() {} });',
      ].join('\n'),
    );

    expect(selection).toEqual([]);
    expect(selectPreviewPrimaryTargetExport(selection)).toBeUndefined();
  });

  /** Recognizes code-generator object documents and local export aliases without evaluating them. */
  it('excludes generated DocumentNode objects through casts and export aliases', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/documents.ts',
      [
        "import type { TypedDocumentNode } from '@graphql-typed-document-node/core';",
        'const CompanyDocument = { kind: "Document", definitions: [] } as unknown as TypedDocumentNode;',
        'const AliasedDocument = CompanyDocument;',
        'export { CompanyDocument, AliasedDocument as CompanyQuery };',
      ].join('\n'),
    );

    expect(selection).toEqual([]);
  });

  /** A component prop mentioning DocumentNode does not make the component value a document. */
  it('retains React components whose nested props or attached metadata mention DocumentNode', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/document-viewer.tsx',
      [
        "import type { DocumentNode } from 'graphql';",
        'type ViewerProps = { document: DocumentNode };',
        'export const DocumentViewer: React.FC<ViewerProps> = () => <main />;',
        'export const DecoratedViewer: React.FC & { document: DocumentNode } = () => <aside />;',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'DocumentViewer', exportName: 'DocumentViewer', kind: 'explicit' },
      { displayName: 'DecoratedViewer', exportName: 'DecoratedViewer', kind: 'explicit' },
    ]);
  });

  /** An opaque helper called graphql may be a React HOC and is not direct document evidence. */
  it('retains exports produced by unproven local graphql helpers', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/wrapped-panel.tsx',
      [
        "import { graphql } from './component-hoc';",
        'const Panel = () => <main />;',
        'export const WrappedPanel = graphql(Panel);',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'WrappedPanel', exportName: 'WrappedPanel', kind: 'explicit' },
    ]);
  });

  /** Package and generated-helper origins prove gql/graphql document construction. */
  it('excludes documents created by proven package and generated helper imports', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/generated-documents.ts',
      [
        "import { gql as apolloGql } from '@apollo/client';",
        "import { graphql as generatedGraphql } from './gql';",
        'export const COMPANY_QUERY = apolloGql`query Company { company { id } }`;',
        "export const COMPANY_MUTATION = generatedGraphql('mutation Company { updateCompany }');",
      ].join('\n'),
    );

    expect(selection).toEqual([]);
  });

  /** Namespace members retain per-export semantics instead of trusting the package wholesale. */
  it('does not treat an unproven graphql namespace member as a document factory', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/apollo-namespace.tsx',
      [
        "import * as Apollo from '@apollo/client';",
        'export const COMPANY_QUERY = Apollo.gql`query Company { company { id } }`;',
        'export const GraphqlPanel = Apollo.graphql(() => <main />);',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'GraphqlPanel', exportName: 'GraphqlPanel', kind: 'explicit' },
    ]);
  });

  /** An exact top-level document annotation remains useful when its initializer is opaque. */
  it('excludes only direct top-level TypedDocumentNode annotations', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/typed-document.tsx',
      [
        "import type { TypedDocumentNode } from '@graphql-typed-document-node/core';",
        'export const CompanyQuery: TypedDocumentNode = createDocument();',
        'export const QueryConsumer: React.FC<{ query: TypedDocumentNode }> = () => <main />;',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'QueryConsumer', exportName: 'QueryConsumer', kind: 'explicit' },
    ]);
  });

  /** Uses value shape rather than uppercase spelling so acronym React owners remain previewable. */
  it('retains acronym and screaming-snake React component exports', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/acronyms.tsx',
      [
        'export const HTTP = () => <main />;',
        'export const COMPANY_QUERY = () => <section />;',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'HTTP', exportName: 'HTTP', kind: 'explicit' },
      { displayName: 'COMPANY_QUERY', exportName: 'COMPANY_QUERY', kind: 'explicit' },
    ]);
  });

  /** Keeps a default export authoritative even when a named component has stronger role wording. */
  it('uses the default export as the primary Page Inspector target', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/Preview.tsx',
      [
        'export const StrongPage = () => <main />;',
        'export default function Root() { return <StrongPage />; }',
      ].join('\n'),
    );

    expect(selectPreviewPrimaryTargetExport(selection)).toBe('default');
  });

  /** Produces an ordinary empty gallery when a valid helper module exports no component shape. */
  it('returns an empty list when no runtime component candidate exists', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/helpers.ts',
      'export type Helper = string; export const helper = () => null;',
    );

    expect(selection).toEqual([]);
  });

  /** Does not mistake an erased default interface for the module's runtime default. */
  it('ignores erased default declarations', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/Preview.tsx',
      [
        'export default interface PreviewProperties { value: string }',
        'export const RuntimePreview = () => <main />;',
      ].join('\n'),
    );

    expect(selection).toEqual([
      { displayName: 'RuntimePreview', exportName: 'RuntimePreview', kind: 'explicit' },
    ]);
  });

  /** Preserves the conventional default bridge and its named function label for CommonJS files. */
  it('recognizes a CommonJS module.exports component', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/common-preview.cjs',
      'module.exports = function CommonPreview() { return <main />; };',
    );

    expect(selection).toEqual([
      { displayName: 'CommonPreview', exportName: 'default', kind: 'explicit' },
    ]);
  });

  /** Treats TypeScript export-equals as default interop while retaining its identifier label. */
  it('recognizes a TypeScript export-equals component', () => {
    const selection = selectPreviewTargetExports(
      '/workspace/src/CommonPreview.cts',
      'function CommonPreview() { return null; } export = CommonPreview;',
    );

    expect(selection).toEqual([
      { displayName: 'CommonPreview', exportName: 'default', kind: 'explicit' },
    ]);
  });

  /** Keeps parser-owned dirty-source coordinates as the selector's only domain failure. */
  it('reports invalid current editor syntax at its actual location', () => {
    const documentPath = '/workspace/src/Preview.tsx';

    expect.assertions(3);
    try {
      selectPreviewTargetExports(
        documentPath,
        ['export const valid = 1;', 'export function Broken( {'].join('\n'),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCompilationError);
      if (!(error instanceof PreviewCompilationError)) {
        return;
      }
      expect(error.diagnostics[0]?.location).toMatchObject({ file: documentPath, line: 2 });
      expect(error.diagnostics[0]?.message.length).toBeGreaterThan(0);
    }
  });
});

describe('selectPreviewThemeImport', () => {
  /** Finds the exact named theme export when styled-components participates at runtime. */
  it('selects one named theme import, including a local alias', () => {
    const selection = selectPreviewThemeImport(
      [
        "import styled from 'styled-components';",
        "import { theme as applicationTheme } from './ui/theme';",
      ].join('\n'),
    );

    expect(selection).toEqual({ exportName: 'theme', moduleSpecifier: './ui/theme' });
  });

  /** Supports the common default-export theme convention only when its local name is `theme`. */
  it('selects a default import whose local binding is theme', () => {
    const selection = selectPreviewThemeImport(
      ["import { css } from 'styled-components';", "import theme from '@/design/theme';"].join(
        '\n',
      ),
    );

    expect(selection).toEqual({ exportName: 'default', moduleSpecifier: '@/design/theme' });
  });

  /** Refuses to infer a project theme when styled-components is present only as erased type data. */
  it('requires a styled-components value import', () => {
    const selection = selectPreviewThemeImport(
      [
        "import type { DefaultTheme } from 'styled-components';",
        "import { theme } from './ui/theme';",
      ].join('\n'),
    );

    expect(selection).toBeUndefined();
  });

  /** Distinguishes the imported export name from an unrelated local alias named theme. */
  it('rejects a named import whose imported name is not exactly theme', () => {
    const selection = selectPreviewThemeImport(
      [
        "import styled from 'styled-components';",
        "import { applicationTheme as theme } from './ui/theme';",
      ].join('\n'),
    );

    expect(selection).toBeUndefined();
  });

  /** Ignores individually erased specifiers in an otherwise runtime-capable import declaration. */
  it('rejects a type-only theme candidate', () => {
    const selection = selectPreviewThemeImport(
      ["import styled from 'styled-components';", "import { type theme } from './ui/theme';"].join(
        '\n',
      ),
    );

    expect(selection).toBeUndefined();
  });

  /** Chooses no automatic theme when multiple exact imports make ownership ambiguous. */
  it('returns undefined for two theme candidates', () => {
    const selection = selectPreviewThemeImport(
      [
        "import styled from 'styled-components';",
        "import theme from './legacy-theme';",
        "import { theme as modernTheme } from './modern-theme';",
      ].join('\n'),
    );

    expect(selection).toBeUndefined();
  });

  /** Chooses no automatic theme when the file has no exact theme import at all. */
  it('returns undefined for zero theme candidates', () => {
    const selection = selectPreviewThemeImport(
      ["import styled from 'styled-components';", "import palette from './palette';"].join('\n'),
    );

    expect(selection).toBeUndefined();
  });
});
