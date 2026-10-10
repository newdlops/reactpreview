/**
 * Reads a Tailwind v2/v3 configuration file as data, without executing it.
 *
 * Project configuration is never imported: it is authored JavaScript that could run anything in
 * the compiler worker. Most configurations are nevertheless plain data, such as a `theme.extend`
 * object with brand colors, fonts, radii, and shadows, and a page that uses `bg-brand` or
 * `@apply text-s400` cannot compile without it. This module parses the file and evaluates only a
 * literal subset: object and array literals, spreads, primitives, template strings, top-level
 * `const` bindings, member access, local project modules imported for design tokens, and
 * Tailwind's own `tailwindcss/colors` and `tailwindcss/defaultTheme` data modules. Functions,
 * plugins, presets from packages, and anything else unknown are skipped and reported.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';

/** Configuration keys that change generated CSS and are safe to pass as data. */
const ADMITTED_KEYS = new Set([
  'corePlugins',
  'darkMode',
  'important',
  'prefix',
  'safelist',
  'separator',
  'theme',
]);
const CONFIG_STEMS = ['tailwind.config'] as const;
const CONFIG_EXTENSIONS = ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'] as const;
const MODULE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'] as const;
const TAILWIND_DATA_MODULES = new Set([
  'tailwindcss/colors',
  'tailwindcss/defaultTheme',
  'tailwindcss/defaultConfig',
]);
const MAX_DEPTH = 64;
const MAX_MODULES = 16;
const MAX_NODES = 20_000;
const MAX_SOURCE_BYTES = 512 * 1024;
const UNKNOWN: unique symbol = Symbol('unknown');
const IN_PROGRESS: unique symbol = Symbol('in-progress');

/** Data recovered from one configuration file. */
export interface PreviewTailwindStaticConfig {
  /** Admitted top-level keys (`theme`, `darkMode`, …) with evaluated values. */
  readonly config: Readonly<Record<string, unknown>>;
  /** Configuration and token modules read, for rebuild routing. */
  readonly dependencyPaths: readonly string[];
  /** Key paths that could not be evaluated as data and were left out. */
  readonly skipped: readonly string[];
}

/** Evaluation context shared across the configuration and the token modules it imports. */
interface EvaluationState {
  /** Evaluated bindings and module exports; a binding still being evaluated marks a cycle. */
  readonly bindings: Map<string, unknown>;
  /** Canonical directory that every followed token module must stay inside. */
  readonly boundaryRoot: string;
  readonly dependencyPaths: Set<string>;
  readonly modules: Map<string, ts.SourceFile>;
  nodes: number;
  readonly requireTailwindData: (specifier: string) => unknown;
  readonly skipped: string[];
}

/**
 * Finds and statically evaluates the project's Tailwind configuration.
 *
 * @param styleRoot Package directory whose configuration Tailwind would load.
 * @param requireTailwindData Loads Tailwind's own data modules from the running package.
 * @param boundaryRoot Workspace directory that relative token modules must stay inside.
 * @returns Recovered data, or `undefined` when no configuration file exists or none parses.
 */
export function readPreviewTailwindStaticConfig(
  styleRoot: string,
  requireTailwindData: (specifier: string) => unknown,
  boundaryRoot: string = styleRoot,
): PreviewTailwindStaticConfig | undefined {
  const configPath = CONFIG_STEMS.flatMap((stem) =>
    CONFIG_EXTENSIONS.map((extension) => path.join(styleRoot, `${stem}.${extension}`)),
  ).find(isFile);
  if (configPath === undefined) return undefined;
  try {
    return evaluateConfig(configPath, requireTailwindData, canonicalizeExistingPath(boundaryRoot));
  } catch {
    // The configuration only refines styling; an unreadable one leaves Tailwind defaults.
    return undefined;
  }
}

/** Evaluates the default export of one configuration file and keeps the admitted keys. */
function evaluateConfig(
  configPath: string,
  requireTailwindData: (specifier: string) => unknown,
  boundaryRoot: string,
): PreviewTailwindStaticConfig | undefined {
  const state: EvaluationState = {
    bindings: new Map(),
    boundaryRoot,
    dependencyPaths: new Set(),
    modules: new Map(),
    nodes: 0,
    requireTailwindData,
    skipped: [],
  };
  const sourceFile = readModule(state, configPath);
  const exported = sourceFile === undefined ? undefined : findDefaultExport(sourceFile);
  if (sourceFile === undefined || exported === undefined) return undefined;
  const value = evaluate(state, sourceFile, exported, 'config', 0);
  if (!isRecord(value)) return undefined;
  return {
    config: readAdmittedConfig(value, 'config', state.skipped),
    dependencyPaths: [...state.dependencyPaths],
    skipped: state.skipped,
  };
}

/**
 * Keeps the admitted keys of a configuration or of a data-only preset it lists.
 *
 * Presets are admitted when every entry evaluated to data, so a local design-system preset still
 * supplies its theme, and `presets: []` still disables Tailwind's default configuration.
 */
function readAdmittedConfig(
  value: Readonly<Record<string, unknown>>,
  keyPath: string,
  skipped: string[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (ADMITTED_KEYS.has(key)) config[key] = entry;
    else if (key === 'presets' && Array.isArray(entry) && entry.every(isRecord)) {
      config[key] = entry.map((preset, index) =>
        readAdmittedConfig(preset, `${keyPath}.presets[${String(index)}]`, skipped),
      );
    } else if (
      (key === 'plugins' || key === 'presets') &&
      !(Array.isArray(entry) && entry.length === 0)
    ) {
      skipped.push(`${keyPath}.${key}`);
    }
  }
  return config;
}

/** Parses one module once, within the byte and module-count bounds. */
function readModule(state: EvaluationState, modulePath: string): ts.SourceFile | undefined {
  const cached = state.modules.get(modulePath);
  if (cached !== undefined) return cached;
  if (state.modules.size >= MAX_MODULES) return undefined;
  let text: string;
  try {
    text = readFileSync(modulePath, 'utf8');
  } catch {
    return undefined;
  }
  if (text.length > MAX_SOURCE_BYTES) return undefined;
  const sourceFile = ts.createSourceFile(
    modulePath,
    modulePath.endsWith('.json') ? `export default ${text}` : text,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?tsx?$/u.test(modulePath) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  state.modules.set(modulePath, sourceFile);
  state.dependencyPaths.add(modulePath);
  return sourceFile;
}

/** Finds `export default …`, `module.exports = …`, or `export = …`. */
function findDefaultExport(sourceFile: ts.SourceFile): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) return statement.expression;
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      statement.expression.left.getText(sourceFile) === 'module.exports'
    ) {
      return statement.expression.right;
    }
  }
  return undefined;
}

/** Evaluates one expression of the literal subset; unknown parts become `UNKNOWN`. */
function evaluate(
  state: EvaluationState,
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  keyPath: string,
  depth: number,
): unknown {
  state.nodes += 1;
  if (depth > MAX_DEPTH || state.nodes > MAX_NODES) return UNKNOWN;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return evaluate(state, sourceFile, node.expression, keyPath, depth + 1);
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isRegularExpressionLiteral(node)) return readRegularExpression(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = evaluate(state, sourceFile, node.operand, keyPath, depth + 1);
    return typeof operand === 'number' ? -operand : UNKNOWN;
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      const value = evaluate(state, sourceFile, span.expression, keyPath, depth + 1);
      if (typeof value !== 'string' && typeof value !== 'number') return UNKNOWN;
      text += `${String(value)}${span.literal.text}`;
    }
    return text;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items: unknown[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = evaluate(state, sourceFile, element.expression, keyPath, depth + 1);
        if (!Array.isArray(spread)) return UNKNOWN;
        items.push(...(spread as unknown[]));
        continue;
      }
      const item = evaluate(state, sourceFile, element, `${keyPath}[]`, depth + 1);
      if (item === UNKNOWN) return UNKNOWN;
      items.push(item);
    }
    return items;
  }
  if (ts.isObjectLiteralExpression(node))
    return evaluateObject(state, sourceFile, node, keyPath, depth);
  if (ts.isIdentifier(node)) return evaluateIdentifier(state, sourceFile, node, keyPath, depth);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const target = evaluate(state, sourceFile, node.expression, keyPath, depth + 1);
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : evaluate(state, sourceFile, node.argumentExpression, keyPath, depth + 1);
    if (
      (!isRecord(target) && !Array.isArray(target)) ||
      (typeof key !== 'string' && typeof key !== 'number')
    ) {
      return UNKNOWN;
    }
    return Object.hasOwn(target, key) ? (target as Record<string, unknown>)[key] : UNKNOWN;
  }
  if (isRequireCall(node)) {
    return evaluateModuleRequest(state, sourceFile, {
      depth,
      exportName: 'default',
      keyPath,
      specifier: node.arguments[0].text,
    });
  }
  return UNKNOWN;
}

/** Evaluates an object literal, dropping only the members that are not data. */
function evaluateObject(
  state: EvaluationState,
  sourceFile: ts.SourceFile,
  node: ts.ObjectLiteralExpression,
  keyPath: string,
  depth: number,
): unknown {
  const output: Record<string, unknown> = {};
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = evaluate(state, sourceFile, property.expression, keyPath, depth + 1);
      if (isRecord(spread)) Object.assign(output, spread);
      else state.skipped.push(`${keyPath}.…`);
      continue;
    }
    const key = readPropertyKey(state, sourceFile, property.name, keyPath, depth);
    if (key === undefined || key === '__proto__' || key === 'constructor') continue;
    const childPath = `${keyPath}.${key}`;
    const value = ts.isPropertyAssignment(property)
      ? evaluate(state, sourceFile, property.initializer, childPath, depth + 1)
      : ts.isShorthandPropertyAssignment(property)
        ? evaluate(state, sourceFile, property.name, childPath, depth + 1)
        : UNKNOWN;
    if (value === UNKNOWN) state.skipped.push(childPath);
    else output[key] = value;
  }
  return output;
}

/** Reads identifier, string, number, and computed literal property names. */
function readPropertyKey(
  state: EvaluationState,
  sourceFile: ts.SourceFile,
  name: ts.PropertyName | undefined,
  keyPath: string,
  depth: number,
): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const value = evaluate(state, sourceFile, name.expression, keyPath, depth + 1);
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  }
  return undefined;
}

/** Follows a top-level `const` binding or an import to its data, once per binding. */
function evaluateIdentifier(
  state: EvaluationState,
  sourceFile: ts.SourceFile,
  node: ts.Identifier,
  keyPath: string,
  depth: number,
): unknown {
  if (node.text === 'undefined') return UNKNOWN;
  return memoize(state, `${sourceFile.fileName}\0${node.text}`, () =>
    resolveIdentifier(state, sourceFile, node, keyPath, depth),
  );
}

/** Evaluates one binding unless it is already known or currently being evaluated (a cycle). */
function memoize(state: EvaluationState, key: string, compute: () => unknown): unknown {
  const known = state.bindings.get(key);
  if (known === IN_PROGRESS) return UNKNOWN;
  if (state.bindings.has(key)) return known;
  state.bindings.set(key, IN_PROGRESS);
  const value = compute();
  state.bindings.set(key, value);
  return value;
}

/** Finds the declaration or import that binds one identifier at module top level. */
function resolveIdentifier(
  state: EvaluationState,
  sourceFile: ts.SourceFile,
  node: ts.Identifier,
  keyPath: string,
  depth: number,
): unknown {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === node.text &&
          declaration.initializer !== undefined
        ) {
          return evaluate(state, sourceFile, declaration.initializer, keyPath, depth + 1);
        }
        if (ts.isObjectBindingPattern(declaration.name) && declaration.initializer !== undefined) {
          const element = declaration.name.elements.find(
            (item) => ts.isIdentifier(item.name) && item.name.text === node.text,
          );
          if (element === undefined) continue;
          const source = evaluate(state, sourceFile, declaration.initializer, keyPath, depth + 1);
          const key = element.propertyName?.getText(sourceFile) ?? node.text;
          return isRecord(source) && Object.hasOwn(source, key) ? source[key] : UNKNOWN;
        }
      }
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const specifier = statement.moduleSpecifier.text;
      const request = { depth, keyPath, specifier };
      if (clause?.name?.text === node.text) {
        return evaluateModuleRequest(state, sourceFile, { ...request, exportName: 'default' });
      }
      const bindings = clause?.namedBindings;
      if (
        bindings !== undefined &&
        ts.isNamespaceImport(bindings) &&
        bindings.name.text === node.text
      ) {
        return evaluateModuleRequest(state, sourceFile, { ...request, exportName: '*' });
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        const element = bindings.elements.find((item) => item.name.text === node.text);
        if (element !== undefined) {
          const exportName = element.propertyName?.text ?? element.name.text;
          return evaluateModuleRequest(state, sourceFile, { ...request, exportName });
        }
      }
    }
  }
  return UNKNOWN;
}

/** One `import`/`require` of a binding, with the nesting depth of the expression using it. */
interface ModuleRequest {
  readonly depth: number;
  readonly exportName: string;
  readonly keyPath: string;
  readonly specifier: string;
}

/** Evaluates an imported or required binding from Tailwind data or a local project module. */
function evaluateModuleRequest(
  state: EvaluationState,
  sourceFile: ts.SourceFile,
  { depth, exportName, keyPath, specifier }: ModuleRequest,
): unknown {
  if (TAILWIND_DATA_MODULES.has(specifier)) {
    let data: unknown;
    try {
      data = state.requireTailwindData(specifier);
    } catch {
      return UNKNOWN;
    }
    const value =
      exportName === 'default' || exportName === '*'
        ? isRecord(data) && 'default' in data && exportName === 'default'
          ? (data as { readonly default: unknown }).default
          : data
        : isRecord(data)
          ? data[exportName]
          : UNKNOWN;
    return value === undefined ? UNKNOWN : value;
  }
  if (!specifier.startsWith('.')) return UNKNOWN;
  const base = path.resolve(path.dirname(sourceFile.fileName), specifier);
  const modulePath = MODULE_EXTENSIONS.map((extension) => `${base}${extension}`)
    .concat(MODULE_EXTENSIONS.slice(1).map((extension) => path.join(base, `index${extension}`)))
    .find(isFile);
  if (modulePath === undefined || !isInside(state.boundaryRoot, modulePath)) return UNKNOWN;
  return memoize(state, `${modulePath}\0export:${exportName}`, () => {
    const moduleFile = readModule(state, modulePath);
    if (moduleFile === undefined) return UNKNOWN;
    if (exportName === 'default') {
      const exported = findDefaultExport(moduleFile);
      return exported === undefined
        ? UNKNOWN
        : evaluate(state, moduleFile, exported, keyPath, depth + 1);
    }
    if (exportName === '*') return evaluateNamespace(state, moduleFile, keyPath, depth + 1);
    return evaluateExportedName(state, moduleFile, exportName, keyPath, depth + 1);
  });
}

/** Collects every exported `const` of a module as one namespace object. */
function evaluateNamespace(
  state: EvaluationState,
  moduleFile: ts.SourceFile,
  keyPath: string,
  depth: number,
): unknown {
  const namespace: Record<string, unknown> = {};
  for (const statement of moduleFile.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const value = evaluate(state, moduleFile, declaration.initializer, keyPath, depth);
      if (value !== UNKNOWN) namespace[declaration.name.text] = value;
    }
  }
  return namespace;
}

/** Evaluates `export const name = …` of a module. */
function evaluateExportedName(
  state: EvaluationState,
  moduleFile: ts.SourceFile,
  exportName: string,
  keyPath: string,
  depth: number,
): unknown {
  for (const statement of moduleFile.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === exportName &&
        declaration.initializer !== undefined
      ) {
        return evaluate(state, moduleFile, declaration.initializer, keyPath, depth);
      }
    }
  }
  return UNKNOWN;
}

/** Reports `export const …`. */
function isExported(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/** Reports `require('literal')`. */
function isRequireCall(
  node: ts.Expression,
): node is ts.CallExpression & { readonly arguments: readonly [ts.StringLiteral] } {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteral(node.arguments[0])
  );
}

/** Rebuilds a regular expression literal such as a `safelist` pattern. */
function readRegularExpression(text: string): unknown {
  const end = text.lastIndexOf('/');
  try {
    return new RegExp(text.slice(1, end), text.slice(end + 1));
  } catch {
    return UNKNOWN;
  }
}

/** Reports whether a module's real location stays inside the workspace boundary. */
function isInside(rootPath: string, modulePath: string): boolean {
  const relative = path.relative(rootPath, canonicalizeExistingPath(modulePath));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Reports an existing regular file; a directory named like a module is not one. */
function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Reports a plain data record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
