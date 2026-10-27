/** Authored conditional-render metadata contracts and bounded instrumentation limits. */
import ts from 'typescript';
import { type PreviewReactConditionalReplacement } from './previewReactConditionalReplacements';

export const MAX_CONDITIONS_PER_MODULE = 128;

export const MAX_METADATA_TEXT_LENGTH = 180;

export const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

export const OVERLAY_COMPONENT_NAME_PATTERN =
  /(?:modal|dialog|drawer|popover|popper|popup|overlay|portal|sheet|lightbox|tooltip|toast|snackbar|dropdown|menu)$/iu;

export const POSITIVE_OVERLAY_VISIBILITY_PROPS = new Set([
  'active',
  'defaultopen',
  'defaultvisible',
  'expanded',
  'isopen',
  'isvisible',
  'open',
  'present',
  'show',
  'shown',
  'visible',
]);

export const NEGATIVE_OVERLAY_VISIBILITY_PROPS = new Set(['hidden', 'ishidden']);

/** Imported ReactDOM identities that statically prove a createPortal render expression. */
export interface ReactDomPortalBindings {
  readonly direct: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

/** Bounded literal predicate tree used to keep learned render-state choices branch-coherent. */
export type ReactConditionalScalarExpression =
  | {
      readonly kind: 'comparison';
      readonly operator: '==' | '!=' | '===' | '!==';
      readonly path: string;
      readonly value: boolean | null | number | string;
    }
  | {
      readonly kind: 'and' | 'or';
      readonly left: ReactConditionalScalarExpression;
      readonly right: ReactConditionalScalarExpression;
    }
  | {
      readonly kind: 'not';
      readonly operand: ReactConditionalScalarExpression;
    };

/** Function scopes whose own overlay guard may safely become a visibility control. */
export type OverlayRuntimeFunction =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

/** Serializable browser metadata used to label and locate one conditional tree entry. */
export interface ReactConditionalRenderMetadata {
  /** Bounded authored expression used for display and legacy static-outcome joins. */
  readonly authoredExpression: string;
  /** Whether runtime true means the opposite of the authored condition branch. */
  readonly authoredExpressionNegated?: boolean;
  /** One-based source column of the condition expression. */
  readonly column: number;
  /** Bounded human-readable condition source. */
  readonly expression: string;
  /** SHA-256 of the complete trimmed authored expression used for hot-edit-safe joins. */
  readonly expressionFingerprint: string;
  /** Branch that appears to be an authored fallback, when its component name is explicit. */
  readonly fallbackBranch?: 'falsy' | 'truthy';
  /** Label rendered when the condition resolves false. */
  readonly falsyLabel: string;
  /** Supported syntax family. */
  readonly kind: 'early-return' | 'logical-and' | 'overlay-visibility' | 'ternary';
  /** One-based source line of the condition expression. */
  readonly line: number;
  /** Absolute source identity retained inside the local webview. */
  readonly sourcePath: string;
  /** Nearest statically named render owner, used to attach a blocker to its tree position. */
  readonly ownerName?: string;
  /** Enclosing authored component when an overlay tag keeps its own display name as ownerName. */
  readonly runtimeOwnerName?: string;
  /** Optional render-control classification used for navigation and dormant overlay handling. */
  readonly role?: 'navigation' | 'overlay';
  /** Serializable scalar logic whose value can be checked against one learned hook-state choice. */
  readonly scalarExpression?: ReactConditionalScalarExpression;
  /** Set when the condition reads only its component's own useState/useReducer values. */
  readonly stateBound?: true;
  /** Whether continuing requires an authored state transition instead of a Boolean branch override. */
  readonly requiresAuthoredState?: true;
  /** Selected synchronous imported-return helper; automatic guidance requires a Boolean value. */
  readonly renderValueHelper?: true;
  /** Imported callee proven at the selected return and adjacent current render-path step. */
  readonly targetCallName?: string;
  /** Whether a one-sided terminal throw must be bypassed before the selected page can commit. */
  readonly synchronousContinuation?: true;
  /** Branch that continues toward the selected descendant after an early render exit. */
  readonly targetBranch?: 'falsy' | 'truthy';
  /** Set when the returned branch itself renders the selected target at a proven occurrence. */
  readonly targetBranchEvidence?: 'selected-target';
  /** Label rendered when the condition resolves true. */
  readonly truthyLabel: string;
}

/** Parsed condition candidate before a stable runtime identity and replacement are generated. */
export interface ReactConditionalRenderCandidate {
  /** Authored expression whose truthiness selects the JSX branch. */
  readonly condition: ts.Expression;
  /** Readable JSX attribute label used instead of repeating only its value expression. */
  readonly expressionLabel?: string;
  /** Static labels and source data exposed in the Inspector. */
  readonly metadata: Omit<
    ReactConditionalRenderMetadata,
    | 'authoredExpression'
    | 'authoredExpressionNegated'
    | 'column'
    | 'expression'
    | 'expressionFingerprint'
    | 'line'
    | 'sourcePath'
  >;
  /** Whether a negative prop such as `hidden` must invert the visible-state resolver result. */
  readonly negateRuntimeResult?: boolean;
  /** Direct overlay result whose visual props must follow an explicitly revealed mount gate. */
  readonly overlayActivationTerminal?: ts.Expression;
}

/** Condition replacement plus the identity required by an optional overlay-terminal wrapper. */
export interface PreparedReactConditionalRenderReplacement {
  readonly conditionId: string;
  /** Inert compiler evidence later emitted in one module-level registration batch. */
  readonly definition: {
    readonly id: string;
    readonly metadata: ReactConditionalRenderMetadata;
  };
  readonly overlayActivationTerminal?: ts.Expression;
  readonly replacement: PreviewReactConditionalReplacement;
}

/** One immutable property path whose absence is tested by an early-return guard. */
export interface PreviewReactGuardedAccessPath {
  readonly names: readonly string[];
}

/** Keeps source labels readable without allowing one expression to dominate persisted UI state. */
export function boundMetadataText(value: string): string {
  const normalized = value.trim();
  return normalized.length <= MAX_METADATA_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_METADATA_TEXT_LENGTH - 1)}…`;
}
