/**
 * Answers declared-type questions for preview source instrumentation.
 *
 * One oracle lives as long as its compiler (worker) and keeps parsed files so consecutive builds
 * reuse unchanged parses. Each build receives a lazy view: the program is created only when a
 * transform first asks for a type, with that build's roots and dirty snapshots.
 *
 * The compiler worker's heap is capped, and a heap overflow terminates the worker instead of
 * throwing, so the program's size is decided before it exists: `previewTypeHeap` derives the text
 * budget from live heap headroom, and a worker that cannot afford a useful program skips types
 * for the build.
 * Every failure path returns `undefined` so callers keep their existing syntax-derived fallbacks;
 * type analysis can improve a preview but never block or fail it.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  createPreviewNumericTextReader,
  type PreviewNumericTextReader,
} from './previewNumericTextInference';
import {
  createPreviewRecordKeyReader,
  type PreviewRecordKeyReader,
} from './previewRecordKeyInference';
import { readPreviewReturnedPayloadType } from './previewReturnedPayloadType';
import {
  isPreviewTypedCallImportBinding,
  type PreviewTypedCallImportBinding,
} from './previewTypedCallImportBinding';
import {
  readPreviewTypedComponentProps,
  type PreviewTypedPropValue,
} from './previewTypedComponentProps';
import {
  collectPreviewTypedDocumentShapes,
  PREVIEW_GRAPHQL_DOCUMENT_TEXT_PATTERN,
  type PreviewTypedDocumentShape,
} from './previewTypedDocumentShapes';
import {
  createPreviewTypedPayloadShape,
  readPreviewResponseBodyType,
  type PreviewTypedPayloadShape,
} from './previewTypedPayloadShape';
import {
  observePreviewTypeHeap,
  readPreviewTypeLiveHeapStatistics,
  selectPreviewTypeProgramBudget,
  type PreviewTypeHeapStatistics,
} from './previewTypeHeap';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
  type PreviewTypeProgram,
  type PreviewTypeProgramInput,
  type PreviewTypeProgramStatus,
} from './previewTypeProgram';
import {
  synthesizePreviewTypedValue,
  type PreviewTypedValueResult,
  type PreviewTypedValueSynthesisOptions,
} from './previewTypeValueSynthesizer';

/** One call-site question: which value would satisfy this call's declared result type? */
export interface PreviewTypedCallRequest {
  /** Exact source text of the call expression in the module being transformed. */
  readonly callText: string;
  /** Zero-based position among call expressions with identical text in that module. */
  readonly occurrence: number;
  /** Optional runtime import proof; shadowed or ambiguous receivers keep their authored result. */
  readonly receiverImport?: PreviewTypedCallImportBinding;
  /** Authored usage paths that guide union selection and optional fields. */
  readonly requiredPaths: readonly string[];
  /** Absolute module path. */
  readonly sourcePath: string;
  /** Marks nested slots of unresolved types instead of leaving them out (see synthesis options). */
  readonly unknownPlaceholders?: boolean;
}

/** Declared-type value for one call site. */
export interface PreviewTypedCallValue extends PreviewTypedValueResult {
  /** Bounded checker rendering of the declared type, for diagnostics only. */
  readonly typeText: string;
}

/** One render-guard question: which non-nullish value satisfies the guard's declared type? */
export interface PreviewTypedGuardRequest {
  /** Exact text of `guard && branch`, `guard ? branch : other`, or an early-return `!guard`. */
  readonly expressionText: string;
  /** `branch` for JSX `&&`/ternary guards (default), `negation` for `if (!guard) return`. */
  readonly kind?: 'branch' | 'negation';
  /** Zero-based position among guard expressions with identical text in that module. */
  readonly occurrence: number;
  /** Authored usage paths below the identifier (`mode`, `rows`). */
  readonly requiredPaths: readonly string[];
  /** Absolute module path. */
  readonly sourcePath: string;
}

/** One package-type question: which value would the named type exported by a module hold? */
export interface PreviewTypedModuleTypeRequest {
  /** Bare module specifier imported by the source module, such as `next-auth`. */
  readonly moduleSpecifier: string;
  /** Authored usage paths that guide union selection and optional fields. */
  readonly requiredPaths: readonly string[];
  /** Absolute module path whose import declaration names the module. */
  readonly sourcePath: string;
  /** Exported type name; module augmentations admitted to the program are merged into it. */
  readonly typeName: string;
}

/** One module-export question: which value does the export's declared type describe? */
export interface PreviewTypedExportRequest {
  /** Export name as importers see it; `default` reads the default export. */
  readonly exportName: string;
  /** Authored usage paths that guide union selection and optional fields. */
  readonly requiredPaths: readonly string[];
  /** Absolute path of the module that declares the export. */
  readonly sourcePath: string;
}

/** Declared value of one runtime export. */
export interface PreviewTypedExportValue extends PreviewTypedCallValue {
  /**
   * Whether the export is callable and its (awaited) result type admits `null`, `undefined`, or
   * `void`, or is unresolved, so a mock returning nothing is still a value of the declared type.
   */
  readonly nullableResult: boolean;
}

/** Non-nullish declared-type value for one guard identifier. */
export interface PreviewTypedGuardValue extends PreviewTypedCallValue {
  /** Whether the declared type admits null or undefined (the guard can be falsy at runtime). */
  readonly nullable: boolean;
}

/** Per-build facade consumed by the source transformer. */
export interface PreviewTypeOracleView {
  /** Returns a typed value for one call, or `undefined` when the type is unknown or unavailable. */
  readTypedCallValue(request: PreviewTypedCallRequest): PreviewTypedCallValue | undefined;
  /** Returns the non-nullish value of one guard identifier's declared type, when known. */
  readTypedGuardValue(request: PreviewTypedGuardRequest): PreviewTypedGuardValue | undefined;
  /**
   * Returns the value one runtime export's declared type describes, or `undefined` when unknown.
   * Nested slots of unresolved types carry the `unknown` tag rather than being left out.
   */
  readTypedExportValue(request: PreviewTypedExportRequest): PreviewTypedExportValue | undefined;
  /** Returns a value of one type exported by an imported module, or `undefined` when unknown. */
  readTypedModuleTypeValue(
    request: PreviewTypedModuleTypeRequest,
  ): PreviewTypedCallValue | undefined;
  /** Lists module-scope typed GraphQL documents of one module with their result payload shapes. */
  readTypedDocumentShapes(sourcePath: string): readonly PreviewTypedDocumentShape[];
  /** Resolves a declared response type node (`get<T>()`, `as T`) to its response body shape. */
  readTypedResponseShape(
    request: PreviewTypedTypeNodeRequest,
  ): PreviewTypedPayloadShape | undefined;
  /**
   * Resolves the response body shape of one promise-returning request call, such as
   * `apiClient.get<T>('/path')` on an imported HTTP client instance.
   */
  readTypedCallResponseShape(
    request: Omit<PreviewTypedCallRequest, 'requiredPaths' | 'receiverImport'>,
  ): PreviewTypedPayloadShape | undefined;
  /** Typed values for the required props of one component export (plain JSON only). */
  readTypedComponentProps(request: {
    readonly exportName: string;
    readonly sourcePath: string;
  }): Readonly<Record<string, PreviewTypedPropValue>> | undefined;
  /** Coverage of the program created for this build, or why none was created. */
  readStatus(): PreviewTypeProgramStatus | PreviewTypeSkippedStatus | undefined;
  /**
   * Drops this build's program once bundling is done; later queries return `undefined`. The
   * compiler's persistent context keeps the last transformer until the next rebuild, so without
   * this the program and checker would stay reachable between builds.
   */
  release(): void;
}

/** One response type annotation, found by exact text and order like call-site requests. */
export interface PreviewTypedTypeNodeRequest {
  /** Zero-based position among type nodes with identical text in that module. */
  readonly occurrence: number;
  /** Absolute module path. */
  readonly sourcePath: string;
  /** Exact source text of the type node. */
  readonly typeText: string;
}

/** Status of a build whose worker could not afford an analysis program. */
export interface PreviewTypeSkippedStatus {
  readonly heapLimitBytes: number;
  readonly heapUsedBytes: number;
  readonly skippedForHeap: true;
}

const MAX_TYPE_TEXT_LENGTH = 160;

/** Long-lived oracle that shares parses across builds. */
export class PreviewTypeOracle {
  private readonly cache = new PreviewTypeSourceFileCache();

  /**
   * Creates the compiler-lifetime oracle.
   *
   * @param libDirectory TypeScript ECMAScript lib directory used by every analysis program.
   * @param readHeap Reads the heap limit and live heap estimate for the admission gate; the
   *   default observes major collections from construction onward.
   */
  public constructor(
    private readonly libDirectory?: string,
    private readonly readHeap?: () => PreviewTypeHeapStatistics,
  ) {
    if (readHeap === undefined) observePreviewTypeHeap();
  }

  /**
   * Creates the lazy view for one build.
   *
   * @param input Roots, snapshots, managed dependency layers, and tsconfig for this build.
   * @returns View whose first query creates (or incrementally reuses) the analysis program.
   */
  public createView(input: PreviewTypeProgramInput): PreviewTypeOracleView {
    let current: PreviewTypeProgram | undefined;
    let status: PreviewTypeProgramStatus | PreviewTypeSkippedStatus | undefined;
    let attempted = false;
    const ensureProgram = (): PreviewTypeProgram | undefined => {
      if (attempted) return current;
      attempted = true;
      try {
        const heap = (this.readHeap ?? readPreviewTypeLiveHeapStatistics)();
        const budget = selectPreviewTypeProgramBudget(heap, this.cache.textBytes());
        if (budget === undefined) {
          // Retained parses would only compete with this build for the remaining heap.
          this.cache.clear();
          status = {
            heapLimitBytes: heap.heap_size_limit,
            heapUsedBytes: heap.used_heap_size,
            skippedForHeap: true,
          };
          return undefined;
        }
        current = createPreviewTypeProgram(
          this.libDirectory === undefined || input.libDirectory !== undefined
            ? input
            : { ...input, libDirectory: this.libDirectory },
          this.cache,
          budget,
        );
        status = current.status;
      } catch {
        current = undefined;
      }
      return current;
    };
    // One pre-order index per module and node kind, so many sites per module stay linear.
    const nodeIndexes = new Map<ts.SourceFile, Map<unknown, Map<string, ts.Node[]>>>();
    const findIndexed = <T extends ts.Node>(
      sourceFile: ts.SourceFile,
      predicate: (node: ts.Node) => node is T,
      text: string,
      occurrence: number,
    ): T | undefined => {
      let byPredicate = nodeIndexes.get(sourceFile);
      if (byPredicate === undefined) {
        byPredicate = new Map();
        nodeIndexes.set(sourceFile, byPredicate);
      }
      let byText = byPredicate.get(predicate);
      if (byText === undefined) {
        const index = new Map<string, ts.Node[]>();
        const visit = (node: ts.Node): void => {
          if (predicate(node)) {
            const key = node.getText(sourceFile);
            const nodes = index.get(key);
            if (nodes === undefined) index.set(key, [node]);
            else nodes.push(node);
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        byText = index;
        byPredicate.set(predicate, index);
      }
      return byText.get(text)?.[occurrence] as T | undefined;
    };
    const recordKeyReaders = new WeakMap<PreviewTypeProgram, PreviewRecordKeyReader>();
    const numericTextReaders = new WeakMap<PreviewTypeProgram, PreviewNumericTextReader>();
    const readNumericText = (analysis: PreviewTypeProgram): PreviewNumericTextReader => {
      let reader = numericTextReaders.get(analysis);
      if (reader === undefined) {
        reader = createPreviewNumericTextReader(analysis.program, analysis.checker);
        numericTextReaders.set(analysis, reader);
      }
      return reader;
    };
    const readRecordKeys = (analysis: PreviewTypeProgram): PreviewRecordKeyReader => {
      let reader = recordKeyReaders.get(analysis);
      if (reader === undefined) {
        reader = createPreviewRecordKeyReader(analysis.program, analysis.checker);
        recordKeyReaders.set(analysis, reader);
      }
      return reader;
    };
    const readNode = <T extends ts.Node>(
      sourcePath: string,
      find: (sourceFile: ts.SourceFile) => T | undefined,
    ): { readonly analysis: PreviewTypeProgram; readonly node: T } | undefined => {
      const analysis = ensureProgram();
      const sourceFile = analysis?.program.getSourceFile(path.normalize(sourcePath));
      const node = sourceFile === undefined ? undefined : find(sourceFile);
      return analysis === undefined || node === undefined ? undefined : { analysis, node };
    };
    const synthesize = (
      analysis: PreviewTypeProgram,
      node: ts.Node,
      type: ts.Type,
      requiredPaths: readonly string[],
      options?: PreviewTypedValueSynthesisOptions,
    ): PreviewTypedCallValue | undefined => {
      const result = synthesizePreviewTypedValue(
        analysis.checker,
        type,
        node,
        requiredPaths,
        options,
      );
      return result === undefined
        ? undefined
        : {
            ...result,
            typeText: analysis.checker.typeToString(type).slice(0, MAX_TYPE_TEXT_LENGTH),
          };
    };
    return {
      readStatus: () => status,
      release: () => {
        attempted = true;
        current = undefined;
        nodeIndexes.clear();
      },
      readTypedCallResponseShape: (request) => {
        const found = readNode(request.sourcePath, (sourceFile) =>
          findIndexed(sourceFile, ts.isCallExpression, request.callText, request.occurrence),
        );
        if (found === undefined) return undefined;
        try {
          const { checker } = found.analysis;
          const type = checker.getTypeAtLocation(found.node);
          const awaited = checker.getAwaitedType(type);
          // Only asynchronous calls can be backend requests; `map.get('/key')` stays untouched.
          if (awaited === undefined || awaited === type) return undefined;
          const ownBody = readPreviewResponseBodyType(checker, type, found.node);
          // An untyped client call takes the payload declared by the function that returns it.
          const body =
            (ownBody.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0
              ? ownBody
              : (readPreviewReturnedPayloadType(checker, found.node) ?? ownBody);
          // A raw fetch-style `Response` is a transport object, not the declared payload.
          if (
            checker.getPropertyOfType(body, 'json') !== undefined &&
            checker.getPropertyOfType(body, 'headers') !== undefined
          )
            return undefined;
          return createPreviewTypedPayloadShape(
            checker,
            body,
            found.node,
            readRecordKeys(found.analysis),
            readNumericText(found.analysis),
          );
        } catch {
          return undefined;
        }
      },
      readTypedComponentProps: (request) => {
        const analysis = ensureProgram();
        const sourceFile = analysis?.program.getSourceFile(path.normalize(request.sourcePath));
        if (analysis === undefined || sourceFile === undefined) return undefined;
        try {
          return readPreviewTypedComponentProps(analysis.checker, sourceFile, request.exportName);
        } catch {
          return undefined;
        }
      },
      readTypedResponseShape: (request) => {
        const found = readNode(request.sourcePath, (sourceFile) =>
          findIndexed(sourceFile, ts.isTypeNode, request.typeText, request.occurrence),
        );
        if (found === undefined) return undefined;
        try {
          const { checker } = found.analysis;
          const body = readPreviewResponseBodyType(
            checker,
            checker.getTypeFromTypeNode(found.node),
            found.node,
          );
          return createPreviewTypedPayloadShape(
            checker,
            body,
            found.node,
            readRecordKeys(found.analysis),
            readNumericText(found.analysis),
          );
        } catch {
          return undefined;
        }
      },
      readTypedDocumentShapes: (sourcePath) => {
        const normalizedPath = path.normalize(sourcePath);
        const available = current?.program.getSourceFile(normalizedPath);
        // A view owns immutable admitted text. Once its program exists, re-reading every module
        // adds disk work but cannot change that program's types; excluded files have no answers.
        if (attempted && available === undefined) return [];
        const text =
          available?.text ?? input.readSnapshot(normalizedPath) ?? ts.sys.readFile(sourcePath);
        if (text === undefined || !PREVIEW_GRAPHQL_DOCUMENT_TEXT_PATTERN.test(text)) return [];
        const analysis = ensureProgram();
        const sourceFile = available ?? analysis?.program.getSourceFile(normalizedPath);
        if (analysis === undefined || sourceFile === undefined) return [];
        try {
          return collectPreviewTypedDocumentShapes(
            analysis.checker,
            sourceFile,
            readNumericText(analysis),
          );
        } catch {
          return [];
        }
      },
      readTypedCallValue: (request) => {
        const found = readNode(request.sourcePath, (sourceFile) =>
          findIndexed(sourceFile, ts.isCallExpression, request.callText, request.occurrence),
        );
        if (found === undefined) return undefined;
        try {
          if (
            request.receiverImport !== undefined &&
            !isPreviewTypedCallImportBinding(
              found.analysis.checker,
              found.node,
              request.receiverImport,
            )
          ) {
            return undefined;
          }
          const type = found.analysis.checker.getTypeAtLocation(found.node);
          return synthesize(
            found.analysis,
            found.node,
            type,
            request.requiredPaths,
            request.unknownPlaceholders === true ? { unknownPlaceholders: true } : undefined,
          );
        } catch {
          return undefined;
        }
      },
      readTypedExportValue: (request) => {
        const found = readNode(request.sourcePath, (sourceFile) => sourceFile);
        if (found === undefined) return undefined;
        try {
          const { checker } = found.analysis;
          const moduleSymbol = checker.getSymbolAtLocation(found.node);
          const exported =
            moduleSymbol === undefined
              ? undefined
              : checker
                  .getExportsOfModule(moduleSymbol)
                  .find((symbol) => symbol.getName() === request.exportName);
          const target =
            exported === undefined || (exported.flags & ts.SymbolFlags.Alias) === 0
              ? exported
              : checker.getAliasedSymbol(exported);
          // A type-only export has no runtime value to describe.
          const declaration = target?.valueDeclaration;
          if (
            target === undefined ||
            declaration === undefined ||
            (target.flags & ts.SymbolFlags.Value) === 0
          ) {
            return undefined;
          }
          const type = checker.getTypeOfSymbolAtLocation(target, declaration);
          // Slots typed by unresolved packages stay marked, so the caller keeps its neutral value.
          const value = synthesize(found.analysis, declaration, type, request.requiredPaths, {
            unknownPlaceholders: true,
          });
          const signature = type.getCallSignatures()[0];
          return value === undefined
            ? undefined
            : {
                ...value,
                nullableResult:
                  signature !== undefined &&
                  admitsNullishResult(checker, checker.getReturnTypeOfSignature(signature)),
              };
        } catch {
          return undefined;
        }
      },
      readTypedModuleTypeValue: (request) => {
        const found = readNode(
          request.sourcePath,
          (sourceFile) =>
            sourceFile.statements.find(
              (
                statement,
              ): statement is ts.ImportDeclaration & { moduleSpecifier: ts.StringLiteral } =>
                ts.isImportDeclaration(statement) &&
                ts.isStringLiteral(statement.moduleSpecifier) &&
                statement.moduleSpecifier.text === request.moduleSpecifier,
            )?.moduleSpecifier,
        );
        if (found === undefined) return undefined;
        try {
          const { checker } = found.analysis;
          const moduleSymbol = checker.getSymbolAtLocation(found.node);
          const exported =
            moduleSymbol === undefined
              ? undefined
              : checker
                  .getExportsOfModule(moduleSymbol)
                  .find((symbol) => symbol.getName() === request.typeName);
          if (exported === undefined) return undefined;
          const declared = checker.getDeclaredTypeOfSymbol(
            (exported.flags & ts.SymbolFlags.Alias) === 0
              ? exported
              : checker.getAliasedSymbol(exported),
          );
          return synthesize(found.analysis, found.node, declared, request.requiredPaths);
        } catch {
          return undefined;
        }
      },
      readTypedGuardValue: (request) => {
        const found = readNode(request.sourcePath, (sourceFile) =>
          request.kind === 'negation'
            ? readPreviewNegatedIdentifier(
                findIndexed(
                  sourceFile,
                  isPreviewNegation,
                  request.expressionText,
                  request.occurrence,
                ),
              )
            : readPreviewGuardIdentifier(
                findIndexed(
                  sourceFile,
                  isPreviewGuardExpression,
                  request.expressionText,
                  request.occurrence,
                ),
              ),
        );
        if (found === undefined) return undefined;
        try {
          const { checker } = found.analysis;
          const type = checker.getTypeAtLocation(found.node);
          const nonNullable = checker.getNonNullableType(type);
          const value = synthesize(found.analysis, found.node, nonNullable, request.requiredPaths);
          return value === undefined ? undefined : { ...value, nullable: nonNullable !== type };
        } catch {
          return undefined;
        }
      },
    };
  }

  /** Releases retained parses. */
  public clear(): void {
    this.cache.clear();
  }
}

/** Build facts used to choose analysis roots; structural so the oracle stays plan-agnostic. */
export interface PreviewBuildTypeOracleInput {
  /** Managed dependency layers that the esbuild graph also resolves against. */
  readonly managedNodeModulesPaths: readonly string[];
  /** Selected Page Inspector plan whose target and page root seed the analysis program. */
  readonly plan:
    | {
        readonly root: { readonly sourcePath: string };
        readonly target: { readonly sourcePath: string };
      }
    | undefined;
  /**
   * Project declaration files that augment imported packages. The program follows imports only,
   * so an ambient `declare module` file is otherwise missing from the declared types.
   */
  readonly augmentationPaths?: readonly string[];
  /** Current build request (document path and optional explicit tsconfig). */
  readonly request: { readonly documentPath: string; readonly tsconfigPath?: string };
  /** Declaration modules served for bare specifiers instead of normal resolution. */
  readonly virtualModules?: readonly {
    readonly path: string;
    readonly specifier: string;
    readonly text: string;
  }[];
  /** Canonical path to dirty editor contents for this build. */
  readonly snapshotSourceByPath: ReadonlyMap<string, string>;
}

/**
 * Creates one build's oracle view rooted at the edited document and its authored page corridor.
 *
 * @param oracle Compiler-lifetime oracle that owns cross-build reuse.
 * @param input Build facts from the compiler.
 * @returns Lazy view; creating it performs no TypeScript work.
 */
export function createPreviewBuildTypeOracleView(
  oracle: PreviewTypeOracle,
  input: PreviewBuildTypeOracleInput,
): PreviewTypeOracleView {
  const virtualTexts = new Map(
    (input.virtualModules ?? []).map((module) => [path.normalize(module.path), module.text]),
  );
  return oracle.createView({
    managedNodeModulesPaths: input.managedNodeModulesPaths,
    ...(input.virtualModules === undefined || input.virtualModules.length === 0
      ? {}
      : {
          moduleOverrides: new Map(
            input.virtualModules.map((module) => [module.specifier, path.normalize(module.path)]),
          ),
        }),
    readSnapshot: (sourcePath) =>
      virtualTexts.get(sourcePath) ?? input.snapshotSourceByPath.get(sourcePath),
    rootPaths: [
      input.request.documentPath,
      ...(input.plan === undefined
        ? []
        : [input.plan.target.sourcePath, input.plan.root.sourcePath]),
      ...(input.augmentationPaths ?? []),
    ],
    ...(input.request.tsconfigPath === undefined
      ? {}
      : { tsconfigPath: input.request.tsconfigPath }),
  });
}

/** Reports whether a call result, once awaited, may be nullish or is of an unresolved type. */
function admitsNullishResult(checker: ts.TypeChecker, returnType: ts.Type): boolean {
  const awaited = checker.getAwaitedType(returnType) ?? returnType;
  const nullish =
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Void;
  return (awaited.isUnion() ? awaited.types : [awaited]).some(
    (member) => (member.flags & nullish) !== 0,
  );
}

/** Reports a `guard && branch` or `guard ? branch : other` expression. */
export function isPreviewGuardExpression(
  node: ts.Node,
): node is ts.BinaryExpression | ts.ConditionalExpression {
  return (
    ts.isConditionalExpression(node) ||
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
  );
}

/** Reports a logical negation such as the `!row` in `if (!row) return null`. */
export function isPreviewNegation(node: ts.Node): node is ts.PrefixUnaryExpression {
  return ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken;
}

/** Returns the bare identifier negated by `!identifier`, unwrapping parentheses. */
export function readPreviewNegatedIdentifier(
  negation: ts.PrefixUnaryExpression | undefined,
): ts.Identifier | undefined {
  let operand: ts.Expression | undefined = negation?.operand;
  while (operand !== undefined && ts.isParenthesizedExpression(operand))
    operand = operand.expression;
  return operand !== undefined && ts.isIdentifier(operand) ? operand : undefined;
}

/** Returns the bare identifier tested by a guard expression, unwrapping parentheses. */
export function readPreviewGuardIdentifier(
  guard: ts.BinaryExpression | ts.ConditionalExpression | undefined,
): ts.Identifier | undefined {
  if (guard === undefined) return undefined;
  let tested: ts.Expression = ts.isConditionalExpression(guard) ? guard.condition : guard.left;
  while (ts.isParenthesizedExpression(tested)) tested = tested.expression;
  return ts.isIdentifier(tested) ? tested : undefined;
}

/**
 * Finds the N-th node accepted by `predicate` whose source text matches exactly.
 * Matching by text and order tolerates earlier compatibility rewrites that shifted offsets and
 * refuses to answer when the authored text itself diverged.
 *
 * @param sourceFile Program-owned parse of the module.
 * @param predicate Node kind accepted as a match.
 * @param text Exact node text from the transform input.
 * @param occurrence Zero-based index among accepted nodes with identical text.
 * @returns Matching node, or `undefined` when the module text diverged.
 */
export function findPreviewNodeByText<T extends ts.Node>(
  sourceFile: ts.SourceFile,
  predicate: (node: ts.Node) => node is T,
  text: string,
  occurrence: number,
): T | undefined {
  let seen = 0;
  let match: T | undefined;
  const visit = (node: ts.Node): void => {
    if (match !== undefined) return;
    if (predicate(node) && node.getText(sourceFile) === text) {
      if (seen === occurrence) {
        match = node;
        return;
      }
      seen += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}
