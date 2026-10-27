/** Coordinates bounded authored-source analysis for reactConditionalRendering. */
import ts from 'typescript';
import { applyPreviewReactConditionalReplacements } from './previewReactConditionalReplacements';
import { expandPreviewReactLogicalAndExpression } from './previewReactLogicalAnd';
import { createPreviewReactOverlayActivationReplacements } from './previewReactOverlayActivation';
import { createPreviewReactRenderTerminalAnalyzer } from './previewReactRenderTerminal';
import {
  registerPreviewSelectedTargetNames,
  readPreviewSelectedTargetBranch,
} from './previewSelectedTargetExit';
import { collectPreviewSelectedRenderHelperGuards } from './previewSelectedRenderHelperGuard';
import { collectPreviewSelectedPageTabDefaultReplacements } from './previewSelectedPageTabDefault';
import { instrumentReactArrayIndexRendering } from './reactArrayIndexRendering';
import {
  createPreviewRuntimeSourceSyntax,
  type PreviewRuntimeSourceSyntax,
} from './previewRuntimeSourceSyntax';
import {
  describeRenderBranch,
  describeRenderTerminalEvidence,
  inferFallbackBranch,
  isJsxRouteEntryExpression,
  isOverlayReactRenderExpression,
} from './reactConditionalBranches';
import { collectEarlyReturnGateCandidate } from './reactConditionalGuards';
import {
  MAX_CONDITIONS_PER_MODULE,
  type ReactConditionalRenderCandidate,
  type ReactDomPortalBindings,
} from './reactConditionalModel';
import {
  collectOverlayNullGuardCandidate,
  collectOverlayVisibilityCandidates,
} from './reactConditionalOverlays';
import {
  collectReactDomPortalBindings,
  findNearestOverlayRuntimeFunction,
  isReactDomPortalCall,
} from './reactConditionalOverlaySyntax';
import {
  createConditionalRenderDefinitionsRegistration,
  createConditionalRenderReplacement,
  hasParseDiagnostics,
  isJavaScriptLikeSource,
  mayContainConditionalJsx,
  selectConditionalScriptKind,
} from './reactConditionalReplacement';
import { instrumentReactSwitchRendering } from './reactSwitchRendering';

/**
 * Adds Page Inspector resolver calls to JSX-bearing `condition && child` and ternary expressions.
 *
 * Parse recovery fails closed, non-JSX boolean operations remain byte-for-byte intact, and a bounded
 * per-module inventory prevents generated application code from producing an unbounded Inspector UI.
 *
 * @param sourcePath Absolute workspace source path used for identity and parser grammar.
 * @param sourceText Source after other non-overlapping compatibility rewrites have completed.
 * @param definitionRegistrations Optional mutable output for inert metadata-only registrations.
 * @returns Instrumented source, or the original source when no supported condition was proven.
 */
export function instrumentReactConditionalRendering(
  sourcePath: string,
  sourceText: string,
  definitionRegistrations?: string[],
  selectedTargetNames?: ReadonlySet<string>,
  selectedTabHookNames?: ReadonlySet<string>,
  syntax?: PreviewRuntimeSourceSyntax,
): string {
  if (!isJavaScriptLikeSource(sourcePath)) return sourceText;
  const hasRenderSyntax = mayContainReactRenderSyntax(sourceText);
  const hasSelectedNames = (selectedTargetNames?.size ?? 0) > 0;
  if (!hasRenderSyntax && !hasSelectedNames) {
    definitionRegistrations?.push(createConditionalRenderDefinitionsRegistration(sourcePath, []));
    return sourceText;
  }
  const runtimeSyntax = syntax ?? createPreviewRuntimeSourceSyntax();
  const arrayInstrumentedSource = hasRenderSyntax
    ? instrumentReactArrayIndexRendering(sourcePath, sourceText, runtimeSyntax)
    : sourceText;
  const switchInstrumentedSource = hasRenderSyntax
    ? instrumentReactSwitchRendering(sourcePath, arrayInstrumentedSource, runtimeSyntax)
    : arrayInstrumentedSource;
  const hasConditionalJsx = mayContainConditionalJsx(switchInstrumentedSource);
  if (!hasConditionalJsx && !hasSelectedNames) {
    definitionRegistrations?.push(createConditionalRenderDefinitionsRegistration(sourcePath, []));
    return switchInstrumentedSource;
  }
  const sourceFile = runtimeSyntax.readSourceFile(
    sourcePath,
    switchInstrumentedSource,
    selectConditionalScriptKind(sourcePath),
  );
  if (hasParseDiagnostics(sourceFile)) {
    return switchInstrumentedSource;
  }
  registerPreviewSelectedTargetNames(sourceFile, selectedTargetNames);
  const candidates = [
    ...(hasConditionalJsx
      ? collectConditionalRenderCandidates(sourceFile, collectReactDomPortalBindings(sourceFile))
      : []),
    ...(hasSelectedNames ? collectPreviewSelectedRenderHelperGuards(sourceFile) : []),
  ].slice(0, MAX_CONDITIONS_PER_MODULE);
  const prepared = candidates.map((candidate, index) =>
    createConditionalRenderReplacement(sourceFile, sourcePath, candidate, index),
  );
  if (definitionRegistrations !== undefined) {
    definitionRegistrations.push(
      createConditionalRenderDefinitionsRegistration(
        sourcePath,
        prepared.map((item) => item.definition),
      ),
    );
  }
  const overlayReplacements = createPreviewReactOverlayActivationReplacements(
    sourceFile,
    prepared.flatMap((item) =>
      item.overlayActivationTerminal === undefined
        ? []
        : [
            {
              conditionId: item.conditionId,
              terminal: item.overlayActivationTerminal,
            },
          ],
    ),
  );
  const tabDefaults =
    selectedTargetNames === undefined
      ? []
      : collectPreviewSelectedPageTabDefaultReplacements(
          sourceFile,
          selectedTargetNames,
          selectedTabHookNames,
        );
  const replacements = [
    ...prepared.map((item) => item.replacement),
    ...overlayReplacements,
    ...tabDefaults,
  ];
  return applyPreviewReactConditionalReplacements(switchInstrumentedSource, replacements);
}

/** Prevents array/switch analyzers from reparsing utility modules that cannot contain React UI. */
function mayContainReactRenderSyntax(sourceText: string): boolean {
  return (
    sourceText.includes('<') ||
    sourceText.includes('React.createElement') ||
    sourceText.includes('createPortal')
  );
}

/** Collects only boolean expressions whose selected branch directly renders JSX. */
function collectConditionalRenderCandidates(
  sourceFile: ts.SourceFile,
  portalBindings: ReactDomPortalBindings,
): readonly ReactConditionalRenderCandidate[] {
  const candidates: ReactConditionalRenderCandidate[] = [];
  const logicalGuardRanges = new Set<string>();
  const terminalAnalyzer = createPreviewReactRenderTerminalAnalyzer(sourceFile, {
    isAdditionalTerminal: (expression) =>
      isReactDomPortalCall(expression, portalBindings) || isJsxRouteEntryExpression(expression),
  });
  const invokedLocalRenderFunctions = terminalAnalyzer.collectInvokedLocalRenderFunctions();
  /** Visits syntax in source order while retaining nested independent branch controls. */
  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      candidates.push(...collectOverlayVisibilityCandidates(node, sourceFile));
    }
    if (ts.isIfStatement(node)) {
      const overlayGuard = collectOverlayNullGuardCandidate(node, sourceFile, portalBindings);
      if (overlayGuard !== undefined) {
        candidates.push(overlayGuard);
      } else {
        const earlyReturnGate = collectEarlyReturnGateCandidate(
          node,
          sourceFile,
          portalBindings,
          invokedLocalRenderFunctions,
          terminalAnalyzer,
        );
        if (earlyReturnGate !== undefined) candidates.push(earlyReturnGate);
      }
    }
    const logicalAnd =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ? expandPreviewReactLogicalAndExpression(node)
        : undefined;
    const terminalEvidence =
      logicalAnd === undefined ? undefined : terminalAnalyzer.analyze(logicalAnd.terminal);
    const hasRuntimeFunction = findNearestOverlayRuntimeFunction(node) !== undefined;
    if (logicalAnd !== undefined && terminalEvidence !== undefined && hasRuntimeFunction) {
      const truthyLabel = describeRenderTerminalEvidence(
        terminalEvidence,
        sourceFile,
        portalBindings,
      );
      const role = terminalEvidence.terminals.some((terminal) =>
        isOverlayReactRenderExpression(terminal, sourceFile, portalBindings),
      )
        ? ('overlay' as const)
        : undefined;
      for (const condition of logicalAnd.guards) {
        const rangeKey = [condition.getStart(sourceFile), condition.end].join(':');
        if (logicalGuardRanges.has(rangeKey)) continue;
        logicalGuardRanges.add(rangeKey);
        candidates.push({
          condition,
          metadata: {
            falsyLabel: 'hidden',
            kind: 'logical-and',
            ...readPreviewSelectedTargetBranch(logicalAnd.terminal),
            ...(role === undefined ? {} : { role }),
            truthyLabel,
          },
          ...(role !== undefined &&
          isOverlayReactRenderExpression(logicalAnd.terminal, sourceFile, portalBindings)
            ? { overlayActivationTerminal: logicalAnd.terminal }
            : {}),
        });
      }
    } else if (ts.isConditionalExpression(node) && hasRuntimeFunction) {
      const truthyEvidence = terminalAnalyzer.analyze(node.whenTrue);
      const falsyEvidence = terminalAnalyzer.analyze(node.whenFalse);
      if (truthyEvidence !== undefined || falsyEvidence !== undefined) {
        const truthyLabel =
          truthyEvidence === undefined
            ? describeRenderBranch(node.whenTrue, sourceFile, portalBindings)
            : describeRenderTerminalEvidence(truthyEvidence, sourceFile, portalBindings);
        const falsyLabel =
          falsyEvidence === undefined
            ? describeRenderBranch(node.whenFalse, sourceFile, portalBindings)
            : describeRenderTerminalEvidence(falsyEvidence, sourceFile, portalBindings);
        const hasOverlayTerminal = [
          ...(truthyEvidence?.terminals ?? []),
          ...(falsyEvidence?.terminals ?? []),
        ].some((terminal) => isOverlayReactRenderExpression(terminal, sourceFile, portalBindings));
        candidates.push({
          condition: node.condition,
          metadata: {
            ...inferFallbackBranch(truthyLabel, falsyLabel),
            falsyLabel,
            kind: 'ternary',
            ...readPreviewSelectedTargetBranch(node.whenTrue, node.whenFalse),
            ...(hasOverlayTerminal ? { role: 'overlay' as const } : {}),
            truthyLabel,
          },
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return candidates;
}
