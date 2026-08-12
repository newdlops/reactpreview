/**
 * Infers bounded preview-only prop values from exported component syntax and direct value usage.
 * It never executes project modules and materializes only syntax-proven containers, primitives, and
 * functions; unproven leaves stay absent so ordinary falsey UI branches remain natural.
 */
import path from 'node:path';
import ts from 'typescript';
import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';
import { PREVIEW_STRING_ONLY_METHOD_NAMES } from '../previewStringMethodNames';
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import {
  collectPreviewRuntimeLocalHelperArgumentDemands,
  collectPreviewRuntimeLocalHelperParameterDemands,
} from './previewRuntimeHookLocalHelperItem';
import { isReactComponentTypeSyntax } from './reactComponentTypeSyntax';
import {
  inferReactOverlayVisibilityProp,
  isReactOverlayComponentName,
} from './reactOverlayVisibilityInference';
import { inferReactOverlayVisibilityTypePath } from './reactOverlayVisibilityTypeInference';
import { inferReactOverlayVisibilityNeutralValue } from './reactOverlayVisibilityNeutralValue';

const MAX_COMPONENT_EXPORTS = 32;
const MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH = 12;
const MAX_INFERRED_DEPTH = 10;
const MAX_INFERRED_NODES = 192;
const MAX_IMPORTED_TYPE_MODULES = 12;
const MAX_IMPORTED_TYPE_BYTES = 2 * 1024 * 1024;
const MAX_STATIC_REGISTRY_HINTS = 16;
const MAX_STATIC_REGISTRY_SOURCE_BYTES = 512 * 1024;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'key', 'prototype', 'ref']);
const ARRAY_METHOD_NAMES = new Set<string>(PREVIEW_COLLECTION_METHOD_NAMES);
const ARRAY_ITEM_CALLBACK_METHOD_NAMES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
]);
const ARRAY_ITEM_CALLBACK_PARAMETER_INDEX = new Map<string, number>([
  ['reduce', 1],
  ['reduceRight', 1],
]);
const ARRAY_ITEM_IDENTITY_METHOD_NAMES = new Set(['filter', 'slice', 'toReversed', 'toSorted']);
const LOCAL_HELPER_ITEM_IDENTITY_METHOD_NAMES = new Set([
  ...ARRAY_ITEM_IDENTITY_METHOD_NAMES,
  'sort',
]);
const STRING_METHOD_NAMES = new Set<string>(PREVIEW_STRING_ONLY_METHOD_NAMES);
const STRING_COLLECTION_SHARED_METHOD_NAMES = new Set([
  'at',
  'concat',
  'includes',
  'indexOf',
  'lastIndexOf',
  'slice',
]);
const KEYED_COLLECTION_HELPER_PATTERN = /^(?:group|index|key|order|sort).*By/iu;

/** Neutral value categories understood by the generated browser materializer. */
export type PreviewInferredPropKind =
  | 'array'
  | 'boolean'
  | 'component'
  | 'element'
  | 'function'
  | 'graphql-document'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

/** JSON-safe recursive shape emitted into target and Inspector bridge descriptors. */
export interface PreviewInferredPropShape {
  /** True only when authored literal/control-flow syntax proves the exact generated scalar. */
  readonly exactValue?: true;
  /** Element contract for arrays when syntax or a resolved type proves its required fields. */
  readonly items?: PreviewInferredPropShape;
  readonly kind: PreviewInferredPropKind;
  readonly properties?: Readonly<Record<string, PreviewInferredPropShape>>;
  readonly value?: boolean | number | string | null;
}

/** Exact child-component prop contracts indexed by local JSX binding and attribute name. */
export type PreviewChildPropDemandCatalog = ReadonlyMap<
  string,
  ReadonlyMap<string, PreviewInferredPropShape>
>;

/** Human-readable provenance shown beside editable values in React Page Inspector. */
export interface PreviewInferredPropProvenance {
  readonly kind: PreviewInferredPropKind;
  readonly path: string;
  readonly source: 'type' | 'usage';
}

/** One export's materialization recipe and the paths the extension invented. */
export interface PreviewInferredExportProps {
  readonly provenance: readonly PreviewInferredPropProvenance[];
  readonly shape: PreviewInferredPropShape;
}

/** Exact runtime export-name map consumed without evaluating the selected source module. */
export type PreviewInferredPropsByExport = Readonly<Record<string, PreviewInferredExportProps>>;

type ExportedFunctionLike =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;
type LocalObjectType = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** One named or default import ordered for bounded type-contract resolution. */
interface ResolvableObjectTypeImport {
  readonly importedName: string;
  readonly localName: string;
  /** Prioritizes types directly referenced by an authored component props declaration. */
  readonly propsDependency: boolean;
  /** Keeps direct component-prop wrappers ahead of large unrelated declaration graphs. */
  readonly propsContract: boolean;
  readonly moduleSpecifier: string;
  readonly order: number;
  readonly typeOnly: boolean;
}

/** One parsed direct-import module shared by all bindings from the same authored specifier. */
interface ResolvedObjectTypeModule {
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}

/** One exported object declaration paired with the parsed module that owns its dependencies. */
interface ResolvedImportedObjectType {
  readonly declaration: LocalObjectType;
  readonly module: ResolvedObjectTypeModule;
}

/** Bounded parse-only import reader shared by compiler and child-demand callers. */
export interface PreviewPropInferenceOptions {
  /** Imported/local child contracts used only for identity-preserving JSX prop forwarding. */
  readonly childPropDemands?: PreviewChildPropDemandCatalog;
  readonly resolveImport?: (
    moduleSpecifier: string,
    importerPath: string,
  ) => Readonly<{ sourcePath: string; sourceText: string }> | undefined;
}

/** Primitive key accepted by one statically resolved label/renderer registry. */
type PreviewStaticRegistryKey = boolean | number | string;

/** Mutable internal node that retains merge provenance before deterministic serialization. */
interface MutableShapeNode {
  children: Map<string, MutableShapeNode>;
  /** Retains authored literal/control-flow evidence across compatible shape merges. */
  exactValue?: true;
  /** Element contract for an Array node, retained only when its syntax is statically resolvable. */
  items?: MutableShapeNode;
  /** Direct iterable destructuring proves that an otherwise scalar-typed Array needs one sample. */
  itemConsumed?: true;
  kind: PreviewInferredPropKind;
  /** The callback item itself was emitted as React child content rather than only keyed. */
  renderedValue?: true;
  source: PreviewInferredPropProvenance['source'];
  value?: boolean | number | string | null;
}

/** One local identifier proven to represent a path rooted at the component's props object. */
interface PropPathBinding {
  readonly path: readonly string[];
}

/** Export name paired with the function body that React will invoke for that export. */
interface ExportedComponentFunction {
  /** Props type supplied by a variable annotation such as `React.FC<CardProps>`. */
  readonly classComponentProps?: true;
  readonly contextualPropsType?: ts.TypeNode;
  readonly exportName: string;
  readonly functionLike: ExportedFunctionLike;
}

/** Function body plus the optional variable-level React component props contract. */
interface ComponentFunctionCandidate {
  /** The function is a class render method whose external prop root is `this.props`. */
  readonly classComponentProps?: true;
  readonly contextualPropsType?: ts.TypeNode;
  readonly functionLike: ExportedFunctionLike;
}

/** Same-file declaration that may be a function or a bounded chain of component wrappers. */
interface LocalComponentDeclaration {
  readonly classComponentProps?: true;
  readonly contextualPropsType?: ts.TypeNode;
  readonly expression?: ts.Expression;
  readonly functionLike?: ExportedFunctionLike;
}

/** Bounded mutable inference state for one exported function. */
interface InferenceState {
  /** Component names already traversed while carrying one exact local JSX prop demand. */
  readonly activeLocalComponentNames: ReadonlySet<string>;
  /** Allows only a detached Array callback item to become a scalar ReactNode fallback. */
  readonly allowRenderedRootScalar: boolean;
  readonly aliases: Map<string, PropPathBinding>;
  readonly childPropDemands: PreviewChildPropDemandCatalog | undefined;
  readonly collectionDemandDepth: number;
  readonly functionLike: ExportedFunctionLike;
  /** Local bindings of the canonical GraphQL fragment identity helper. */
  readonly graphqlFragmentUnmaskBindings: ReadonlySet<string>;
  readonly graphqlDocumentTypeNames: ReadonlySet<string>;
  /** Local helper parameters whose returned arrays retain the original item identities. */
  readonly identityCollectionHelperParameters: ReadonlyMap<string, ReadonlySet<number>>;
  readonly localComponents: ReadonlyMap<string, LocalComponentDeclaration>;
  readonly localComponentDemandDepth: number;
  readonly localTypes: ReadonlyMap<string, LocalObjectType>;
  nodeCount: number;
  /** Source-proven registry keys that replace generic name-derived discriminator text. */
  readonly registryDiscriminantHints: ReadonlyMap<string, PreviewStaticRegistryKey>;
  root: MutableShapeNode;
  readonly sourceFile: ts.SourceFile;
}

const CLASS_COMPONENT_PROPS_ALIAS = 'this.props';

/**
 * Collects automatic prop recipes for direct exported component functions.
 *
 * Required same-file types contribute neutral leaves. Runtime usage contributes only receiver
 * containers and operation-proven kinds; an unknown final property is not invented. Existing
 * parent/setup props later overlay this lowest-priority shape in the browser runtime.
 *
 * @param sourcePath Selected JS/TS source path used only to choose parser grammar.
 * @param sourceText Current editor snapshot analyzed without module resolution.
 * @returns Deterministic export-name recipes, or an empty record after parser/budget ambiguity.
 */
export function collectReactExportPropInference(
  sourcePath: string,
  sourceText: string,
  options: PreviewPropInferenceOptions = {},
): PreviewInferredPropsByExport {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return {};
  }
  const localTypes = collectResolvableObjectTypes(sourceFile, sourcePath, options);
  const localComponents = collectLocalComponentDeclarations(sourceFile);
  const identityCollectionHelperParameters = collectIdentityCollectionHelperParameters(sourceFile);
  const registryDiscriminantHints = collectStaticRegistryDiscriminantHints(
    sourceFile,
    sourcePath,
    options,
  );
  const results: Record<string, PreviewInferredExportProps> = {};
  for (const component of collectExportedComponentFunctions(sourceFile).slice(
    0,
    MAX_COMPONENT_EXPORTS,
  )) {
    const inference = inferComponentProps(
      component,
      localTypes,
      sourceFile,
      localComponents,
      0,
      new Set([component.exportName]),
      false,
      options.childPropDemands,
      registryDiscriminantHints,
      identityCollectionHelperParameters,
    );
    if (inference !== undefined && inference.provenance.length > 0) {
      results[component.exportName] = inference;
    }
  }
  return Object.freeze(results);
}

/**
 * Collects prop recipes for exact same-file component bindings reached as JSX children.
 *
 * Render-prop data commonly crosses a local component boundary before its first collection or
 * scalar operation. Keeping this API name-bound and caller-bounded lets GraphQL/hook inference
 * carry that proven demand back without treating every private helper as a public preview export.
 */
export function collectReactLocalComponentPropInference(
  sourcePath: string,
  sourceText: string,
  componentNames: readonly string[],
  options: PreviewPropInferenceOptions = {},
): PreviewInferredPropsByExport {
  if (componentNames.length === 0) return {};
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) return {};
  const localTypes = collectResolvableObjectTypes(sourceFile, sourcePath, options);
  const declarations = collectLocalComponentDeclarations(sourceFile);
  const identityCollectionHelperParameters = collectIdentityCollectionHelperParameters(sourceFile);
  const registryDiscriminantHints = collectStaticRegistryDiscriminantHints(
    sourceFile,
    sourcePath,
    options,
  );
  const results: Record<string, PreviewInferredExportProps> = {};
  for (const componentName of [...new Set(componentNames)].slice(0, MAX_COMPONENT_EXPORTS)) {
    if (!/^\p{Lu}/u.test(componentName)) continue;
    const candidate = resolveLocalComponent(componentName, declarations);
    if (candidate === undefined) continue;
    const inference = inferComponentProps(
      { exportName: componentName, ...candidate },
      localTypes,
      sourceFile,
      declarations,
      0,
      new Set([componentName]),
      false,
      options.childPropDemands,
      registryDiscriminantHints,
      identityCollectionHelperParameters,
    );
    if (inference !== undefined && inference.provenance.length > 0) {
      results[componentName] = inference;
    }
  }
  return Object.freeze(results);
}

interface PreviewStaticRegistryImportBinding {
  readonly importedName: string;
  readonly moduleSpecifier: string;
}

interface PreviewStaticRegistryModule {
  readonly enums: ReadonlyMap<string, ts.EnumDeclaration>;
  readonly objects: ReadonlyMap<string, ts.ObjectLiteralExpression>;
  readonly values: ReadonlyMap<string, ts.Expression>;
}

/**
 * Recovers one accepted discriminator from a statically indexed label/renderer registry.
 *
 * A component that renders `StatusCopy[status]` proves that `status` must be one of the registry's
 * keys. Generic name semantics would otherwise generate `"PREVIEW"`, which is structurally valid
 * but rejected by every authored status branch. Only direct local/named-import object bindings and
 * primitive object keys participate; calls, getters, spreads, and transitive imports stay opaque.
 */
function collectStaticRegistryDiscriminantHints(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  options: PreviewPropInferenceOptions,
): ReadonlyMap<string, PreviewStaticRegistryKey> {
  const localModule = collectStaticRegistryModule(sourceFile);
  const imports = collectStaticRegistryImports(sourceFile);
  const resolvedKeys = new Map<string, PreviewStaticRegistryKey | undefined>();
  const hints = new Map<string, PreviewStaticRegistryKey>();
  const readRegistryKey = (bindingName: string): PreviewStaticRegistryKey | undefined => {
    if (resolvedKeys.has(bindingName)) return resolvedKeys.get(bindingName);
    let key = readStaticRegistryObjectFirstKey(localModule.objects.get(bindingName), localModule);
    const imported = imports.get(bindingName);
    if (key === undefined && imported !== undefined && options.resolveImport !== undefined) {
      const resolved = options.resolveImport(imported.moduleSpecifier, sourcePath);
      if (
        resolved !== undefined &&
        Buffer.byteLength(resolved.sourceText, 'utf8') <= MAX_STATIC_REGISTRY_SOURCE_BYTES
      ) {
        const importedFile = ts.createSourceFile(
          resolved.sourcePath,
          resolved.sourceText,
          ts.ScriptTarget.Latest,
          true,
          readScriptKind(resolved.sourcePath),
        );
        if (!hasParseDiagnostics(importedFile)) {
          const importedModule = collectStaticRegistryModule(importedFile);
          key = readStaticRegistryObjectFirstKey(
            importedModule.objects.get(imported.importedName),
            importedModule,
          );
        }
      }
    }
    resolvedKeys.set(bindingName, key);
    return key;
  };
  const visit = (node: ts.Node): void => {
    if (hints.size >= MAX_STATIC_REGISTRY_HINTS) return;
    if (ts.isElementAccessExpression(node)) {
      const registry = unwrapExpression(node.expression);
      const discriminant = unwrapExpression(node.argumentExpression);
      const discriminantName = ts.isIdentifier(discriminant)
        ? discriminant.text
        : ts.isPropertyAccessExpression(discriminant)
          ? discriminant.name.text
          : undefined;
      if (
        ts.isIdentifier(registry) &&
        discriminantName !== undefined &&
        !hints.has(discriminantName)
      ) {
        const key = readRegistryKey(registry.text);
        if (key !== undefined) hints.set(discriminantName, key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hints;
}

/** Indexes only top-level immutable-looking declarations used by one static registry read. */
function collectStaticRegistryModule(sourceFile: ts.SourceFile): PreviewStaticRegistryModule {
  const enums = new Map<string, ts.EnumDeclaration>();
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const values = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (ts.isEnumDeclaration(statement)) {
      enums.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = unwrapExpression(declaration.initializer);
      values.set(declaration.name.text, initializer);
      if (ts.isObjectLiteralExpression(initializer)) {
        objects.set(declaration.name.text, initializer);
      }
    }
  }
  return { enums, objects, values };
}

/** Maps direct named imports to their source binding without evaluating either module. */
function collectStaticRegistryImports(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewStaticRegistryImportBinding> {
  const imports = new Map<string, PreviewStaticRegistryImportBinding>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      imports.set(element.name.text, {
        importedName: element.propertyName?.text ?? element.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      });
    }
  }
  return imports;
}

/** Reads the first primitive object key under a fixed recursive expression budget. */
function readStaticRegistryObjectFirstKey(
  object: ts.ObjectLiteralExpression | undefined,
  module: PreviewStaticRegistryModule,
): PreviewStaticRegistryKey | undefined {
  if (object === undefined) return undefined;
  const budget = { nodes: 0 };
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) continue;
    const key = readStaticRegistryPropertyKey(property.name, module, budget);
    if (key !== undefined) return key;
  }
  return undefined;
}

/** Resolves an ordinary or computed object property name to its runtime primitive key. */
function readStaticRegistryPropertyKey(
  name: ts.PropertyName | undefined,
  module: PreviewStaticRegistryModule,
  budget: { nodes: number },
): PreviewStaticRegistryKey | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isNumericLiteral(name)) return Number(name.text);
  return ts.isComputedPropertyName(name)
    ? readStaticRegistryPrimitive(name.expression, module, budget)
    : undefined;
}

/** Resolves literals and same-module constant/enum member reads without executing project code. */
function readStaticRegistryPrimitive(
  expression: ts.Expression,
  module: PreviewStaticRegistryModule,
  budget: { nodes: number },
): PreviewStaticRegistryKey | undefined {
  if (budget.nodes >= 64) return undefined;
  budget.nodes += 1;
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrapExpression(current.operand))
  ) {
    return -Number(unwrapExpression(current.operand).getText());
  }
  if (ts.isIdentifier(current)) {
    const value = module.values.get(current.text);
    return value === undefined ? undefined : readStaticRegistryPrimitive(value, module, budget);
  }
  const member = readStaticRegistryMemberAccess(current);
  if (member === undefined) return undefined;
  const object = module.objects.get(member.ownerName);
  if (object !== undefined) {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        continue;
      }
      const key = readStaticRegistryPropertyKey(property.name, module, budget);
      if (String(key) !== member.memberName) continue;
      const value = ts.isPropertyAssignment(property)
        ? property.initializer
        : module.values.get(property.name.text);
      return value === undefined ? undefined : readStaticRegistryPrimitive(value, module, budget);
    }
  }
  const declaration = module.enums.get(member.ownerName);
  const enumMember = declaration?.members.find(
    (candidate) =>
      readStaticRegistryPropertyKey(candidate.name, module, budget) === member.memberName,
  );
  return enumMember?.initializer === undefined
    ? undefined
    : readStaticRegistryPrimitive(enumMember.initializer, module, budget);
}

/** Reads `Registry.KEY` and `Registry['KEY']` without following arbitrary access chains. */
function readStaticRegistryMemberAccess(
  expression: ts.Expression,
): { readonly memberName: string; readonly ownerName: string } | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = unwrapExpression(expression.expression);
    return ts.isIdentifier(owner)
      ? { memberName: expression.name.text, ownerName: owner.text }
      : undefined;
  }
  if (ts.isElementAccessExpression(expression)) {
    const owner = unwrapExpression(expression.expression);
    const member = unwrapExpression(expression.argumentExpression);
    return ts.isIdentifier(owner) && (ts.isStringLiteralLike(member) || ts.isNumericLiteral(member))
      ? { memberName: member.text, ownerName: owner.text }
      : undefined;
  }
  return undefined;
}

/** Resolves direct imported aliases and one re-export chain without evaluating a project module. */
function collectResolvableObjectTypes(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  options: PreviewPropInferenceOptions,
): ReadonlyMap<string, LocalObjectType> {
  const localTypes = new Map(collectLocalObjectTypes(sourceFile));
  if (options.resolveImport === undefined) return localTypes;
  const budget = { bytes: 0, modules: 0 };
  const modules = new Map<string, ResolvedObjectTypeModule | undefined>();
  for (const imported of collectResolvableObjectTypeImports(sourceFile)) {
    if (!modules.has(imported.moduleSpecifier)) {
      const module = options.resolveImport(imported.moduleSpecifier, sourcePath);
      const moduleBytes = module === undefined ? 0 : Buffer.byteLength(module.sourceText, 'utf8');
      if (
        module === undefined ||
        moduleBytes > MAX_IMPORTED_TYPE_BYTES ||
        budget.modules + 1 > MAX_IMPORTED_TYPE_MODULES ||
        budget.bytes + moduleBytes > MAX_IMPORTED_TYPE_BYTES
      ) {
        modules.set(imported.moduleSpecifier, undefined);
      } else {
        budget.modules += 1;
        budget.bytes += moduleBytes;
        const importedFile = ts.createSourceFile(
          module.sourcePath,
          module.sourceText,
          ts.ScriptTarget.Latest,
          true,
          readScriptKind(module.sourcePath),
        );
        modules.set(
          imported.moduleSpecifier,
          hasParseDiagnostics(importedFile)
            ? undefined
            : { sourceFile: importedFile, sourcePath: module.sourcePath },
        );
      }
    }
    const module = modules.get(imported.moduleSpecifier);
    if (module === undefined) continue;
    const resolved = resolveExportedObjectType(
      imported.importedName,
      module.sourceFile,
      module.sourcePath,
      options,
      new Set([sourcePath]),
      budget,
    );
    if (resolved === undefined) continue;
    const closure = collectImportedObjectTypeClosure(resolved, options, budget);
    if (closure === undefined) continue;
    const localBindingName = imported.localName;
    const declaredName = resolved.declaration.name.text;
    /*
     * An aliased import commonly wraps a same-named library contract:
     * `import { SnackbarProps as MuiSnackbarProps }` followed by a local `SnackbarProps` alias.
     * Keeping the library root under both names would collide with that authored local wrapper and
     * discard the entire otherwise unambiguous type closure. Retain only the actual local binding;
     * recursive references to the hidden canonical name then fail closed instead of binding to the
     * unrelated local wrapper.
     */
    if (localBindingName !== declaredName) closure.delete(declaredName);
    closure.set(localBindingName, resolved.declaration);
    const closureUnambiguous = [...closure].every(([name, declaration]) => {
      const existing = localTypes.get(name);
      return existing === undefined || isSameObjectTypeDeclaration(existing, declaration);
    });
    if (closureUnambiguous) {
      for (const [name, declaration] of closure) localTypes.set(name, declaration);
    }
  }
  return localTypes;
}

/** Prioritizes prop contracts, then explicit type imports, before large unrelated type graphs. */
function collectResolvableObjectTypeImports(
  sourceFile: ts.SourceFile,
): readonly ResolvableObjectTypeImport[] {
  const imports: ResolvableObjectTypeImport[] = [];
  const referencedTypeNames = new Set<string>();
  const propsDependencyNames = new Set<string>();
  const collectReferencedTypeName = (
    node: ts.Node,
    destination: Set<string> = referencedTypeNames,
  ): void => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      destination.add(node.typeName.text);
    } else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
      destination.add(node.expression.text);
    }
    ts.forEachChild(node, (child) => {
      collectReferencedTypeName(child, destination);
    });
  };
  collectReferencedTypeName(sourceFile);
  for (const [name, declaration] of collectLocalObjectTypes(sourceFile)) {
    if (/(?:^|Props?|Properties)(?:With|For|Of|$)/u.test(name)) {
      collectReferencedTypeName(declaration, propsDependencyNames);
    }
  }
  let order = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    const importClause = statement.importClause;
    if (importClause?.name !== undefined) {
      const localName = importClause.name.text;
      imports.push({
        importedName: 'default',
        localName,
        propsDependency: propsDependencyNames.has(localName),
        propsContract: /(?:^|Props?|Properties)(?:With|For|Of|$)/u.test(localName),
        moduleSpecifier: statement.moduleSpecifier.text,
        order: order++,
        typeOnly: importClause.phaseModifier === ts.SyntaxKind.TypeKeyword,
      });
    }
    const bindings = importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const importedName = (binding.propertyName ?? binding.name).text;
      imports.push({
        importedName,
        localName: binding.name.text,
        propsDependency: propsDependencyNames.has(binding.name.text),
        propsContract: /(?:^|Props?|Properties)(?:With|For|Of|$)/u.test(importedName),
        moduleSpecifier: statement.moduleSpecifier.text,
        order: order++,
        typeOnly: importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword || binding.isTypeOnly,
      });
    }
  }
  return imports
    .filter((imported) => referencedTypeNames.has(imported.localName))
    .sort(
      (left, right) =>
        Number(right.propsDependency) - Number(left.propsDependency) ||
        Number(right.propsContract) - Number(left.propsContract) ||
        Number(right.typeOnly) - Number(left.typeOnly) ||
        left.order - right.order,
    );
}

/** Resolves a directly exported declaration, including both forms of default type export. */
function resolveLocalExportedObjectType(
  exportName: string,
  sourceFile: ts.SourceFile,
): LocalObjectType | undefined {
  const localTypes = collectLocalObjectTypes(sourceFile);
  if (exportName !== 'default') {
    const declaration = localTypes.get(exportName);
    return declaration !== undefined && hasExportModifier(declaration) ? declaration : undefined;
  }
  const candidates = new Set<LocalObjectType>();
  for (const declaration of localTypes.values()) {
    if (hasExportModifier(declaration) && hasDefaultModifier(declaration)) {
      candidates.add(declaration);
    }
  }
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      const declaration = localTypes.get(statement.expression.text);
      if (declaration !== undefined) candidates.add(declaration);
    }
  }
  return candidates.size === 1 ? candidates.values().next().value : undefined;
}

/** Follows an exported object declaration through a bounded acyclic re-export chain. */
function resolveExportedObjectType(
  name: string,
  sourceFile: ts.SourceFile,
  sourcePath: string,
  options: PreviewPropInferenceOptions,
  activePaths: Set<string>,
  budget: { bytes: number; modules: number },
  depth = 0,
): ResolvedImportedObjectType | undefined {
  if (depth > 8 || activePaths.has(sourcePath)) return undefined;
  activePaths.add(sourcePath);
  const local = resolveLocalExportedObjectType(name, sourceFile);
  if (local !== undefined) {
    return { declaration: local, module: { sourceFile, sourcePath } };
  }
  const resolveReExport = (
    moduleSpecifier: string,
    exportedName: string,
  ): ResolvedImportedObjectType | undefined => {
    if (
      options.resolveImport === undefined ||
      budget.modules + 1 > MAX_IMPORTED_TYPE_MODULES ||
      budget.bytes >= MAX_IMPORTED_TYPE_BYTES
    )
      return undefined;
    const module = options.resolveImport(moduleSpecifier, sourcePath);
    const moduleBytes = module === undefined ? 0 : Buffer.byteLength(module.sourceText, 'utf8');
    if (
      module === undefined ||
      moduleBytes > MAX_IMPORTED_TYPE_BYTES ||
      budget.modules + 1 > MAX_IMPORTED_TYPE_MODULES ||
      budget.bytes + moduleBytes > MAX_IMPORTED_TYPE_BYTES
    ) {
      return undefined;
    }
    budget.modules += 1;
    budget.bytes += moduleBytes;
    const next = ts.createSourceFile(
      module.sourcePath,
      module.sourceText,
      ts.ScriptTarget.Latest,
      true,
      readScriptKind(module.sourcePath),
    );
    return hasParseDiagnostics(next)
      ? undefined
      : resolveExportedObjectType(
          exportedName,
          next,
          module.sourcePath,
          options,
          new Set(activePaths),
          budget,
          depth + 1,
        );
  };
  let starResolution: ResolvedImportedObjectType | undefined;
  let ambiguousStarResolution = false;
  const contractStem = name
    .replace(/(?:props|properties|options|config|state|type)$/iu, '')
    .toLowerCase();
  const reExports = sourceFile.statements
    .filter((statement): statement is ts.ExportDeclaration => ts.isExportDeclaration(statement))
    .map((statement, order) => {
      const namedMatch =
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((entry) => entry.name.text === name);
      const specifier =
        statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : '';
      const moduleStem = path
        .basename(specifier)
        .replace(/\.[^.]+$/u, '')
        .toLowerCase();
      const semanticStarMatch =
        statement.exportClause === undefined &&
        contractStem.length > 0 &&
        moduleStem === contractStem;
      return { order, priority: namedMatch ? 0 : semanticStarMatch ? 1 : 2, statement };
    })
    .sort((left, right) => left.priority - right.priority || left.order - right.order);
  for (const { priority, statement } of reExports) {
    if (priority > 1 && starResolution !== undefined) {
      return ambiguousStarResolution ? undefined : starResolution;
    }
    const moduleSpecifier = statement.moduleSpecifier;
    const exportClause = statement.exportClause;
    if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) continue;
    if (exportClause === undefined) {
      const resolved = resolveReExport(moduleSpecifier.text, name);
      if (resolved === undefined) continue;
      if (starResolution === undefined) {
        starResolution = resolved;
      } else if (!isSameObjectTypeDeclaration(starResolution.declaration, resolved.declaration)) {
        ambiguousStarResolution = true;
      }
      continue;
    }
    if (!ts.isNamedExports(exportClause)) continue;
    const binding = exportClause.elements.find((entry) => entry.name.text === name);
    if (binding === undefined) continue;
    const resolved = resolveReExport(
      moduleSpecifier.text,
      (binding.propertyName ?? binding.name).text,
    );
    if (resolved !== undefined) return resolved;
  }
  return ambiguousStarResolution ? undefined : starResolution;
}

/**
 * Collects object declarations reachable from one already-authorized import and its type-only
 * dependency corridor. Runtime modules are never evaluated: each direct named import is parsed with
 * the same resolver and global byte/module bounds as the root contract. Breadth-first expansion makes
 * sibling prop contracts available before a deep generic helper can consume the remaining budget.
 */
function collectImportedObjectTypeClosure(
  root: ResolvedImportedObjectType,
  options: PreviewPropInferenceOptions,
  budget: { bytes: number; modules: number },
): Map<string, LocalObjectType> | undefined {
  const closure = new Map<string, LocalObjectType>();
  const loadedModules = new Map<string, ResolvedObjectTypeModule | undefined>();
  const processed = new Set<string>();
  const pending: {
    declaration: LocalObjectType;
    depth: number;
    localName: string;
    module: ResolvedObjectTypeModule;
  }[] = [
    {
      declaration: root.declaration,
      depth: 0,
      localName: root.declaration.name.text,
      module: root.module,
    },
  ];
  const loadModule = (
    moduleSpecifier: string,
    importerPath: string,
  ): ResolvedObjectTypeModule | undefined => {
    if (options.resolveImport === undefined) return undefined;
    const key = `${importerPath}\0${moduleSpecifier}`;
    if (loadedModules.has(key)) return loadedModules.get(key);
    const loaded = options.resolveImport(moduleSpecifier, importerPath);
    const bytes = loaded === undefined ? 0 : Buffer.byteLength(loaded.sourceText, 'utf8');
    if (
      loaded === undefined ||
      bytes > MAX_IMPORTED_TYPE_BYTES ||
      budget.modules + 1 > MAX_IMPORTED_TYPE_MODULES ||
      budget.bytes + bytes > MAX_IMPORTED_TYPE_BYTES
    ) {
      loadedModules.set(key, undefined);
      return undefined;
    }
    budget.modules += 1;
    budget.bytes += bytes;
    const sourceFile = ts.createSourceFile(
      loaded.sourcePath,
      loaded.sourceText,
      ts.ScriptTarget.Latest,
      true,
      readScriptKind(loaded.sourcePath),
    );
    const module = hasParseDiagnostics(sourceFile)
      ? undefined
      : { sourceFile, sourcePath: loaded.sourcePath };
    loadedModules.set(key, module);
    return module;
  };
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    if (current.depth > MAX_INFERRED_DEPTH || closure.size >= MAX_INFERRED_NODES) return undefined;
    const identity = `${current.module.sourcePath}\0${current.declaration.name.text}\0${current.localName}`;
    if (processed.has(identity)) continue;
    processed.add(identity);
    const existing = closure.get(current.localName);
    if (existing !== undefined && !isSameObjectTypeDeclaration(existing, current.declaration)) {
      return undefined;
    }
    closure.set(current.localName, current.declaration);
    const available = collectLocalObjectTypes(current.module.sourceFile);
    const importedByLocalName = new Map<string, ResolvableObjectTypeImport>();
    const ambiguousImports = new Set<string>();
    for (const imported of collectResolvableObjectTypeImports(current.module.sourceFile)) {
      const localName = imported.localName;
      if (importedByLocalName.has(localName)) {
        importedByLocalName.delete(localName);
        ambiguousImports.add(localName);
      } else if (!ambiguousImports.has(localName)) {
        importedByLocalName.set(localName, imported);
      }
    }
    const referencedNames: string[] = [];
    const heritageReferencedNames = new Set<string>();
    const inspect = (node: ts.Node, heritage = false): void => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        referencedNames.push(node.typeName.text);
        if (heritage) heritageReferencedNames.add(node.typeName.text);
      } else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
        referencedNames.push(node.expression.text);
        if (heritage) heritageReferencedNames.add(node.expression.text);
      }
      ts.forEachChild(node, (child) => {
        inspect(child, heritage);
      });
    };
    if (ts.isInterfaceDeclaration(current.declaration)) {
      for (const heritage of current.declaration.heritageClauses ?? []) inspect(heritage, true);
      for (const member of current.declaration.members) inspect(member);
    } else {
      inspect(current.declaration.type);
    }
    for (const name of new Set(referencedNames)) {
      const local = available.get(name);
      if (local !== undefined) {
        pending.push({
          declaration: local,
          depth: current.depth + 1,
          localName: name,
          module: current.module,
        });
        continue;
      }
      const imported = importedByLocalName.get(name);
      if (imported === undefined) continue;
      const contractOwnerName = name.replace(/(?:props|properties|options|config|state)$/iu, '');
      if (
        !heritageReferencedNames.has(name) &&
        (contractOwnerName === name || !isReactOverlayComponentName(contractOwnerName))
      )
        continue;
      const module = loadModule(imported.moduleSpecifier, current.module.sourcePath);
      if (module === undefined) continue;
      const resolved = resolveExportedObjectType(
        imported.importedName,
        module.sourceFile,
        module.sourcePath,
        options,
        new Set([current.module.sourcePath]),
        budget,
      );
      if (resolved !== undefined) {
        pending.push({
          declaration: resolved.declaration,
          depth: current.depth + 1,
          localName: name,
          module: resolved.module,
        });
      }
    }
  }
  return closure;
}

/** Treats separately parsed declarations as equal only when their source identity is identical. */
function isSameObjectTypeDeclaration(left: LocalObjectType, right: LocalObjectType): boolean {
  return (
    left === right ||
    (left.kind === right.kind &&
      left.pos === right.pos &&
      left.end === right.end &&
      left.getSourceFile().fileName === right.getSourceFile().fileName)
  );
}

/** Infers local type and direct-use requirements for one component function. */
function inferComponentProps(
  component: ExportedComponentFunction,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  sourceFile: ts.SourceFile,
  localComponents: ReadonlyMap<string, LocalComponentDeclaration>,
  localComponentDemandDepth = 0,
  activeLocalComponentNames: ReadonlySet<string> = new Set([component.exportName]),
  followLocalJsxPropForwarding = false,
  childPropDemands?: PreviewChildPropDemandCatalog,
  registryDiscriminantHints: ReadonlyMap<string, PreviewStaticRegistryKey> = new Map(),
  identityCollectionHelperParameters: ReadonlyMap<string, ReadonlySet<number>> = new Map(),
): PreviewInferredExportProps | undefined {
  const { functionLike } = component;
  const parameter = functionLike.parameters[0];
  if (parameter === undefined && component.classComponentProps !== true) {
    return undefined;
  }
  const root = createMutableNode('object', 'usage');
  const state: InferenceState = {
    activeLocalComponentNames,
    allowRenderedRootScalar: false,
    aliases: new Map(),
    childPropDemands,
    collectionDemandDepth: 0,
    functionLike,
    graphqlFragmentUnmaskBindings: collectGraphqlFragmentUnmaskBindings(sourceFile),
    graphqlDocumentTypeNames: collectGraphqlDocumentTypeNames(sourceFile),
    identityCollectionHelperParameters,
    localComponents,
    localComponentDemandDepth,
    localTypes,
    nodeCount: 1,
    registryDiscriminantHints,
    root,
    sourceFile,
  };
  if (component.classComponentProps === true) {
    state.aliases.set(CLASS_COMPONENT_PROPS_ALIAS, { path: [] });
  }
  if (parameter !== undefined) {
    collectParameterBindings(parameter.name, [], state.aliases);
    addTypedParameterRequirements(
      parameter,
      component.contextualPropsType,
      localTypes,
      state,
      sourceFile,
    );
  }
  collectLocalPropAliases(functionLike, state);
  collectLocalHelperForwardedPropRequirements(functionLike, state);
  collectKeyedCollectionHelperRequirements(functionLike, state);
  collectUsageRequirements(functionLike, state);
  collectEqualityDiscriminantRequirements(functionLike, state);
  collectSwitchDiscriminantRequirements(functionLike, state);
  collectCatalogJsxForwardedPropRequirements(functionLike, state);
  if (followLocalJsxPropForwarding) {
    collectLocalJsxForwardedPropRequirements(functionLike, state);
  }
  addOverlayVisibilityRequirement(component, localTypes, state, sourceFile);
  if (state.root.children.size === 0) {
    return undefined;
  }
  return freezeInference(state.root);
}

/**
 * Carries a prop identity through an unambiguous same-file helper call.
 *
 * Components often keep render-only collection access in helpers such as
 * `createOptions(project)` or `renderUser(project)`. Direct component scanning can prove only that
 * `project` is an object in those cases. The shared helper graph follows the unchanged identifier
 * into one uniquely declared local function; that helper's ordinary usage inference then supplies
 * the missing nested Array/item contract without resolving imports or executing application code.
 */
function collectLocalHelperForwardedPropRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  if (ts.isMethodDeclaration(functionLike)) return;
  for (const demand of collectPreviewRuntimeLocalHelperArgumentDemands(
    functionLike,
    state.sourceFile,
  )) {
    const argumentPath = readPropPath(demand.argument, state.aliases);
    if (argumentPath === undefined || argumentPath.length > MAX_INFERRED_DEPTH) continue;
    const requirement = inferFunctionBindingRequirement(demand.owner, demand.parameter.name, state);
    if (requirement !== undefined) {
      mergeMutableShapeAtPath(state.root, argumentPath, requirement, state);
    }
  }
  for (const [aliasName, binding] of state.aliases) {
    for (const demand of collectPreviewRuntimeLocalHelperParameterDemands(
      functionLike,
      aliasName,
      state.sourceFile,
    )) {
      const requirement = inferFunctionBindingRequirement(
        demand.owner,
        demand.parameter.name,
        state,
      );
      if (requirement !== undefined) {
        mergeMutableShapeAtPath(state.root, binding.path, requirement, state);
      }
    }
  }
}

/**
 * Recovers the item key supplied to conventional collection helpers such as
 * `sortByNewest(project.issues, 'createdAt')`. The helper name, prop-rooted first argument, and
 * literal key must all be present; no imported helper is executed or assumed to return a value.
 */
function collectKeyedCollectionHelperRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  if (functionLike.body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (
      node !== functionLike &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      KEYED_COLLECTION_HELPER_PATTERN.test(node.expression.text)
    ) {
      const collectionArgument = node.arguments[0];
      const keyArgument = node.arguments[1];
      if (
        collectionArgument !== undefined &&
        keyArgument !== undefined &&
        !ts.isSpreadElement(collectionArgument) &&
        !ts.isSpreadElement(keyArgument)
      ) {
        const collectionPath = readPropPath(collectionArgument, state.aliases);
        const keyValue = unwrapExpression(keyArgument);
        const key = ts.isStringLiteralLike(keyValue) ? keyValue.text : undefined;
        if (
          collectionPath !== undefined &&
          collectionPath.length > 0 &&
          collectionPath.length < MAX_INFERRED_DEPTH &&
          key !== undefined &&
          !BLOCKED_PROPERTY_NAMES.has(key) &&
          !isShadowedPathRoot(collectionArgument, state)
        ) {
          const semantic = inferPreviewUsageSemanticFallback(state, key);
          const item = createMutableNode('object', 'usage');
          const property = createMutableNode(semantic?.kind ?? 'string', 'usage');
          if (semantic?.value !== undefined) property.value = semantic.value;
          if (semantic?.exactValue === true) property.exactValue = true;
          item.children.set(key, property);
          requirePath(state, collectionPath, 'array', 'usage');
          setArrayItemRequirement(state, collectionPath, item);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
}

/**
 * Materializes terminal fields read by a detached callback even when they are not rendered locally.
 * A callback supplied to `sumBy`, `groupBy`, or another collection utility consumes those leaves in
 * its caller, so retaining only their receiver containers would still produce an invalid item.
 */
function collectRequiredPropertyReadTerminals(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (isAccessExpression(node) && !isNestedAccessReceiver(node)) {
      const path_ = readPropPath(node, state.aliases);
      const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (
        !called &&
        path_ !== undefined &&
        path_.length > 0 &&
        readFirstOptionalReceiverLength(node, state.aliases) === undefined &&
        !isShadowedPathRoot(node, state) &&
        !hasPreviewInferredPropTerminal(state, path_)
      ) {
        const semantic = inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '');
        requirePath(
          state,
          path_,
          semantic?.kind ?? 'object',
          'usage',
          semantic?.value,
          semantic?.exactValue,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/**
 * Infers one runtime function parameter from its bounded, syntax-only property usage.
 * Imported collection callbacks are often intentionally untyped JavaScript helpers; this exposes
 * the same usage inference used for component props without evaluating the imported module.
 */
export function inferReactFunctionParameterUsageShape(
  functionLike: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  parameterIndex: number,
): PreviewInferredPropShape | undefined {
  if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0 || parameterIndex > 15) {
    return undefined;
  }
  const parameter = functionLike.parameters[parameterIndex];
  if (parameter === undefined || parameter.dotDotDotToken !== undefined) return undefined;
  const parentState: InferenceState = {
    activeLocalComponentNames: new Set(),
    allowRenderedRootScalar: false,
    aliases: new Map(),
    childPropDemands: undefined,
    collectionDemandDepth: 0,
    functionLike,
    graphqlFragmentUnmaskBindings: collectGraphqlFragmentUnmaskBindings(
      functionLike.getSourceFile(),
    ),
    graphqlDocumentTypeNames: collectGraphqlDocumentTypeNames(functionLike.getSourceFile()),
    identityCollectionHelperParameters: collectIdentityCollectionHelperParameters(
      functionLike.getSourceFile(),
    ),
    localComponents: collectLocalComponentDeclarations(functionLike.getSourceFile()),
    localComponentDemandDepth: 0,
    localTypes: collectLocalObjectTypes(functionLike.getSourceFile()),
    nodeCount: 1,
    registryDiscriminantHints: collectStaticRegistryDiscriminantHints(
      functionLike.getSourceFile(),
      functionLike.getSourceFile().fileName,
      {},
    ),
    root: createMutableNode('object', 'usage'),
    sourceFile: functionLike.getSourceFile(),
  };
  const requirement = inferFunctionBindingRequirement(functionLike, parameter.name, parentState);
  return requirement === undefined ? undefined : freezeInference(requirement).shape;
}

/**
 * Gives a directly previewed overlay its one visible state while retaining authored/user priority.
 * Exact visibility bindings win. A rest wrapper is admitted when an overlay-named component's
 * resolved contract proves one direct or nested visibility path; a bare untyped spread cannot prove
 * whether a project uses `show`, `open`, or another API. The inferred `usage` provenance keeps this
 * generated value visible and editable in Page Inspector rather than changing project source.
 */
function addOverlayVisibilityRequirement(
  component: ExportedComponentFunction,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
): void {
  const functionLike = component.functionLike;
  if (component.classComponentProps === true || ts.isMethodDeclaration(functionLike)) return;
  const directPropName = inferReactOverlayVisibilityProp(functionLike, component.exportName);
  const visibilityPath =
    directPropName === undefined
      ? inferReactOverlayVisibilityTypePath(
          functionLike,
          component.exportName,
          component.contextualPropsType,
          sourceFile,
          localTypes,
        )
      : [directPropName];
  if (visibilityPath !== undefined) {
    requirePath(state, visibilityPath, 'boolean', 'usage', true, true);
  }
}

/** Maps destructured/local prop bindings to their external root property paths. */
function collectParameterBindings(
  bindingName: ts.BindingName,
  parentPath: readonly string[],
  aliases: Map<string, PropPathBinding>,
): void {
  if (ts.isIdentifier(bindingName)) {
    aliases.set(bindingName.text, { path: parentPath });
    return;
  }
  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element) || element.initializer !== undefined) continue;
    const propertyName = readBindingPropertyName(element);
    if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
    collectParameterBindings(element.name, [...parentPath, propertyName], aliases);
  }
}

/** Adds syntax-resolvable required prop types while imported/any contracts remain usage-driven. */
function addTypedParameterRequirements(
  parameter: ts.ParameterDeclaration,
  contextualPropsType: ts.TypeNode | undefined,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
): void {
  const propsType = parameter.type ?? contextualPropsType;
  if (propsType === undefined) return;
  const members = readObjectTypeMembers(propsType, localTypes, new Set());
  if (members === undefined) return;
  const typeByProperty = new Map<string, ts.TypeNode>();
  for (const member of members) {
    if (
      !ts.isPropertySignature(member) ||
      member.questionToken !== undefined ||
      member.type === undefined
    ) {
      continue;
    }
    const name = readPropertyName(member.name);
    if (name !== undefined && !typeByProperty.has(name)) typeByProperty.set(name, member.type);
  }
  if (ts.isIdentifier(parameter.name)) {
    for (const [propertyName, typeNode] of typeByProperty) {
      addTypeRequirement([propertyName], typeNode, localTypes, state, sourceFile, new Set());
    }
    return;
  }
  if (!ts.isObjectBindingPattern(parameter.name)) return;
  for (const element of parameter.name.elements) {
    if (ts.isOmittedExpression(element) || element.initializer !== undefined) continue;
    const propertyName = readBindingPropertyName(element);
    const typeNode = propertyName === undefined ? undefined : typeByProperty.get(propertyName);
    if (propertyName === undefined || typeNode === undefined) continue;
    addTypeRequirement([propertyName], typeNode, localTypes, state, sourceFile, new Set());
  }
}

/** Resolves required members from one inline or same-file non-generic object declaration. */
function readObjectTypeMembers(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  resolutionStack: Set<string>,
  substitutions: ReadonlyMap<string, ts.TypeNode> = new Map(),
): readonly ts.TypeElement[] | undefined {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isTypeLiteralNode(unwrapped)) return unwrapped.members;
  if (ts.isIntersectionTypeNode(unwrapped)) {
    const members = unwrapped.types.flatMap(
      (member) => readObjectTypeMembers(member, localTypes, resolutionStack, substitutions) ?? [],
    );
    return members.length > 0 ? members : undefined;
  }
  const reference =
    ts.isTypeReferenceNode(unwrapped) && ts.isIdentifier(unwrapped.typeName)
      ? { name: unwrapped.typeName.text, typeArguments: unwrapped.typeArguments }
      : ts.isExpressionWithTypeArguments(unwrapped) && ts.isIdentifier(unwrapped.expression)
        ? { name: unwrapped.expression.text, typeArguments: unwrapped.typeArguments }
        : undefined;
  if (reference === undefined) return undefined;
  const { name } = reference;
  const substituted = substitutions.get(name);
  if (substituted !== undefined) {
    return readObjectTypeMembers(substituted, localTypes, resolutionStack, substitutions);
  }
  if (
    (name === 'PropsWithChildren' || name === 'Readonly' || name === 'Required') &&
    reference.typeArguments?.[0] !== undefined
  ) {
    return readObjectTypeMembers(
      reference.typeArguments[0],
      localTypes,
      resolutionStack,
      substitutions,
    );
  }
  const declaration = localTypes.get(name);
  if (declaration === undefined || resolutionStack.has(name)) return undefined;
  resolutionStack.add(name);
  try {
    const typeParameters = declaration.typeParameters;
    const typeArguments = reference.typeArguments;
    if (typeParameters !== undefined && typeParameters.length !== typeArguments?.length) {
      return undefined;
    }
    const nestedSubstitutions = new Map(substitutions);
    for (const [index, parameter] of (typeParameters ?? []).entries()) {
      const argument = typeArguments?.[index];
      if (argument === undefined) return undefined;
      nestedSubstitutions.set(parameter.name.text, argument);
    }
    const members = ts.isInterfaceDeclaration(declaration)
      ? [
          ...declaration.members,
          ...(declaration.heritageClauses ?? []).flatMap((clause) =>
            clause.types.flatMap(
              (heritageType) =>
                readObjectTypeMembers(
                  heritageType,
                  localTypes,
                  resolutionStack,
                  nestedSubstitutions,
                ) ?? [],
            ),
          ),
        ]
      : readObjectTypeMembers(declaration.type, localTypes, resolutionStack, nestedSubstitutions);
    return members;
  } finally {
    resolutionStack.delete(name);
  }
}

/** Converts a safe local type into one neutral shape requirement, recursively when object-shaped. */
function addTypeRequirement(
  path_: readonly string[],
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  activeNames: Set<string>,
  depthOffset = 0,
): void {
  if (depthOffset + path_.length > MAX_INFERRED_DEPTH) return;
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (
    ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    state.graphqlDocumentTypeNames.has(unwrapped.typeName.text)
  ) {
    addGraphqlDocumentRequirement(path_, unwrapped, localTypes, state, sourceFile, depthOffset);
    return;
  }
  if (unwrapped.kind === ts.SyntaxKind.StringKeyword) {
    requirePath(state, path_, 'string', 'type');
    return;
  }
  if (
    unwrapped.kind === ts.SyntaxKind.NumberKeyword ||
    unwrapped.kind === ts.SyntaxKind.BigIntKeyword
  ) {
    requirePath(state, path_, 'number', 'type');
    return;
  }
  if (unwrapped.kind === ts.SyntaxKind.BooleanKeyword) {
    /* A required-state flag on a generated row describes which valid UI variant to show, not an
     * action to perform. Prefer the affirmative representative so required markers/fields are not
     * permanently hidden behind the otherwise neutral false value. */
    const propertyName = path_.at(-1)?.toLowerCase();
    requirePath(
      state,
      path_,
      'boolean',
      'type',
      propertyName === 'isrequired' || propertyName === 'required' ? true : undefined,
    );
    return;
  }
  if (ts.isArrayTypeNode(unwrapped) || ts.isTupleTypeNode(unwrapped)) {
    requirePath(state, path_, 'array', 'type');
    const elementType = ts.isArrayTypeNode(unwrapped)
      ? unwrapped.elementType
      : unwrapped.elements[0];
    if (elementType !== undefined) {
      setArrayItemRequirement(
        state,
        path_,
        createTypeShape(
          elementType,
          localTypes,
          state,
          sourceFile,
          activeNames,
          depthOffset + path_.length,
        ),
      );
    }
    return;
  }
  if (ts.isFunctionTypeNode(unwrapped)) {
    requirePath(state, path_, 'function', 'type');
    return;
  }
  if (isReactElementValueTypeSyntax(unwrapped)) {
    requirePath(state, path_, 'element', 'type');
    return;
  }
  if (isReactComponentTypeSyntax(unwrapped)) {
    requirePath(state, path_, 'component', 'type');
    return;
  }
  if (ts.isLiteralTypeNode(unwrapped)) {
    const literal = readLiteralValue(unwrapped.literal);
    if (typeof literal === 'string') requirePath(state, path_, 'string', 'type', literal, true);
    else if (typeof literal === 'number')
      requirePath(state, path_, 'number', 'type', literal, true);
    else if (typeof literal === 'boolean')
      requirePath(state, path_, 'boolean', 'type', literal, true);
    return;
  }
  if (ts.isUnionTypeNode(unwrapped)) {
    const members = unwrapped.types.filter((candidate) => !isNullishTypeNode(candidate));
    if (members.length > 0 && members.every(isPreviewCollectionTypeNode)) {
      requirePath(state, path_, 'array', 'type');
      const itemShapes = members
        .map((member) => readPreviewCollectionElementType(member))
        .filter((member): member is ts.TypeNode => member !== undefined)
        .map((member) =>
          createTypeShape(
            member,
            localTypes,
            state,
            sourceFile,
            activeNames,
            depthOffset + path_.length,
          ),
        )
        .filter((shape): shape is MutableShapeNode => shape?.kind === 'object');
      if (itemShapes.length === 1) setArrayItemRequirement(state, path_, itemShapes[0]);
      return;
    }
    if (members.length === 1) {
      const member = members[0];
      if (member === undefined) return;
      addTypeRequirement(path_, member, localTypes, state, sourceFile, activeNames, depthOffset);
      return;
    }
    const representative = selectDiscriminatedObjectUnionMember(members, localTypes);
    if (representative !== undefined) {
      addTypeRequirement(
        path_,
        representative,
        localTypes,
        state,
        sourceFile,
        activeNames,
        depthOffset,
      );
    }
    return;
  }
  if (
    ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    (unwrapped.typeName.text === 'Array' || unwrapped.typeName.text === 'ReadonlyArray')
  ) {
    requirePath(state, path_, 'array', 'type');
    const elementType = unwrapped.typeArguments?.[0];
    if (elementType !== undefined) {
      setArrayItemRequirement(
        state,
        path_,
        createTypeShape(
          elementType,
          localTypes,
          state,
          sourceFile,
          activeNames,
          depthOffset + path_.length,
        ),
      );
    }
    return;
  }
  if (
    ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    unwrapped.typeName.text === 'Record'
  ) {
    /* Record keys may be an unbounded string domain, so invent no entries. The empty plain object
     * still satisfies Object.keys/values/entries and dynamic lookup contracts without guessing
     * application data. */
    requirePath(state, path_, 'object', 'type');
    return;
  }
  if (ts.isMappedTypeNode(unwrapped)) {
    /* A mapped key domain is no safer to populate than Record, but the mapped value still proves
     * that the required prop itself is an object. Materialize an empty plain object so consumers
     * such as Object.entries(config) remain executable without inventing application keys. */
    requirePath(state, path_, 'object', 'type');
    return;
  }
  if (ts.isTypeReferenceNode(unwrapped) && ts.isIdentifier(unwrapped.typeName)) {
    const aliasName = unwrapped.typeName.text;
    const alias = localTypes.get(aliasName);
    if (alias !== undefined && ts.isTypeAliasDeclaration(alias)) {
      if (activeNames.has(aliasName)) return;
      activeNames.add(aliasName);
      try {
        addTypeRequirement(
          path_,
          alias.type,
          localTypes,
          state,
          sourceFile,
          activeNames,
          depthOffset,
        );
      } finally {
        activeNames.delete(aliasName);
      }
      return;
    }
  }
  const activeName =
    ts.isTypeReferenceNode(unwrapped) && ts.isIdentifier(unwrapped.typeName)
      ? unwrapped.typeName.text
      : undefined;
  if (activeName !== undefined && activeNames.has(activeName)) return;
  if (activeName !== undefined) activeNames.add(activeName);
  try {
    const members = readObjectTypeMembers(unwrapped, localTypes, new Set());
    if (members === undefined) return;
    requirePath(state, path_, 'object', 'type');
    for (const member of members) {
      if (
        !ts.isPropertySignature(member) ||
        member.questionToken !== undefined ||
        member.type === undefined
      )
        continue;
      const propertyName = readPropertyName(member.name);
      if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
      addTypeRequirement(
        [...path_, propertyName],
        member.type,
        localTypes,
        state,
        sourceFile,
        activeNames,
        depthOffset,
      );
    }
  } finally {
    if (activeName !== undefined) activeNames.delete(activeName);
  }
}

/** Recognizes required React-node values without resolving or executing a library type graph. */
function isReactElementValueTypeSyntax(typeNode: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(typeNode)) {
    const rightmostName = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : typeNode.typeName.right.text;
    if (rightmostName === 'ReactElement' || rightmostName === 'ReactNode') return true;
    if (
      rightmostName === 'Element' &&
      ts.isQualifiedName(typeNode.typeName) &&
      ts.isIdentifier(typeNode.typeName.left) &&
      typeNode.typeName.left.text === 'JSX'
    ) {
      return true;
    }
  }
  if (!ts.isIndexedAccessTypeNode(typeNode) || !ts.isLiteralTypeNode(typeNode.indexType)) {
    return false;
  }
  const key = readLiteralValue(typeNode.indexType.literal);
  if (key !== 'children' || !ts.isTypeReferenceNode(typeNode.objectType)) return false;
  const rightmostName = ts.isIdentifier(typeNode.objectType.typeName)
    ? typeNode.objectType.typeName.text
    : typeNode.objectType.typeName.right.text;
  return (
    rightmostName === 'ComponentProps' ||
    rightmostName === 'ComponentPropsWithRef' ||
    rightmostName === 'ComponentPropsWithoutRef'
  );
}

/** Admits only canonical GraphQL document imports, including a directly named local alias. */
function collectGraphqlDocumentTypeNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    if (!/^@apollo\/client(?:\/|$)/u.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const importedName = (binding.propertyName ?? binding.name).text;
      if (importedName === 'DocumentNode' || importedName === 'TypedDocumentNode') {
        names.add(binding.name.text);
      }
    }
  }
  return names;
}

/** Finds only the named GraphQL Code Generator fragment-masking identity helper import. */
function collectGraphqlFragmentUnmaskBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !/(?:^|\/)graphql-codegen\/fragment-masking$/u.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      if ((binding.propertyName ?? binding.name).text === 'getFragmentData') {
        names.add(binding.name.text);
      }
    }
  }
  return names;
}

/** Creates a minimum executable GraphQL document from canonical type evidence and response shape. */
function addGraphqlDocumentRequirement(
  path_: readonly string[],
  typeReference: ts.TypeReferenceNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  depthOffset: number,
): void {
  const operation = readGraphqlOperation(path_);
  if (operation === undefined || typeReference.typeArguments?.[0] === undefined) return;
  requirePath(state, path_, 'graphql-document', 'type');
  const document = readMutablePathNode(state, path_);
  if (document?.kind !== 'graphql-document') return;
  const response = createTypeShape(
    typeReference.typeArguments[0],
    localTypes,
    state,
    sourceFile,
    new Set(),
    depthOffset + path_.length,
  );
  if (response?.kind === 'object') {
    for (const [name, child] of response.children) document.children.set(name, child);
  }
  // Keep a neutral valid leaf even when the response type cannot be resolved.
  if (!document.children.has('__typename')) {
    document.children.set('__typename', createMutableNode('string', 'type'));
  }
  document.value = operation;
}

/** Requires a non-conflicting authored query/mutation marker in addition to canonical type evidence. */
function readGraphqlOperation(path_: readonly string[]): 'mutation' | 'query' | undefined {
  const name = path_.at(-1) ?? '';
  const query = /query/iu.test(name);
  const mutation = /mutation/iu.test(name);
  return query === mutation ? undefined : query ? 'query' : 'mutation';
}

/** Reads one previously materialized node without widening paths or bypassing safe-name checks. */
function readMutablePathNode(
  state: InferenceState,
  path_: readonly string[],
): MutableShapeNode | undefined {
  let node = state.root;
  for (const name of path_) {
    const child = node.children.get(name);
    if (child === undefined) return undefined;
    node = child;
  }
  return node;
}

/**
 * Selects the first authored branch only when every object branch proves a shared literal tag.
 *
 * A discriminated union has multiple valid runtime representatives but omitting the whole prop is
 * never one of them. Requiring a common literal field keeps this choice bounded and avoids
 * guessing through ordinary unions whose branches carry unrelated application semantics.
 */
function selectDiscriminatedObjectUnionMember(
  members: readonly ts.TypeNode[],
  localTypes: ReadonlyMap<string, LocalObjectType>,
): ts.TypeNode | undefined {
  if (members.length < 2) return undefined;
  const objectMembers = members.map((member) =>
    readObjectTypeMembers(member, localTypes, new Set()),
  );
  if (objectMembers.some((member) => member === undefined)) return undefined;
  const first = objectMembers[0];
  if (first === undefined) return undefined;
  for (const candidate of first) {
    if (
      !ts.isPropertySignature(candidate) ||
      candidate.questionToken !== undefined ||
      candidate.type === undefined ||
      !ts.isLiteralTypeNode(candidate.type)
    ) {
      continue;
    }
    const propertyName = readPropertyName(candidate.name);
    const firstLiteral = readLiteralValue(candidate.type.literal);
    if (propertyName === undefined || firstLiteral === undefined) continue;
    const literals = objectMembers.map((member) => {
      const property = member?.find(
        (entry) =>
          ts.isPropertySignature(entry) &&
          entry.questionToken === undefined &&
          readPropertyName(entry.name) === propertyName,
      );
      return property !== undefined &&
        ts.isPropertySignature(property) &&
        property.type !== undefined &&
        ts.isLiteralTypeNode(property.type)
        ? readLiteralValue(property.type.literal)
        : undefined;
    });
    if (
      literals.every((literal) => literal !== undefined) &&
      new Set(literals.map((literal) => `${typeof literal}:${String(literal)}`)).size > 1
    ) {
      return members[0];
    }
  }
  return undefined;
}

/** Removes only nullish union branches; other alternatives remain ambiguous and fail closed. */
function isNullishTypeNode(node: ts.TypeNode): boolean {
  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword
  )
    return true;
  return (
    ts.isLiteralTypeNode(node) &&
    (node.literal.kind === ts.SyntaxKind.NullKeyword ||
      node.literal.kind === ts.SyntaxKind.UndefinedKeyword)
  );
}

/** Reports an array-like type branch without resolving or executing imported declarations. */
function isPreviewCollectionTypeNode(node: ts.TypeNode): boolean {
  const unwrapped = ts.isParenthesizedTypeNode(node) ? node.type : node;
  return (
    ts.isArrayTypeNode(unwrapped) ||
    ts.isTupleTypeNode(unwrapped) ||
    (ts.isTypeReferenceNode(unwrapped) &&
      ts.isIdentifier(unwrapped.typeName) &&
      (unwrapped.typeName.text === 'Array' || unwrapped.typeName.text === 'ReadonlyArray'))
  );
}

/** Reads the one direct item annotation of a safe array branch without evaluating generic values. */
function readPreviewCollectionElementType(node: ts.TypeNode): ts.TypeNode | undefined {
  const unwrapped = ts.isParenthesizedTypeNode(node) ? node.type : node;
  if (ts.isArrayTypeNode(unwrapped)) return unwrapped.elementType;
  if (ts.isTupleTypeNode(unwrapped)) return unwrapped.elements[0];
  return ts.isTypeReferenceNode(unwrapped) &&
    ts.isIdentifier(unwrapped.typeName) &&
    (unwrapped.typeName.text === 'Array' || unwrapped.typeName.text === 'ReadonlyArray')
    ? unwrapped.typeArguments?.[0]
    : undefined;
}

/**
 * Selects the direct object branch of a grouped collection item such as `(Row | Row[])[]`.
 *
 * Both branches are valid authored values, but materializing the nested-array branch would require
 * recursively inventing grouping semantics. A unique resolvable object plus only collection
 * alternatives has one bounded, type-valid representative: the direct object.
 */
function selectPreviewCollectionItemType(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
): ts.TypeNode {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (!ts.isUnionTypeNode(unwrapped)) return typeNode;
  const members = unwrapped.types.filter((candidate) => !isNullishTypeNode(candidate));
  const objectMembers = members.filter(
    (member) => readObjectTypeMembers(member, localTypes, new Set()) !== undefined,
  );
  if (objectMembers.length !== 1) return typeNode;
  const objectMember = objectMembers[0];
  if (
    objectMember === undefined ||
    members.some((member) => member !== objectMember && !isPreviewCollectionTypeNode(member))
  )
    return typeNode;
  return objectMember;
}

/** Builds one fail-closed, parse-only element shape for a statically known collection. */
function createTypeShape(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalObjectType>,
  state: InferenceState,
  sourceFile: ts.SourceFile,
  activeNames: Set<string>,
  depthOffset: number,
): MutableShapeNode | undefined {
  // The detached item root consumes one level of the caller's already-used aggregate corridor;
  // it must not restart at an apparent top-level `value` path for nested collection evidence.
  if (state.nodeCount >= MAX_INFERRED_NODES) return undefined;
  const selectedTypeNode = selectPreviewCollectionItemType(typeNode, localTypes);
  const root = createMutableNode('object', 'type');
  const previousRoot = state.root;
  state.root = root;
  try {
    addTypeRequirement(
      ['value'],
      selectedTypeNode,
      localTypes,
      state,
      sourceFile,
      activeNames,
      depthOffset,
    );
  } finally {
    state.root = previousRoot;
  }
  return root.children.get('value');
}

/** Associates a proven element shape with an existing inferred Array path without widening it. */
function setArrayItemRequirement(
  state: InferenceState,
  path_: readonly string[],
  items: MutableShapeNode | undefined,
): void {
  let node = state.root;
  for (const name of path_) {
    const next = node.children.get(name);
    if (next === undefined) return;
    node = next;
  }
  if (node.kind !== 'array') return;
  /*
   * Object readers prove structured rows. A string/number root is equally strong only when the
   * callback rendered it or direct iterable destructuring consumes a type-proven item. Retaining
   * those cases prevents both invalid Smart-fill records and empty arrays that defeat `[first]`.
   */
  if (
    items === undefined ||
    (items.kind !== 'object' &&
      !(
        (items.renderedValue === true || (node.itemConsumed === true && items.source === 'type')) &&
        (items.kind === 'number' || items.kind === 'string')
      ))
  ) {
    return;
  }
  if (node.items === undefined) node.items = items;
  else mergeMutableShapeRequirement(node.items, items);
}

/** Merges independently proven callback-item branches without replacing incompatible evidence. */
function mergeMutableShapeRequirement(target: MutableShapeNode, source: MutableShapeNode): void {
  mergeNodeKind(target, source.kind, source.source, source.value, source.exactValue);
  if (target.kind !== source.kind) return;
  if (source.itemConsumed === true) target.itemConsumed = true;
  if (source.renderedValue === true) target.renderedValue = true;
  if (source.source === 'type') target.source = 'type';
  if (source.value !== undefined) target.value = source.value;
  if (source.exactValue === true) target.exactValue = true;
  for (const [name, child] of source.children) {
    const existing = target.children.get(name);
    if (existing === undefined) target.children.set(name, child);
    else mergeMutableShapeRequirement(existing, child);
  }
  if (source.items !== undefined) {
    if (target.items === undefined) target.items = source.items;
    else mergeMutableShapeRequirement(target.items, source.items);
  }
}

/** Merges an already-inferred mutable requirement beneath one prop-rooted alias path. */
function mergeMutableShapeAtPath(
  root: MutableShapeNode,
  path_: readonly string[],
  requirement: MutableShapeNode,
  state: InferenceState,
): void {
  let current = root;
  for (const propertyName of path_) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) return;
    let child = current.children.get(propertyName);
    if (child === undefined) {
      if (state.nodeCount >= MAX_INFERRED_NODES) return;
      state.nodeCount += 1;
      child = createMutableNode('object', 'usage');
      current.children.set(propertyName, child);
    }
    current = child;
  }
  mergeMutableShapeRequirement(current, requirement);
}

/** Finds local helpers whose result keeps every returned item from one Array parameter unchanged. */
function collectIdentityCollectionHelperParameters(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ReadonlySet<number>> {
  const candidates = new Map<string, ExportedFunctionLike[]>();
  const append = (name: string, functionLike: ExportedFunctionLike): void => {
    const values = candidates.get(name) ?? [];
    values.push(functionLike);
    candidates.set(name, values);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      append(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        append(node.name.text, initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const result = new Map<string, ReadonlySet<number>>();
  for (const [name, declarations] of candidates) {
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (declaration === undefined) continue;
    const parameters = new Set<number>();
    for (const [index, parameter] of declaration.parameters.entries()) {
      if (
        ts.isIdentifier(parameter.name) &&
        doesLocalHelperReturnIdentityCollection(declaration, parameter.name.text)
      ) {
        parameters.add(index);
      }
    }
    if (parameters.size > 0) result.set(name, parameters);
  }
  return result;
}

/** Accepts only direct filter/sort/slice chains and aliases rooted in the selected parameter. */
function doesLocalHelperReturnIdentityCollection(
  functionLike: ExportedFunctionLike,
  parameterName: string,
): boolean {
  const body = functionLike.body;
  if (body === undefined) return false;
  const aliases = new Set([parameterName]);
  if (!ts.isBlock(body)) return isIdentityCollectionCarrier(body, aliases);
  const returnState = { returned: false, unsupported: false };
  const visit = (node: ts.Node): void => {
    if (
      node !== body &&
      (ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      if (isIdentityCollectionCarrier(node.initializer, aliases)) aliases.add(node.name.text);
      else aliases.delete(node.name.text);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(unwrapExpression(node.left))
    ) {
      const name = (unwrapExpression(node.left) as ts.Identifier).text;
      if (isIdentityCollectionCarrier(node.right, aliases)) aliases.add(name);
      else aliases.delete(name);
    } else if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined && isIdentityCollectionCarrier(node.expression, aliases)) {
        returnState.returned = true;
      } else {
        returnState.unsupported = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return returnState.returned && !returnState.unsupported;
}

/** Reports an expression whose Array transforms cannot replace or reshape its items. */
function isIdentityCollectionCarrier(
  expression: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return aliases.has(current.text);
  if (!ts.isCallExpression(current)) return false;
  const callee = unwrapExpression(current.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    LOCAL_HELPER_ITEM_IDENTITY_METHOD_NAMES.has(callee.name.text) &&
    isIdentityCollectionCarrier(callee.expression, aliases)
  );
}

/** Carries a prop Array path through one proven same-file identity-preserving helper call. */
function readIdentityCollectionHelperCallPath(
  expression: ts.Expression,
  state: InferenceState,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (!ts.isCallExpression(current)) return undefined;
  const callee = unwrapExpression(current.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const parameterIndexes = state.identityCollectionHelperParameters.get(callee.text);
  if (parameterIndexes === undefined) return undefined;
  for (const parameterIndex of parameterIndexes) {
    const argument = current.arguments[parameterIndex];
    if (argument === undefined || ts.isSpreadElement(argument)) continue;
    const path_ =
      readPropPath(argument, state.aliases) ??
      readIdentityCollectionHelperCallPath(argument, state);
    if (path_ !== undefined) return path_;
  }
  return undefined;
}

/** Collects simple local aliases before evaluating later receiver paths in callbacks and JSX. */
function collectLocalPropAliases(functionLike: ExportedFunctionLike, state: InferenceState): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const sourcePath =
        readPropPath(node.initializer, state.aliases) ??
        readEmptyCollectionDefaultPropPath(node.initializer, state.aliases) ??
        readIdentityCollectionHelperCallPath(node.initializer, state) ??
        readGraphqlFragmentUnmaskCallPath(node.initializer, state);
      if (sourcePath !== undefined) {
        if (ts.isIdentifier(node.name)) {
          state.aliases.set(node.name.text, { path: sourcePath });
        } else if (ts.isObjectBindingPattern(node.name)) {
          /* Object binding throws for a nullish receiver even when every bound leaf is only
           * forwarded opaquely. Retain the prop-derived container before mapping its aliases so a
           * direct preview can execute chains such as `const { ir: irInfo } = object` followed by
           * another destructure or child-prop forwarding. */
          if (!isInsideNestedFunction(node, state.functionLike)) {
            requirePath(state, sourcePath, 'object', 'usage');
          }
          for (const element of node.name.elements) {
            const propertyName = readBindingPropertyName(element);
            if (
              propertyName !== undefined &&
              !BLOCKED_PROPERTY_NAMES.has(propertyName) &&
              ts.isIdentifier(element.name)
            ) {
              state.aliases.set(element.name.text, { path: [...sourcePath, propertyName] });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/**
 * Carries a generated GraphQL fragment value through the canonical masking helper.
 *
 * `getFragmentData(document, value)` is a compile-time masking boundary whose runtime result is
 * the same response object. Accept only its direct imported binding and second argument so an
 * unrelated two-argument helper can never be treated as an identity transform.
 */
function readGraphqlFragmentUnmaskCallPath(
  expression: ts.Expression,
  state: InferenceState,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (
    !ts.isCallExpression(current) ||
    !ts.isIdentifier(current.expression) ||
    !state.graphqlFragmentUnmaskBindings.has(current.expression.text) ||
    current.arguments.length < 2
  ) {
    return undefined;
  }
  const value = current.arguments[1];
  if (value === undefined || ts.isSpreadElement(value)) return undefined;
  return readPropPath(value, state.aliases);
}

/** Derives receiver containers and operation kinds from property paths rooted in known props. */
function collectUsageRequirements(functionLike: ExportedFunctionLike, state: InferenceState): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const collectReceivers = (node: ts.Node): void => {
    if (isAccessExpression(node) && !isNestedAccessReceiver(node)) {
      const path_ = readPropPath(node, state.aliases);
      if (path_ !== undefined && path_.length > 0 && !isShadowedPathRoot(node, state)) {
        const optionalReceiverLength = readFirstOptionalReceiverLength(node, state.aliases);
        addReceiverContainers(state, path_, optionalReceiverLength ?? path_.length);
      }
    }
    ts.forEachChild(node, collectReceivers);
  };
  const collectOperations = (node: ts.Node): void => {
    if (isAccessExpression(node) && !isNestedAccessReceiver(node)) {
      const path_ = readPropPath(node, state.aliases);
      if (path_ !== undefined && path_.length > 0 && !isShadowedPathRoot(node, state)) {
        const optionalReceiverLength = readFirstOptionalReceiverLength(node, state.aliases);
        if (optionalReceiverLength === undefined) addOperationRequirement(state, path_, node);
      }
    } else if (ts.isIdentifier(node)) {
      const binding = state.aliases.get(node.text);
      if (
        binding !== undefined &&
        binding.path.length > 0 &&
        !isIdentifierPartOfAccess(node) &&
        !isDeclarationName(node) &&
        !isShadowedIdentifier(node, node.text, state.functionLike)
      ) {
        addOperationRequirement(state, binding.path, node);
      }
    }
    ts.forEachChild(node, collectOperations);
  };
  collectReceivers(body);
  collectOperations(body);
  collectArrayCallbackItemRequirements(body, state);
}

/** Carries collection-callback field demand into the owning prop Array's generated item shape. */
function collectArrayCallbackItemRequirements(body: ts.ConciseBody, state: InferenceState): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.questionDotToken === undefined &&
      ARRAY_ITEM_CALLBACK_METHOD_NAMES.has(node.expression.name.text)
    ) {
      const receiver = readCollectionCarrierPropPath(node.expression.expression, state.aliases);
      const callbackArgument = node.arguments[0];
      const callback =
        callbackArgument === undefined || ts.isSpreadElement(callbackArgument)
          ? undefined
          : unwrapExpression(callbackArgument);
      if (
        receiver !== undefined &&
        !isShadowedPathRoot(receiver.expression, state) &&
        callback !== undefined &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        requirePath(state, receiver.path, 'array', 'usage');
        setArrayItemRequirement(
          state,
          receiver.path,
          inferArrayCallbackItemRequirement(
            callback,
            state,
            ARRAY_ITEM_CALLBACK_PARAMETER_INDEX.get(node.expression.name.text) ?? 0,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Reads a prop collection through bounded transforms that preserve every item's identity. */
function readCollectionCarrierPropPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): Readonly<{ expression: ts.Expression; path: readonly string[] }> | undefined {
  let current = unwrapExpression(expression);
  for (let depth = 0; ts.isCallExpression(current) && depth < 8; depth += 1) {
    if (current.questionDotToken !== undefined) return undefined;
    const callee = unwrapExpression(current.expression);
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.questionDotToken !== undefined ||
      !ARRAY_ITEM_IDENTITY_METHOD_NAMES.has(callee.name.text)
    ) {
      return undefined;
    }
    current = unwrapExpression(callee.expression);
  }
  const path_ = readPropPath(current, aliases);
  return path_ === undefined ? undefined : { expression: current, path: path_ };
}

/** Infers one callback parameter in isolation, retaining recursively nested collection demand. */
function inferArrayCallbackItemRequirement(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  parentState: InferenceState,
  itemParameterIndex = 0,
): MutableShapeNode | undefined {
  const parameter = callback.parameters[itemParameterIndex];
  if (
    parameter === undefined ||
    parameter.dotDotDotToken !== undefined ||
    parentState.collectionDemandDepth >= 8
  ) {
    return undefined;
  }
  let combined = inferFunctionBindingRequirement(callback, parameter.name, parentState, true);
  if (ts.isIdentifier(parameter.name)) {
    for (const demand of collectPreviewRuntimeLocalHelperParameterDemands(
      callback,
      parameter.name.text,
      callback.getSourceFile(),
    )) {
      const helper = inferFunctionBindingRequirement(
        demand.owner,
        demand.parameter.name,
        parentState,
        true,
      );
      if (helper === undefined) continue;
      if (combined === undefined) combined = helper;
      else mergeMutableShapeRequirement(combined, helper);
    }
  }
  const forwarded = inferLocalJsxForwardedItemRequirement(callback, parameter.name, parentState);
  if (forwarded !== undefined) {
    if (combined === undefined) combined = forwarded;
    else mergeMutableShapeRequirement(combined, forwarded);
  }
  return combined;
}

/** Carries an array item into the exact prop contract of a local or catalogued JSX child. */
function inferLocalJsxForwardedItemRequirement(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  binding: ts.BindingName,
  parentState: InferenceState,
): MutableShapeNode | undefined {
  if (parentState.localComponentDemandDepth >= 8) return undefined;
  const aliases = new Map<string, PropPathBinding>();
  collectParameterBindings(binding, [], aliases);
  const aliasState: InferenceState = {
    ...parentState,
    aliases,
    collectionDemandDepth: parentState.collectionDemandDepth + 1,
    functionLike: callback,
    root: createMutableNode('object', 'usage'),
  };
  collectLocalPropAliases(callback, aliasState);
  const root = createMutableNode('object', 'usage');
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined
    ) {
      const opening = node.parent.parent;
      const tagName =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        ts.isIdentifier(opening.tagName)
          ? opening.tagName.text
          : undefined;
      const path_ = readPropPath(node.initializer.expression, aliases);
      const identity = tagName === undefined ? undefined : `${tagName}\0${node.name.text}`;
      if (
        tagName !== undefined &&
        path_ !== undefined &&
        path_.length <= MAX_INFERRED_DEPTH &&
        identity !== undefined &&
        !seen.has(identity)
      ) {
        seen.add(identity);
        const catalogShape = parentState.childPropDemands?.get(tagName)?.get(node.name.text);
        const candidate = resolveLocalComponent(tagName, parentState.localComponents);
        const activeLocalComponentNames = new Set(parentState.activeLocalComponentNames);
        const recursivelyActive = activeLocalComponentNames.has(tagName);
        activeLocalComponentNames.add(tagName);
        const inference =
          catalogShape !== undefined || candidate === undefined || recursivelyActive
            ? undefined
            : inferComponentProps(
                { exportName: tagName, ...candidate },
                parentState.localTypes,
                parentState.sourceFile,
                parentState.localComponents,
                parentState.localComponentDemandDepth + 1,
                activeLocalComponentNames,
                true,
                parentState.childPropDemands,
                parentState.registryDiscriminantHints,
                parentState.identityCollectionHelperParameters,
              );
        const shape = catalogShape ?? inference?.shape.properties?.[node.name.text];
        if (shape !== undefined) mergeFrozenShapeAtPath(root, path_, shape, parentState);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
  return root.children.size === 0 ? undefined : root;
}

/**
 * Carries an exact imported/local child prop contract back through one JSX identity edge.
 *
 * The catalog is built by a bounded parse-only module walker. This layer accepts only direct
 * identifier attributes such as `company={company}` whose expression is already rooted at the
 * selected component's props; calls, object literals, spreads, and optional carriers remain
 * authored because they do not prove an identity-preserving value relationship.
 */
function collectCatalogJsxForwardedPropRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const catalog = state.childPropDemands;
  if (catalog === undefined || catalog.size === 0 || functionLike.body === undefined) return;
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined &&
      isInsideSelectedPropSwitchClause(node, state)
    ) {
      const opening = node.parent.parent;
      const tagName =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        ts.isIdentifier(opening.tagName)
          ? opening.tagName.text
          : undefined;
      const expression = node.initializer.expression;
      const path_ = readPropPath(expression, state.aliases);
      const shape = tagName === undefined ? undefined : catalog.get(tagName)?.get(node.name.text);
      const identity =
        tagName === undefined || shape === undefined || path_ === undefined
          ? undefined
          : `${tagName}\0${node.name.text}\0${path_.join('.')}`;
      if (
        shape !== undefined &&
        path_ !== undefined &&
        path_.length > 0 &&
        path_.length <= MAX_INFERRED_DEPTH &&
        identity !== undefined &&
        !seen.has(identity) &&
        !isShadowedPathRoot(expression, state)
      ) {
        seen.add(identity);
        mergeFrozenShapeAtPath(state.root, path_, shape, state);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
}

/**
 * Carries one prop-derived value through an exact same-file JSX component boundary.
 *
 * A collection item often enters a local switch dispatcher before the selected renderer reads its
 * required fields. Follow only identifier-named local components, only the already selected switch
 * clause, and stop when a component identity recurs. This materializes the first real renderer's
 * contract without recursively inventing an unbounded tree such as Paragraph -> Node -> Paragraph.
 */
function collectLocalJsxForwardedPropRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  if (state.localComponentDemandDepth >= 8 || functionLike.body === undefined) return;
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression !== undefined &&
      isInsideSelectedPropSwitchClause(node, state)
    ) {
      const opening = node.parent.parent;
      const tagName =
        (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) &&
        ts.isIdentifier(opening.tagName)
          ? opening.tagName.text
          : undefined;
      const expression = node.initializer.expression;
      const path_ = readPropPath(expression, state.aliases);
      const identity =
        tagName === undefined || path_ === undefined
          ? undefined
          : `${tagName}\0${node.name.text}\0${path_.join('.')}`;
      if (
        tagName !== undefined &&
        path_ !== undefined &&
        path_.length > 0 &&
        path_.length <= MAX_INFERRED_DEPTH &&
        identity !== undefined &&
        !seen.has(identity) &&
        !state.activeLocalComponentNames.has(tagName) &&
        !isShadowedPathRoot(expression, state)
      ) {
        seen.add(identity);
        const candidate = resolveLocalComponent(tagName, state.localComponents);
        if (candidate !== undefined) {
          const activeLocalComponentNames = new Set(state.activeLocalComponentNames);
          activeLocalComponentNames.add(tagName);
          const inference = inferComponentProps(
            { exportName: tagName, ...candidate },
            state.localTypes,
            state.sourceFile,
            state.localComponents,
            state.localComponentDemandDepth + 1,
            activeLocalComponentNames,
            true,
            state.childPropDemands,
            state.registryDiscriminantHints,
            state.identityCollectionHelperParameters,
          );
          const shape = inference?.shape.properties?.[node.name.text];
          if (shape !== undefined) mergeFrozenShapeAtPath(state.root, path_, shape, state);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
}

/** Rejects JSX from non-selected direct switch clauses once an exact prop value is known. */
function isInsideSelectedPropSwitchClause(node: ts.Node, state: InferenceState): boolean {
  let current = node;
  while (current !== state.functionLike) {
    if (ts.isCaseClause(current) || ts.isDefaultClause(current)) {
      const caseBlock = current.parent;
      const statement = caseBlock.parent;
      if (ts.isSwitchStatement(statement)) {
        const discriminantPath = readPropPath(statement.expression, state.aliases);
        const selected =
          discriminantPath === undefined
            ? undefined
            : readPreviewInferredExactValue(state, discriminantPath);
        if (selected !== undefined) {
          if (ts.isCaseClause(current)) {
            return (
              readLiteralValue(current.expression as ts.LiteralTypeNode['literal']) === selected
            );
          }
          const directCases = statement.caseBlock.clauses.filter(ts.isCaseClause);
          return !directCases.some(
            (clause) =>
              readLiteralValue(clause.expression as ts.LiteralTypeNode['literal']) === selected,
          );
        }
      }
    }
    if (ts.isSourceFile(current)) return true;
    current = current.parent;
  }
  return true;
}

/** Reads only a literal already proven exact by type or direct control-flow evidence. */
function readPreviewInferredExactValue(
  state: InferenceState,
  path_: readonly string[],
): boolean | number | string | null | undefined {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return undefined;
    current = child;
  }
  return current.exactValue === true ? current.value : undefined;
}

/** Merges one frozen child-prop shape under the callback item's relative source path. */
function mergeFrozenShapeAtPath(
  root: MutableShapeNode,
  path_: readonly string[],
  shape: PreviewInferredPropShape,
  state: InferenceState,
): void {
  const incoming = thawPreviewInferredShape(shape, state);
  if (incoming === undefined) return;
  if (path_.length === 0) {
    mergeMutableShapeRequirement(root, incoming);
    return;
  }
  let current = root;
  for (const propertyName of path_) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) return;
    if (current.kind === 'array' && /^(?:0|[1-9]\d*)$/u.test(propertyName)) {
      if (current.items === undefined) {
        if (state.nodeCount >= MAX_INFERRED_NODES) return;
        state.nodeCount += 1;
        current.items = createMutableNode('object', 'usage');
      }
      current = current.items;
      continue;
    }
    if (current.kind !== 'object') return;
    let child = current.children.get(propertyName);
    if (child === undefined) {
      if (state.nodeCount >= MAX_INFERRED_NODES) return;
      state.nodeCount += 1;
      child = createMutableNode('object', 'usage');
      current.children.set(propertyName, child);
    }
    current = child;
  }
  mergeMutableShapeRequirement(current, incoming);
}

/** Converts a bounded immutable inference shape back into the local merge representation. */
function thawPreviewInferredShape(
  shape: PreviewInferredPropShape,
  state: InferenceState,
): MutableShapeNode | undefined {
  if (state.nodeCount >= MAX_INFERRED_NODES) return undefined;
  state.nodeCount += 1;
  const node = createMutableNode(shape.kind, 'usage');
  if (shape.value !== undefined) node.value = shape.value;
  if (shape.exactValue === true) node.exactValue = true;
  if (shape.items !== undefined) {
    const items = thawPreviewInferredShape(shape.items, state);
    if (items !== undefined) node.items = items;
  }
  for (const [propertyName, childShape] of Object.entries(shape.properties ?? {})) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) continue;
    const child = thawPreviewInferredShape(childShape, state);
    if (child !== undefined) node.children.set(propertyName, child);
  }
  return node;
}

/** Infers one function parameter as the root of a detached, budget-sharing item contract. */
function inferFunctionBindingRequirement(
  functionLike: ExportedFunctionLike,
  binding: ts.BindingName,
  parentState: InferenceState,
  allowRenderedRootScalar = parentState.allowRenderedRootScalar,
): MutableShapeNode | undefined {
  const bindingRoot = '__reactPreviewBindingRoot';
  const root = createMutableNode('object', 'usage');
  const state: InferenceState = {
    activeLocalComponentNames: parentState.activeLocalComponentNames,
    allowRenderedRootScalar,
    aliases: new Map(),
    childPropDemands: parentState.childPropDemands,
    collectionDemandDepth: parentState.collectionDemandDepth + 1,
    functionLike,
    graphqlFragmentUnmaskBindings: parentState.graphqlFragmentUnmaskBindings,
    graphqlDocumentTypeNames: parentState.graphqlDocumentTypeNames,
    identityCollectionHelperParameters: parentState.identityCollectionHelperParameters,
    localComponents: parentState.localComponents,
    localComponentDemandDepth: parentState.localComponentDemandDepth,
    localTypes: parentState.localTypes,
    nodeCount: parentState.nodeCount,
    registryDiscriminantHints: parentState.registryDiscriminantHints,
    root,
    sourceFile: parentState.sourceFile,
  };
  collectParameterBindings(binding, [bindingRoot], state.aliases);
  const typedParameter = functionLike.parameters.find((parameter) => parameter.name === binding);
  collectLocalPropAliases(functionLike, state);
  collectUsageRequirements(functionLike, state);
  if (
    ts.isIdentifier(binding) &&
    typedParameter?.type !== undefined &&
    typedParameter.questionToken === undefined &&
    typedParameter.initializer === undefined &&
    typedParameter.dotDotDotToken === undefined
  ) {
    addTypeRequirement(
      [bindingRoot],
      typedParameter.type,
      state.localTypes,
      state,
      state.sourceFile,
      new Set(),
    );
  }
  collectRequiredPropertyReadTerminals(functionLike, state);
  collectEqualityDiscriminantRequirements(functionLike, state);
  collectSwitchDiscriminantRequirements(functionLike, state);
  parentState.nodeCount = state.nodeCount;
  return root.children.get(bindingRoot);
}

/**
 * Selects the first authored primitive from a direct prop-derived equality comparison.
 *
 * Type inference can prove that a discriminator is a string while still leaving its value empty.
 * A direct comparison supplies a bounded accepted value without evaluating project code, allowing
 * preview data to enter the component's first authored branch instead of its unreachable fallback.
 */
function collectEqualityDiscriminantRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && isPrimitiveEqualityOperator(node.operatorToken.kind)) {
      const candidates = [
        {
          expression: node.left,
          value: readLiteralValue(node.right as ts.LiteralTypeNode['literal']),
        },
        {
          expression: node.right,
          value: readLiteralValue(node.left as ts.LiteralTypeNode['literal']),
        },
      ];
      for (const candidate of candidates) {
        const path_ = readPropPath(candidate.expression, state.aliases);
        if (
          candidate.value !== undefined &&
          path_ !== undefined &&
          path_.length > 0 &&
          !isShadowedPathRoot(candidate.expression, state) &&
          !hasPreviewInferredPropExplicitValue(state, path_)
        ) {
          requirePath(
            state,
            path_,
            readPrimitiveValueKind(candidate.value),
            'usage',
            candidate.value,
            true,
          );
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Restricts discriminator evidence to direct primitive equality and inequality operators. */
function isPrimitiveEqualityOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken;
}

/**
 * Selects the first authored primitive branch for a direct prop-derived switch discriminant.
 *
 * A switch that names every branch with a literal proves a finite accepted value set without
 * evaluating project code. Existing type or usage requirements retain ownership of a prop value;
 * this is solely the bounded fallback for an otherwise unmaterialized discriminant.
 */
function collectSwitchDiscriminantRequirements(
  functionLike: ExportedFunctionLike,
  state: InferenceState,
): void {
  const body = functionLike.body;
  if (body === undefined) return;
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node)) {
      const path_ = readPropPath(node.expression, state.aliases);
      const caseValues = readDirectPrimitiveSwitchCaseValues(node);
      if (
        path_ !== undefined &&
        path_.length > 0 &&
        !isShadowedPathRoot(node.expression, state) &&
        !hasPreviewInferredPropExplicitValue(state, path_) &&
        caseValues !== undefined
      ) {
        const value = caseValues[0];
        if (value !== undefined) {
          requirePath(state, path_, readPrimitiveValueKind(value), 'usage', value, true);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

/** Accepts only switches whose non-default clauses are directly authored primitive literals. */
function readDirectPrimitiveSwitchCaseValues(
  statement: ts.SwitchStatement,
): readonly (boolean | number | string)[] | undefined {
  const values: (boolean | number | string)[] = [];
  for (const clause of statement.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const value = readLiteralValue(clause.expression as ts.LiteralTypeNode['literal']);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values.length > 0 ? values : undefined;
}

/** Narrows the three serializable switch-literal categories to inference shape kinds. */
function readPrimitiveValueKind(value: boolean | number | string): PreviewInferredPropKind {
  if (typeof value === 'boolean') return 'boolean';
  return typeof value === 'number' ? 'number' : 'string';
}

/** Ensures receiver prefixes exist only before an authored optional-chain short circuit. */
function addReceiverContainers(
  state: InferenceState,
  path_: readonly string[],
  exclusiveLength: number,
): void {
  for (let length = 1; length < exclusiveLength; length += 1) {
    requirePath(state, path_.slice(0, length), 'object', 'usage');
  }
}

/** Infers callable/iterable/primitive kinds only when the consuming syntax proves the operation. */
function addOperationRequirement(
  state: InferenceState,
  path_: readonly string[],
  node: ts.Expression,
): void {
  const parent = node.parent;
  const arithmeticNeutralValue = readArithmeticNeutralValue(node, parent);
  if (arithmeticNeutralValue !== undefined) {
    requirePath(state, path_, 'number', 'usage', arithmeticNeutralValue, true);
    return;
  }
  if (isLogicalEmptyArrayFallback(node, parent)) {
    requirePath(state, path_, 'array', 'usage');
    return;
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    ts.isArrayBindingPattern(parent.name)
  ) {
    requirePath(state, path_, 'array', 'usage');
    const arrayNode = readMutablePathNode(state, path_);
    if (arrayNode?.kind === 'array') arrayNode.itemConsumed = true;
    return;
  }
  const logicalFallbackValue = readLogicalPrimitiveFallbackValue(node, parent);
  if (logicalFallbackValue !== undefined) {
    requirePath(
      state,
      path_,
      readPrimitiveValueKind(logicalFallbackValue),
      'usage',
      logicalFallbackValue,
    );
    return;
  }
  const overlayNeutralValue = inferReactOverlayVisibilityNeutralValue(node);
  if (overlayNeutralValue !== undefined) {
    requirePath(state, path_, overlayNeutralValue.kind, 'usage', overlayNeutralValue.value, true);
    return;
  }
  if (
    ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
      parent.tagName === node) ||
    (ts.isJsxClosingElement(parent) && parent.tagName === node)
  ) {
    requirePath(state, path_, 'component', 'usage');
    return;
  }
  const directJsxPropName = readDirectJsxPropName(node);
  if (directJsxPropName !== undefined) {
    const semantic =
      inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '') ??
      inferPreviewUsageSemanticFallback(state, directJsxPropName);
    if (semantic !== undefined) {
      requirePath(state, path_, semantic.kind, 'usage', semantic.value, semantic.exactValue);
      return;
    }
  }
  if (
    ts.isCallExpression(parent) &&
    parent.expression === node &&
    parent.questionDotToken !== undefined
  ) {
    return;
  }
  if (
    ts.isPrefixUnaryExpression(parent) &&
    parent.operator === ts.SyntaxKind.ExclamationToken &&
    parent.operand === node
  ) {
    /* Negation proves truthiness, not Boolean type. Preserve a semantic URL/data value so an exact
     * target can pass `if (!value) return null` instead of receiving a self-defeating `false`. */
    const semantic = inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '');
    if (isRenderTerminatingNegatedGuard(parent)) {
      if (semantic?.kind === 'boolean') {
        requirePath(state, path_, 'boolean', 'usage', true, true);
      } else if (semantic?.kind === 'number') {
        requirePath(state, path_, 'number', 'usage', 1, true);
      } else if (semantic?.kind === 'null' || semantic === undefined) {
        requirePath(state, path_, 'object', 'usage');
      } else {
        requirePath(state, path_, semantic.kind, 'usage', semantic.value, true);
      }
    } else {
      requirePath(state, path_, semantic?.kind ?? 'boolean', 'usage', semantic?.value ?? false);
    }
    return;
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) {
    const methodName = path_.at(-1);
    const receiverPath = path_.slice(0, -1);
    const semanticReceiver = inferPreviewUsageSemanticFallback(state, receiverPath.at(-1) ?? '');
    if (
      receiverPath.length > 0 &&
      methodName === 'toString' &&
      semanticReceiver !== undefined &&
      (semanticReceiver.kind === 'boolean' ||
        semanticReceiver.kind === 'number' ||
        semanticReceiver.kind === 'string')
    ) {
      requirePath(
        state,
        receiverPath,
        semanticReceiver.kind,
        'usage',
        semanticReceiver.value,
        semanticReceiver.exactValue,
      );
      return;
    }
    const sharedStringReceiver =
      methodName !== undefined &&
      STRING_COLLECTION_SHARED_METHOD_NAMES.has(methodName) &&
      semanticReceiver?.kind === 'string';
    if (
      receiverPath.length > 0 &&
      methodName !== undefined &&
      ARRAY_METHOD_NAMES.has(methodName) &&
      !sharedStringReceiver
    ) {
      requirePath(state, receiverPath, 'array', 'usage');
    } else if (
      receiverPath.length > 0 &&
      methodName !== undefined &&
      (STRING_METHOD_NAMES.has(methodName) || sharedStringReceiver)
    ) {
      requirePath(state, receiverPath, 'string', 'usage');
    } else {
      requirePath(state, path_, 'function', 'usage');
    }
    return;
  }
  if (
    (ts.isForOfStatement(parent) && parent.expression === node) ||
    (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent))
  ) {
    requirePath(state, path_, 'array', 'usage');
    return;
  }
  if (
    path_.length > 1 &&
    !hasPreviewInferredPropTerminal(state, path_) &&
    isReactRenderedValueExpression(node)
  ) {
    const semantic = inferPreviewUsageSemanticFallback(state, path_.at(-1) ?? '');
    if (semantic !== undefined) {
      requirePath(state, path_, semantic.kind, 'usage', semantic.value, semantic.exactValue);
    }
  }
  if (
    state.allowRenderedRootScalar &&
    path_.length === 1 &&
    ts.isIdentifier(node) &&
    !hasPreviewInferredPropTerminal(state, path_) &&
    isReactRenderedChildValueExpression(node)
  ) {
    const renderedName = node.text;
    requirePath(
      state,
      path_,
      'string',
      'usage',
      renderedName.length <= 32 ? renderedName : `${renderedName.slice(0, 31)}…`,
    );
    let renderedNode = state.root;
    for (const propertyName of path_) {
      const child = renderedNode.children.get(propertyName);
      if (child === undefined) return;
      renderedNode = child;
    }
    renderedNode.renderedValue = true;
  }
}

/** Distinguishes actual React child content from an opaque JSX attribute forwarding edge. */
function isReactRenderedChildValueExpression(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  let parent = current.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  return (
    ts.isJsxExpression(parent) &&
    parent.expression === current &&
    (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))
  );
}

/**
 * Carries a prop collection through `const rows = value ?? []` without inventing membership.
 * The empty fallback proves the runtime container kind while preserving every authored item from
 * the left side, so a later `rows.map(...)` can safely refine the original prop's item contract.
 */
function readEmptyCollectionDefaultPropPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(current) ||
    (current.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      current.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return undefined;
  }
  const fallback = unwrapExpression(current.right);
  if (!ts.isArrayLiteralExpression(fallback) || fallback.elements.length !== 0) return undefined;
  return readPropPath(current.left, aliases);
}

/** Prefers a source-proven registry key over generic text derived from the field name. */
function inferPreviewUsageSemanticFallback(
  state: InferenceState,
  rawName: string,
):
  | {
      readonly exactValue?: true;
      readonly kind: PreviewInferredPropKind;
      readonly value?: boolean | number | string | null;
    }
  | undefined {
  const registryValue = state.registryDiscriminantHints.get(rawName);
  if (registryValue !== undefined) {
    return {
      exactValue: true,
      kind: readPrimitiveValueKind(registryValue),
      value: registryValue,
    };
  }
  const semantic = inferPreviewRuntimeSemanticFallback(rawName);
  return semantic === undefined
    ? undefined
    : {
        kind: semantic.kind,
        ...(semantic.value === undefined ? {} : { value: semantic.value }),
      };
}

/** Reads an unchanged value forwarded through one ordinary JSX attribute. */
function readDirectJsxPropName(expression: ts.Expression): string | undefined {
  const container = expression.parent;
  if (
    !ts.isJsxExpression(container) ||
    container.expression !== expression ||
    !ts.isJsxAttribute(container.parent) ||
    !ts.isIdentifier(container.parent.name)
  ) {
    return undefined;
  }
  return container.parent.name.text;
}

/** Selects the neutral number proven by a direct arithmetic operation. */
function readArithmeticNeutralValue(
  expression: ts.Expression,
  parent: ts.Node,
): number | undefined {
  if (
    ts.isPrefixUnaryExpression(parent) &&
    parent.operand === expression &&
    (parent.operator === ts.SyntaxKind.PlusToken || parent.operator === ts.SyntaxKind.MinusToken)
  ) {
    return 0;
  }
  if (
    !ts.isBinaryExpression(parent) ||
    (parent.left !== expression && parent.right !== expression)
  ) {
    return undefined;
  }
  const operator = parent.operatorToken.kind;
  if (
    operator === ts.SyntaxKind.AsteriskToken ||
    operator === ts.SyntaxKind.SlashToken ||
    operator === ts.SyntaxKind.PercentToken ||
    operator === ts.SyntaxKind.AsteriskAsteriskToken
  ) {
    return 1;
  }
  if (operator === ts.SyntaxKind.MinusToken) return 0;
  if (operator !== ts.SyntaxKind.PlusToken) return undefined;
  const other = parent.left === expression ? parent.right : parent.left;
  return ts.isNumericLiteral(unwrapExpression(other)) ? 0 : undefined;
}

/** Reuses a direct primitive `value || fallback`/`value ?? fallback` as a render-safe sample. */
function readLogicalPrimitiveFallbackValue(
  expression: ts.Expression,
  parent: ts.Node,
): boolean | number | string | undefined {
  if (
    !ts.isBinaryExpression(parent) ||
    parent.left !== expression ||
    (parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      parent.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return undefined;
  }
  const fallback = unwrapExpression(parent.right);
  if (ts.isStringLiteralLike(fallback)) return fallback.text;
  if (ts.isNumericLiteral(fallback)) return Number(fallback.text);
  if (fallback.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (fallback.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Treats a direct `value || []` / `value ?? []` receiver as an Array contract. */
function isLogicalEmptyArrayFallback(expression: ts.Expression, parent: ts.Node): boolean {
  if (
    !ts.isBinaryExpression(parent) ||
    parent.left !== expression ||
    (parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      parent.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return false;
  }
  const fallback = unwrapExpression(parent.right);
  return ts.isArrayLiteralExpression(fallback) && fallback.elements.length === 0;
}

/** Reports a negated prop guard whose selected branch exits before visible component output. */
function isRenderTerminatingNegatedGuard(negation: ts.PrefixUnaryExpression): boolean {
  let condition: ts.Expression = negation;
  let parent = condition.parent;
  while (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent)) &&
    parent.expression === condition
  ) {
    condition = parent;
    parent = condition.parent;
  }
  return (
    ts.isIfStatement(parent) &&
    parent.expression === condition &&
    doesStatementTerminateRender(parent.thenStatement)
  );
}

/** Accepts only a direct return/throw or a block whose last statement is a direct terminal. */
function doesStatementTerminateRender(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (!ts.isBlock(statement)) return false;
  const terminal = statement.statements.at(-1);
  return (
    terminal !== undefined && (ts.isReturnStatement(terminal) || ts.isThrowStatement(terminal))
  );
}

/** Reports whether type or prior operation evidence already owns the final prop-path value kind. */
function hasPreviewInferredPropTerminal(state: InferenceState, path_: readonly string[]): boolean {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return false;
    current = child;
  }
  return current.kind !== 'object' || current.children.size > 0;
}

/** Reports whether prior type or usage evidence already selected an exact scalar value. */
function hasPreviewInferredPropExplicitValue(
  state: InferenceState,
  path_: readonly string[],
): boolean {
  let current = state.root;
  for (const propertyName of path_) {
    const child = current.children.get(propertyName);
    if (child === undefined) return false;
    current = child;
  }
  return current.value !== undefined;
}

/**
 * Reports whether one prop-derived value reaches JSX output. Semantic keys may seed that leaf while
 * syntax-only wrappers are skipped without following calls or changing unrelated control flow.
 */
function isReactRenderedValueExpression(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  let parent = current.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  if (!ts.isJsxExpression(parent) || parent.expression !== current) return false;
  return (
    ts.isJsxAttribute(parent.parent) ||
    ts.isJsxElement(parent.parent) ||
    ts.isJsxFragment(parent.parent)
  );
}

/** Finds the shallowest optional receiver so neutral props preserve authored short-circuiting. */
function readFirstOptionalReceiverLength(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): number | undefined {
  let current = unwrapExpression(expression);
  let selected: number | undefined;
  while (isAccessExpression(current)) {
    if (current.questionDotToken !== undefined) {
      const receiverPath = readPropPath(current.expression, aliases);
      if (receiverPath !== undefined) {
        selected =
          selected === undefined ? receiverPath.length : Math.min(selected, receiverPath.length);
      }
    }
    current = unwrapExpression(current.expression);
  }
  return selected;
}

/** Merges one materialized path under depth/node budgets and safe-property constraints. */
function requirePath(
  state: InferenceState,
  path_: readonly string[],
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
  value?: boolean | number | string | null,
  exactValue?: true,
): void {
  if (path_.length === 0 || path_.length > MAX_INFERRED_DEPTH) return;
  let current = state.root;
  for (const [index, propertyName] of path_.entries()) {
    if (BLOCKED_PROPERTY_NAMES.has(propertyName)) return;
    let child = current.children.get(propertyName);
    if (child === undefined) {
      if (state.nodeCount >= MAX_INFERRED_NODES) return;
      child = createMutableNode(index === path_.length - 1 ? kind : 'object', source);
      current.children.set(propertyName, child);
      state.nodeCount += 1;
    }
    if (index === path_.length - 1) {
      mergeNodeKind(child, kind, source, value, exactValue);
    } else if (child.kind !== 'object') {
      return;
    }
    current = child;
  }
}

/** Refines an empty object receiver to an operation-proven kind and otherwise fails conservatively. */
function mergeNodeKind(
  node: MutableShapeNode,
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
  value?: boolean | number | string | null,
  exactValue?: true,
): void {
  if (node.kind === kind) {
    if (source === 'type') node.source = 'type';
    if (value !== undefined) node.value = value;
    if (exactValue === true) node.exactValue = true;
    return;
  }
  if (node.kind === 'object' && node.children.size === 0) {
    node.kind = kind;
    node.source = source;
    if (value === undefined) delete node.value;
    else node.value = value;
    if (exactValue === true) node.exactValue = true;
  }
}

/** Reads an access chain rooted in a known prop or local alias without invoking computed values. */
function readPropPath(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, PropPathBinding>,
): readonly string[] | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return aliases.get(current.text)?.path;
  if (ts.isPropertyAccessExpression(current)) {
    if (
      current.name.text === 'props' &&
      unwrapExpression(current.expression).kind === ts.SyntaxKind.ThisKeyword
    ) {
      return aliases.get(CLASS_COMPONENT_PROPS_ALIAS)?.path;
    }
    const parentPath = readPropPath(current.expression, aliases);
    return parentPath === undefined || BLOCKED_PROPERTY_NAMES.has(current.name.text)
      ? undefined
      : [...parentPath, current.name.text];
  }
  if (ts.isElementAccessExpression(current)) {
    const propertyName = readElementPropertyName(current.argumentExpression);
    if (
      propertyName === 'props' &&
      unwrapExpression(current.expression).kind === ts.SyntaxKind.ThisKeyword
    ) {
      return aliases.get(CLASS_COMPONENT_PROPS_ALIAS)?.path;
    }
    const parentPath = readPropPath(current.expression, aliases);
    return parentPath === undefined ||
      propertyName === undefined ||
      BLOCKED_PROPERTY_NAMES.has(propertyName)
      ? undefined
      : [...parentPath, propertyName];
  }
  return undefined;
}

/** Rejects a root identifier shadowed between its access and the exported component function. */
function isShadowedPathRoot(node: ts.Expression, state: InferenceState): boolean {
  let root: ts.Expression = node;
  while (isAccessExpression(root)) root = unwrapExpression(root.expression);
  return ts.isIdentifier(root) ? isShadowedIdentifier(root, root.text, state.functionLike) : false;
}

/** Detects nested function parameters that replace a component prop/alias identity. */
function isShadowedIdentifier(
  identifier: ts.Identifier,
  name: string,
  functionLike: ExportedFunctionLike,
): boolean {
  let current: ts.Node = identifier.parent;
  while (current !== functionLike && !ts.isSourceFile(current)) {
    if (isFunctionLike(current) && current !== functionLike) {
      if (current.parameters.some((parameter) => bindingContainsName(parameter.name, name))) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** Keeps eager container materialization within the selected component's own render scope. */
function isInsideNestedFunction(node: ts.Node, functionLike: ExportedFunctionLike): boolean {
  let current = node.parent;
  while (current !== functionLike && !ts.isSourceFile(current)) {
    if (isFunctionLike(current)) return true;
    current = current.parent;
  }
  return current !== functionLike;
}

/** Freezes one deterministic JSON-safe shape and its flattened provenance inventory. */
function freezeInference(root: MutableShapeNode): PreviewInferredExportProps {
  const provenance: PreviewInferredPropProvenance[] = [];
  const freezeNode = (
    node: MutableShapeNode,
    path_: readonly string[],
  ): PreviewInferredPropShape => {
    const properties = Object.fromEntries(
      [...node.children.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, child]) => [name, freezeNode(child, [...path_, name])]),
    );
    if (path_.length > 0) {
      provenance.push({ kind: node.kind, path: path_.join('.'), source: node.source });
    }
    return Object.freeze({
      kind: node.kind,
      ...(node.kind === 'array' && node.items !== undefined
        ? { items: freezeNode(node.items, [...path_, '[]']) }
        : {}),
      ...(node.kind === 'object' || node.kind === 'graphql-document'
        ? { properties: Object.freeze(properties) }
        : {}),
      ...(node.value === undefined ? {} : { value: node.value }),
      ...(node.exactValue === true ? { exactValue: true as const } : {}),
    });
  };
  const shape = freezeNode(root, []);
  return Object.freeze({
    provenance: Object.freeze(
      provenance.sort((left, right) => left.path.localeCompare(right.path)),
    ),
    shape,
  });
}

/** Collects direct/default/local-clause exports while statically following same-file HOC inputs. */
function collectExportedComponentFunctions(
  sourceFile: ts.SourceFile,
): readonly ExportedComponentFunction[] {
  const localDeclarations = collectLocalComponentDeclarations(sourceFile);
  const selected: ExportedComponentFunction[] = [];
  const seenNames = new Set<string>();
  const add = (exportName: string, candidate: ComponentFunctionCandidate | undefined): void => {
    if (
      candidate === undefined ||
      seenNames.has(exportName) ||
      (exportName !== 'default' && !/^\p{Lu}/u.test(exportName))
    )
      return;
    seenNames.add(exportName);
    selected.push({ exportName, ...candidate });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const candidate = { functionLike: statement };
      if (hasExportModifier(statement)) {
        add(hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''), candidate);
      }
    } else if (ts.isClassDeclaration(statement)) {
      if (hasExportModifier(statement)) {
        add(
          hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''),
          resolveClassComponent(statement),
        );
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const candidate = resolveLocalComponent(declaration.name.text, localDeclarations);
        if (hasExportModifier(statement)) add(declaration.name.text, candidate);
      }
    } else if (ts.isExportAssignment(statement)) {
      add('default', resolveComponentExpression(statement.expression, localDeclarations));
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = (element.propertyName ?? element.name).text;
        add(element.name.text, resolveLocalComponent(localName, localDeclarations));
      }
    }
  }
  return selected;
}

/** Indexes unique top-level declarations without resolving imports or evaluating initializers. */
function collectLocalComponentDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalComponentDeclaration> {
  const declarations = new Map<string, LocalComponentDeclaration>();
  const ambiguous = new Set<string>();
  const add = (name: string, declaration: LocalComponentDeclaration): void => {
    if (ambiguous.has(name)) return;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else declarations.set(name, declaration);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      add(statement.name.text, { functionLike: statement });
    } else if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      const candidate = resolveClassComponent(statement);
      if (candidate !== undefined) add(statement.name.text, candidate);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const contextualPropsType = readReactComponentPropsType(declaration.type);
        add(declaration.name.text, {
          expression: declaration.initializer,
          ...(contextualPropsType === undefined ? {} : { contextualPropsType }),
        });
      }
    }
  }
  return declarations;
}

/** Extracts the props argument from common `FC<Props>` variable annotations. */
function readReactComponentPropsType(typeNode: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return undefined;
  const typeName = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : typeNode.typeName.right.text;
  return /^(?:FC|FunctionComponent|VFC|VoidFunctionComponent)$/u.test(typeName)
    ? typeNode.typeArguments?.[0]
    : undefined;
}

/** Resolves one unique same-file declaration through bounded HOC/alias chains; cycles fail closed. */
function resolveLocalComponent(
  name: string,
  declarations: ReadonlyMap<string, LocalComponentDeclaration>,
  activeNames: Set<string> = new Set<string>(),
  depth = 0,
): ComponentFunctionCandidate | undefined {
  if (depth > MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH || activeNames.has(name)) return undefined;
  const declaration = declarations.get(name);
  if (declaration === undefined) return undefined;
  activeNames.add(name);
  const candidate = declaration.functionLike
    ? {
        functionLike: declaration.functionLike,
        ...(declaration.classComponentProps === true ? { classComponentProps: true as const } : {}),
      }
    : resolveComponentExpression(declaration.expression, declarations, activeNames, depth + 1);
  activeNames.delete(name);
  return candidate === undefined
    ? undefined
    : {
        ...candidate,
        ...(declaration.contextualPropsType === undefined
          ? {}
          : { contextualPropsType: declaration.contextualPropsType }),
      };
}

/** Reads direct functions or local component arguments from nested common React HOC syntax. */
function resolveComponentExpression(
  expression: ts.Expression | undefined,
  declarations: ReadonlyMap<string, LocalComponentDeclaration>,
  activeNames: Set<string> = new Set<string>(),
  depth = 0,
): ComponentFunctionCandidate | undefined {
  if (expression === undefined || depth > MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return { functionLike: current };
  }
  if (ts.isClassExpression(current)) return resolveClassComponent(current);
  if (ts.isIdentifier(current)) {
    return resolveLocalComponent(current.text, declarations, activeNames, depth + 1);
  }
  const call = ts.isTaggedTemplateExpression(current) ? unwrapExpression(current.tag) : current;
  if (!ts.isCallExpression(call) || call.arguments.length === 0) return undefined;
  for (const argument of call.arguments) {
    const candidate = unwrapExpression(argument);
    if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) {
      return { functionLike: candidate };
    }
  }
  for (const argument of call.arguments) {
    const candidate = resolveComponentExpression(argument, declarations, activeNames, depth + 1);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

/** Resolves one unambiguous instance render method without executing the class or its base. */
function resolveClassComponent(
  declaration: ts.ClassDeclaration | ts.ClassExpression,
): ComponentFunctionCandidate | undefined {
  const renderMethods = declaration.members.filter(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      member.body !== undefined &&
      readPropertyName(member.name) === 'render' &&
      !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
  );
  const renderMethod = renderMethods[0];
  return renderMethods.length === 1 && renderMethod !== undefined
    ? { classComponentProps: true, functionLike: renderMethod }
    : undefined;
}

/** Indexes unique non-generic same-file type/interface declarations. */
function collectLocalObjectTypes(sourceFile: ts.SourceFile): ReadonlyMap<string, LocalObjectType> {
  const declarations = new Map<string, LocalObjectType>();
  const ambiguous = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) continue;
    const name = statement.name.text;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else if (!ambiguous.has(name)) {
      declarations.set(name, statement);
    }
  }
  return declarations;
}

/** Creates one mutable node with a child map unavailable to project-controlled prototypes. */
function createMutableNode(
  kind: PreviewInferredPropKind,
  source: PreviewInferredPropProvenance['source'],
): MutableShapeNode {
  return { children: new Map(), kind, source };
}

/** Unwraps syntax-only assertions while retaining runtime access structure. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

/** Reports property/element access expressions handled by the path reader. */
function isAccessExpression(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/** Keeps only the outermost access chain so each operation is interpreted exactly once. */
function isNestedAccessReceiver(node: ts.Expression): boolean {
  const parent = node.parent;
  return isAccessExpression(parent) && parent.expression === node;
}

/** Reports whether an identifier already belongs to an access chain visited at its outer node. */
function isIdentifierPartOfAccess(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isPropertyAccessExpression(parent) &&
      (parent.expression === identifier || parent.name === identifier)) ||
    (ts.isElementAccessExpression(parent) && parent.expression === identifier)
  );
}

/** Excludes declaration/binding positions from bare identifier operation inference. */
function isDeclarationName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isBindingElement(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier)
  );
}

/** Narrows ordinary nested function scopes used by shadow checks. */
function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Recursively checks a binding pattern for one shadowing local name. */
function bindingContainsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingContainsName(element.name, name),
  );
}

/** Reads an external property name from shorthand, renamed, or nested binding syntax. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  if (element.propertyName !== undefined) return readPropertyName(element.propertyName);
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

/** Reads a safe static property name without evaluating a computed expression. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Reads a static element-access name accepted by object shape serialization. */
function readElementPropertyName(expression: ts.Expression | undefined): string | undefined {
  return expression !== undefined &&
    (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression))
    ? expression.text
    : undefined;
}

/** Reads primitive literal types while excluding bigint and expression-based values. */
function readLiteralValue(
  literal: ts.LiteralTypeNode['literal'],
): boolean | number | string | undefined {
  if (ts.isStringLiteralLike(literal)) return literal.text;
  if (ts.isNumericLiteral(literal)) return Number(literal.text);
  if (literal.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (literal.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Reports a direct export modifier without relying on TypeScript-internal node flags. */
function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** Reports a default modifier paired with an exported declaration. */
function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

/** Rejects parser recovery so generated paths never reflect malformed syntax. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Selects the JSX-aware parser grammar from one supported source suffix. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  return extension === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}
