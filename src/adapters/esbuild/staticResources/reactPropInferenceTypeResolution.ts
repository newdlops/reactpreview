/** Resolves a bounded closure of imported object declarations for prop analysis. */
import path from 'node:path';
import ts from 'typescript';
import { readPreviewAnalysisSourceFile } from '../previewAnalysisSourceFile';
import { createPreviewTypeAnalysisSourceFile } from '../typeOracle/previewTypedJsonAnalysis';
import { isReactOverlayComponentName } from './reactOverlayVisibilityInference';
import { collectLocalObjectTypes } from './reactPropInferenceComponents';
import {
  type LocalObjectType,
  type PreviewPropInferenceOptions,
  type ResolvableObjectTypeImport,
  type ResolvedImportedObjectType,
  type ResolvedObjectTypeModule,
  MAX_IMPORTED_TYPE_BYTES,
  MAX_IMPORTED_TYPE_MODULES,
  MAX_INFERRED_DEPTH,
  MAX_INFERRED_NODES,
} from './reactPropInferenceModel';
import {
  hasDefaultModifier,
  hasExportModifier,
  hasParseDiagnostics,
  readScriptKind,
} from './reactPropInferenceSyntax';

/**
 * Parses only declaration evidence after callers charge the complete original module budgets.
 * Large TypeScript modules use a private JSON-erased tree; runtime analyzers keep their original
 * parses. This does not borrow checker-owned nodes or add an AST/string cache. Ordinary modules
 * keep the existing shared read-only parser and every uncertain projection falls back unchanged.
 */
function readImportedObjectTypeSource(
  module: Readonly<{ sourcePath: string; sourceText: string }>,
): ts.SourceFile {
  if (module.sourceText.length > 128 * 1024 && /\.[cm]?ts$/u.test(module.sourcePath)) {
    return createPreviewTypeAnalysisSourceFile(
      module.sourcePath,
      module.sourceText,
      ts.ScriptTarget.Latest,
    );
  }
  return readPreviewAnalysisSourceFile(
    module.sourcePath,
    module.sourceText,
    readScriptKind(module.sourcePath),
  );
}

/** Resolves direct imported aliases and one re-export chain without evaluating a project module. */
export function collectResolvableObjectTypes(
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
        const importedFile = readImportedObjectTypeSource(module);
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
export function collectResolvableObjectTypeImports(
  sourceFile: ts.SourceFile,
): readonly ResolvableObjectTypeImport[] {
  const imports: ResolvableObjectTypeImport[] = [];
  const importedNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) importedNames.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) importedNames.add(binding.name.text);
    }
  }
  if (importedNames.size === 0) return [];
  const referencedTypeNames = new Set<string>();
  const propsDependencyNames = new Set<string>();
  const collectReferencedTypeName = (
    node: ts.Node,
    destination: Set<string> = referencedTypeNames,
    remaining = new Set(importedNames),
  ): boolean => {
    if (remaining.size === 0) return true;
    let name: string | undefined;
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      name = node.typeName.text;
    } else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
      name = node.expression.text;
    }
    if (name !== undefined && remaining.delete(name)) destination.add(name);
    if (remaining.size === 0) return true;
    // Type references form a set, so assertions can inspect their type before a large JSON value.
    // Stop only after every imported name is proven; absent names still require the complete walk.
    if (
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return (
        collectReferencedTypeName(node.type, destination, remaining) ||
        collectReferencedTypeName(node.expression, destination, remaining)
      );
    }
    return (
      ts.forEachChild(node, (child) =>
        collectReferencedTypeName(child, destination, remaining) ? true : undefined,
      ) === true
    );
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
export function resolveLocalExportedObjectType(
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
export function resolveExportedObjectType(
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
    const next = readImportedObjectTypeSource(module);
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
export function collectImportedObjectTypeClosure(
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
    const sourceFile = readImportedObjectTypeSource(loaded);
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
export function isSameObjectTypeDeclaration(
  left: LocalObjectType,
  right: LocalObjectType,
): boolean {
  return (
    left === right ||
    (left.kind === right.kind &&
      left.pos === right.pos &&
      left.end === right.end &&
      left.getSourceFile().fileName === right.getSourceFile().fileName)
  );
}
