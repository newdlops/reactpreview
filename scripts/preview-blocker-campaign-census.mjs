/** Classifies authored source syntax and chooses deterministic breadth strata without executing project code. */
import path from 'node:path';
import typescript from 'typescript';

export const CENSUS_SOURCE_BYTE_LIMIT = 2 * 1024 * 1024;

export const CENSUS_NODE_LIMIT = 50_000;

/** Stable, framework-general blocker families emitted by the static census. */
export const PREVIEW_BLOCKER_SIGNATURE_FAMILIES = Object.freeze([
  'apollo-graphql',
  'authored-throw',
  'browser-capability',
  'dynamic-import',
  'environment',
  'formik',
  'network',
  'portal-dom',
  'provider-context',
  'redirect',
  'redux',
  'router',
  'styled-theme',
  'style-asset',
]);

/** Returns a source-only category for syntax that can affect isolated preview execution. */
export function censusFamily(node) {
  if (typescript.isThrowStatement(node)) return 'authored-throw';
  if (typescript.isImportCall(node)) return 'dynamic-import';
  if (typescript.isCallExpression(node)) {
    const text = node.expression.getText();
    if (/^(?:ReactDOM\.)?createPortal$/u.test(text)) return 'portal-dom';
    if (/^(?:window\.)?(?:fetch|XMLHttpRequest)$/u.test(text)) return 'network';
    if (/^(?:history\.)?(?:push|replace)$/u.test(text) || /^navigate$/u.test(text))
      return 'redirect';
  }
  if (typescript.isImportDeclaration(node)) {
    const moduleName =
      typeof node.moduleSpecifier.text === 'string' ? node.moduleSpecifier.text : '';
    if (/\.(?:css|s[ac]ss|less|svg|png|jpe?g|gif|webp|woff2?)$/iu.test(moduleName))
      return 'style-asset';
    if (/(?:apollo|graphql)/iu.test(moduleName)) return 'apollo-graphql';
    if (/formik/iu.test(moduleName)) return 'formik';
    if (/(?:redux|react-redux)/iu.test(moduleName)) return 'redux';
    if (/(?:react-router|router)/iu.test(moduleName)) return 'router';
    if (/(?:styled-components|emotion)/iu.test(moduleName)) return 'styled-theme';
  }
  if (typescript.isIdentifier(node)) {
    if (node.text === 'process' || node.text === 'global') return 'environment';
    if (node.text === 'window' || node.text === 'document' || node.text === 'navigator')
      return 'browser-capability';
    if (/^(?:useContext|createContext|Provider)$/u.test(node.text)) return 'provider-context';
  }
  return undefined;
}

export function hasRuntimeExport(source) {
  if (/\.d\.ts$/iu.test(source.fileName)) return false;
  return source.statements.some((statement) => {
    if (typescript.isExportAssignment(statement)) return !statement.isExportEquals;
    if (typescript.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined) return statement.isTypeOnly !== true;
      if (statement.isTypeOnly === true || statement.exportClause?.isTypeOnly === true)
        return false;
      if (typescript.isNamedExports(statement.exportClause))
        return statement.exportClause.elements.some((specifier) => specifier.isTypeOnly !== true);
      return (
        statement.exportClause === undefined || typescript.isNamespaceExport(statement.exportClause)
      );
    }
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword,
    );
    if (!exported) return false;
    if (
      typescript.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === typescript.SyntaxKind.DeclareKeyword,
      )
    )
      return false;
    if (
      typescript.isClassDeclaration(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === typescript.SyntaxKind.DeclareKeyword,
      )
    )
      return false;
    if (
      typescript.isFunctionDeclaration(statement) &&
      (statement.modifiers?.some(
        (modifier) => modifier.kind === typescript.SyntaxKind.DeclareKeyword,
      ) ||
        statement.body === undefined)
    )
      return false;
    return (
      !typescript.isInterfaceDeclaration(statement) &&
      !typescript.isTypeAliasDeclaration(statement) &&
      !typescript.isImportDeclaration(statement)
    );
  });
}

/**
 * Produces a bounded, identifier-free AST signature census for one authored source file.
 * Signature names deliberately contain only family and syntax-kind; paths remain private manifest data.
 */
export function censusPreviewBlockerSource(sourceText, fileName = 'source.tsx') {
  if (Buffer.byteLength(sourceText, 'utf8') > CENSUS_SOURCE_BYTE_LIMIT)
    return Object.freeze({ bucket: 'oversized', exportable: false, signatures: Object.freeze([]) });
  const source = typescript.createSourceFile(
    fileName,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
  );
  const signatures = new Set();
  let nodeCount = 0;
  let overBudget = false;
  const visit = (node) => {
    if (++nodeCount > CENSUS_NODE_LIMIT) {
      overBudget = true;
      return;
    }
    const family = censusFamily(node);
    if (family !== undefined) signatures.add(`${family}:${typescript.SyntaxKind[node.kind]}`);
    typescript.forEachChild(node, visit);
  };
  visit(source);
  if (overBudget)
    return Object.freeze({ bucket: 'oversized', exportable: false, signatures: Object.freeze([]) });
  if (source.parseDiagnostics.length > 0)
    return Object.freeze({ bucket: 'malformed', exportable: false, signatures: Object.freeze([]) });
  return Object.freeze({
    bucket: hasRuntimeExport(source) ? 'ready' : 'non-exportable',
    exportable: hasRuntimeExport(source),
    signatures: Object.freeze([...signatures].sort()),
  });
}

/** Greedily selects files that cover the most uncovered signatures, with lexical tie breaking. */
export function selectPreviewBlockerCensusTargets(candidates, cap = 200) {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 200)
    throw new Error('Campaign target cap is invalid.');
  const remaining = new Set(
    candidates
      .filter((candidate) => candidate.exportable)
      .flatMap((candidate) => candidate.signatures),
  );
  const available = candidates
    .filter((candidate) => candidate.exportable)
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  const breadthStrata = [
    ...new Set(available.map((candidate) => candidate.stratum ?? 'default')),
  ].sort();
  const selected = [];
  // Historical blockers are regression anchors. Retain them even when their signatures are now
  // redundant, before coverage rotation considers newly discovered surfaces.
  for (const candidate of [...available].filter((value) => value.historical === true)) {
    if (selected.length >= cap) break;
    available.splice(available.indexOf(candidate), 1);
    selected.push(candidate);
    candidate.signatures.forEach((signature) => remaining.delete(signature));
  }
  while (available.length > 0 && selected.length < cap) {
    const selectedStratum = breadthStrata
      .slice(selected.length % breadthStrata.length)
      .concat(breadthStrata.slice(0, selected.length % breadthStrata.length))
      .find((stratum) =>
        available.some((candidate) => (candidate.stratum ?? 'default') === stratum),
      );
    const eligible = available.filter(
      (candidate) => (candidate.stratum ?? 'default') === selectedStratum,
    );
    const ranked = (eligible.length > 0 ? eligible : available).sort((left, right) => {
      const leftHistorical = left.historical === true ? 1 : 0;
      const rightHistorical = right.historical === true ? 1 : 0;
      const leftCoverage = left.signatures.filter((signature) => remaining.has(signature)).length;
      const rightCoverage = right.signatures.filter((signature) => remaining.has(signature)).length;
      return (
        rightHistorical - leftHistorical ||
        rightCoverage - leftCoverage ||
        left.sourcePath.localeCompare(right.sourcePath)
      );
    });
    let next = ranked.find((candidate) =>
      candidate.signatures.some((signature) => remaining.has(signature)),
    );
    if (next === undefined)
      next = [...available]
        .sort(
          (left, right) =>
            right.signatures.filter((signature) => remaining.has(signature)).length -
              left.signatures.filter((signature) => remaining.has(signature)).length ||
            left.sourcePath.localeCompare(right.sourcePath),
        )
        .find((candidate) => candidate.signatures.some((signature) => remaining.has(signature)));
    if (next === undefined && remaining.size === 0) next = ranked[0] ?? available[0];
    if (next === undefined) break;
    available.splice(available.indexOf(next), 1);
    selected.push(next);
    next.signatures.forEach((signature) => remaining.delete(signature));
  }
  return Object.freeze({
    selected: Object.freeze(selected),
    uncoveredSignatures: Object.freeze([...remaining].sort()),
  });
}

/**
 * Creates a generic, root-relative breadth bucket without inspecting project identifiers.
 * The first two authored directory levels distinguish page/render surfaces while remaining bounded
 * and deterministic for repositories with arbitrary layouts.
 */
export function derivePreviewBlockerBreadthStratum(sourcePath, root, rootStratum = 'default') {
  const relative = path.relative(root, sourcePath);
  const segments = path
    .dirname(relative)
    .split(path.sep)
    .filter((value) => value && value !== '.')
    .slice(0, 2);
  const surface = segments.length === 0 ? 'root' : segments.join('/').slice(0, 120);
  return `${rootStratum}:${surface}`;
}
