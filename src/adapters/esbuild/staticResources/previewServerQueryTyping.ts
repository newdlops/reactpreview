/**
 * Gives Prisma-style query calls on render-only server contracts the result their call site
 * declares. A contract (for example a `server-only` `lib/prisma.ts`) can only answer neutral
 * values, which have no fields to spread or select, while the project's generated client types
 * compute each call's exact payload, including `select`ed relations. Calls whose receiver comes
 * from a contract module are wrapped only when the checker proves the receiver's import binding,
 * so local shadows retain their results. Contract calls settle to that payload; unresolved types
 * (free-form JSON) keep the contract's neutral value, and string columns take the schema's
 * `@default("…")` when the project declares one.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  applyPreviewPrismaColumnDefaults,
  findPreviewPrismaDelegateModel,
  type PreviewPrismaColumnDefaults,
} from '../previewPrismaColumnDefaults';
import { PREVIEW_PRISMA_QUERY_METHOD_PATTERN } from '../previewPrismaQueryMethods';
import { createPreviewTypedValueExpression } from '../typeOracle/previewTypedValueExpression';
import type { PreviewTypedCallImportBinding } from '../typeOracle/previewTypedCallImportBinding';
import type { PreviewTypeOracleView } from '../typeOracle/previewTypeOracle';
import {
  PREVIEW_TYPED_VALUE_TAG,
  type PreviewTypedValue,
} from '../typeOracle/previewTypeValueSynthesizer';

const MAX_TYPED_QUERIES_PER_MODULE = 64;
const QUERY_HELPER = '__reactPreviewTypedServerQuery';
const NEUTRAL_PARAMETER = '__reactPreviewNeutral';
const QUERY_TEXT_PATTERN =
  /\.\s*(?:find|create|update|upsert|delete|count|aggregate|groupBy|\$queryRaw|\$executeRaw|\$transaction)/u;

/** Build facts for one module. */
export interface PreviewServerQueryTypingOptions {
  /** Canonical paths of modules served as render-only server contracts in this build. */
  readonly contractSourcePaths: ReadonlySet<string>;
  /** Build-scoped declared-type oracle. */
  readonly oracle: PreviewTypeOracleView;
  /** String column defaults of the project's Prisma schema, applied by the queried model. */
  readonly prismaColumnDefaults?: PreviewPrismaColumnDefaults;
  /** Resolves an import specifier from the module to an absolute path. */
  readonly resolveModule: (specifier: string, importerPath: string) => string | undefined;
}

/**
 * Wraps contract query calls with their declared results.
 *
 * @param sourcePath Absolute module path.
 * @param sourceText Module text.
 * @param options Contract paths, oracle, and resolver.
 * @returns The text with typed query calls, or the same text when nothing applies.
 */
export function typePreviewServerQueries(
  sourcePath: string,
  sourceText: string,
  options: PreviewServerQueryTypingOptions,
): string {
  if (options.contractSourcePaths.size === 0 || !QUERY_TEXT_PATTERN.test(sourceText)) {
    return sourceText;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/u.test(sourcePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const contractBindings = readContractBindings(sourceFile, sourcePath, options);
  if (contractBindings.size === 0) return sourceText;
  const insertions: { readonly position: number; readonly text: string }[] = [];
  const occurrences = new Map<string, number>();
  let typedQueries = 0;
  const visit = (node: ts.Node): true | undefined => {
    if (typedQueries >= MAX_TYPED_QUERIES_PER_MODULE) return true;
    if (ts.isCallExpression(node)) {
      const receiverImport = readContractQueryImport(node, contractBindings);
      if (receiverImport !== undefined) {
        // Identical call text has the same receiver syntax. Count candidates even when shadowed,
        // preserving the oracle's preorder occurrence while avoiding unrelated call strings.
        const callText = node.getText(sourceFile);
        const occurrence = occurrences.get(callText) ?? 0;
        occurrences.set(callText, occurrence + 1);
        const settled = readSettledValue(
          options.oracle.readTypedCallValue({
            callText,
            occurrence,
            receiverImport,
            requiredPaths: [],
            sourcePath,
            unknownPlaceholders: true,
          })?.value,
        );
        const model =
          options.prismaColumnDefaults === undefined
            ? undefined
            : readDelegateModel(node, options.prismaColumnDefaults);
        const value =
          settled === undefined || model === undefined || options.prismaColumnDefaults === undefined
            ? settled
            : applyPreviewPrismaColumnDefaults(settled, model, options.prismaColumnDefaults);
        if (value !== undefined) {
          typedQueries += 1;
          insertions.push(
            { position: node.getStart(sourceFile), text: `${QUERY_HELPER}(` },
            {
              position: node.getEnd(),
              text: `, (${NEUTRAL_PARAMETER}) => (${createPreviewTypedValueExpression(value, NEUTRAL_PARAMETER)}))`,
            },
          );
        }
      }
    }
    return ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (insertions.length === 0) return sourceText;
  const pieces: string[] = [];
  let end = sourceText.length;
  // Collect each source interval once instead of copying the complete module for every insertion.
  // Later positions first; at one position a closing suffix precedes an opening prefix.
  for (const insertion of [...insertions].sort((left, right) => right.position - left.position)) {
    pieces.push(sourceText.slice(insertion.position, end), insertion.text);
    end = insertion.position;
  }
  pieces.push(sourceText.slice(0, end));
  const result = pieces.reverse().join('');
  return `${result}${result.endsWith('\n') ? '' : '\n'}/** Settles a server contract query to its declared result. */\nfunction ${QUERY_HELPER}(pending, build) { return Promise.resolve(pending).then((neutral) => build(neutral)); }\n`;
}

/** Collects local names imported from contract modules. */
function readContractBindings(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  options: PreviewServerQueryTypingOptions,
): ReadonlyMap<string, PreviewTypedCallImportBinding> {
  const bindings = new Map<string, PreviewTypedCallImportBinding>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause === undefined ||
      statement.importClause.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const resolved = options.resolveModule(statement.moduleSpecifier.text, sourcePath);
    if (resolved === undefined || !options.contractSourcePaths.has(path.normalize(resolved))) {
      continue;
    }
    const clause = statement.importClause;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const append = (localName: string): void => {
      bindings.set(localName, { localName, moduleSpecifier });
    };
    if (clause.name !== undefined) append(clause.name.text);
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamespaceImport(named)) append(named.name.text);
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (!element.isTypeOnly) append(element.name.text);
      }
    }
  }
  return bindings;
}

/** Reports `binding.model.findMany(…)`-style calls rooted at a contract binding. */
function readContractQueryImport(
  node: ts.CallExpression,
  bindings: ReadonlyMap<string, PreviewTypedCallImportBinding>,
): PreviewTypedCallImportBinding | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!PREVIEW_PRISMA_QUERY_METHOD_PATTERN.test(node.expression.name.text)) return undefined;
  let receiver: ts.Expression = node.expression.expression;
  while (ts.isPropertyAccessExpression(receiver)) receiver = receiver.expression;
  return ts.isIdentifier(receiver) ? bindings.get(receiver.text) : undefined;
}

/** Reads the model of a `binding.delegate.method(…)` call from its delegate name. */
function readDelegateModel(
  node: ts.CallExpression,
  columns: PreviewPrismaColumnDefaults,
): string | undefined {
  const method = node.expression;
  return ts.isPropertyAccessExpression(method) && ts.isPropertyAccessExpression(method.expression)
    ? findPreviewPrismaDelegateModel(columns, method.expression.name.text)
    : undefined;
}

/** Reads the settled descriptor of a promise-typed call value. */
function readSettledValue(value: PreviewTypedValue | undefined): PreviewTypedValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, PreviewTypedValue>>;
  return record[PREVIEW_TYPED_VALUE_TAG] === 'promise' && record.value !== undefined
    ? record.value
    : undefined;
}
