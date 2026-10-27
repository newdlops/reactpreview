/** Bounded child type resolution contracts and materialization budgets. */
import ts from 'typescript';

export const MAX_SOURCE_CHARACTERS = 512 * 1024;

export const MAX_OVERSIZED_SOURCE_CHARACTERS = 32 * 1024 * 1024;

export const MAX_EXTRACTED_TYPE_CHARACTERS = 256 * 1024;

export const MAX_SHAPE_NODES = 512;

export const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;

export const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'ref']);

/** Read-only workspace operations supplied by the active preview source transformer. */
export interface PreviewRuntimeHookChildTypeDemandOptions {
  /** Returns a dirty editor snapshot before falling back to TypeScript's filesystem host. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Resolves an exact authored module specifier with the active tsconfig/jsconfig aliases. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Trusted boundary outside which type source is never inspected. */
  readonly workspaceRoot: string;
}

/** Parsed source plus the syntax indexes needed for exact type/component lookup. */
export interface ParsedTypeDemandModule {
  readonly exports: ReadonlyMap<string, ExportedTypeBinding>;
  readonly file: ts.SourceFile;
  readonly imports: ReadonlyMap<string, ImportedTypeBinding>;
  /** Primitive equality literals keyed by the accessed field name in this exact module. */
  readonly literalHints: ReadonlyMap<string, boolean | number | string>;
  readonly localFunctions: ReadonlyMap<string, ComponentFunctionCandidate>;
  readonly localTypes: ReadonlyMap<string, TypeDeclaration>;
  readonly sourcePath: string;
}

/** A local or re-exported type name visible from another module. */
export interface ExportedTypeBinding {
  readonly localName?: string;
  readonly moduleSpecifier?: string;
  readonly sourceName: string;
}

/** One named/default type import before exact module resolution. */
export interface ImportedTypeBinding {
  readonly moduleSpecifier: string;
  readonly sourceName: string;
}

/** Type declarations safe to expand structurally without a TypeScript program. */
export type TypeDeclaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** Function body and contextual props type behind a direct export or local HOC chain. */
export interface ComponentFunctionCandidate {
  /** Exact variable annotation retained for ordinary imported helper function contracts. */
  readonly contextualFunctionType?: ts.TypeNode;
  readonly contextualPropsType?: ts.TypeNode;
  readonly functionLike?: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
  readonly initializer?: ts.Expression;
}

/** Active expansion budget shared by one export so wide schemas cannot exhaust the editor. */
export interface ShapeBudget {
  nodes: number;
}

/** Controls whether a present authored value may expose optional members without requiring it. */
export interface PreviewRuntimeHookChildTypeShapeOptions {
  readonly includeOptionalProperties?: boolean;
}

/** A resolved type declaration retains the module that owns its nested type references. */
export interface ResolvedTypeDeclaration {
  readonly declaration: TypeDeclaration;
  readonly module: ParsedTypeDemandModule;
}
