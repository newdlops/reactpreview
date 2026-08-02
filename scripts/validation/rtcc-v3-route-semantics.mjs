const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const parameterName = /^[A-Za-z_$][\w$]*/;

/** Parses route segments without treating escaped delimiters, nested groups, or character classes as syntax. */
export function parseRoutePattern(pattern) {
  if (typeof pattern !== "string" || !pattern.startsWith("/")) throw new Error("invalid-pattern");
  if (pattern === "/") return [];
  const segments = []; let start = 1, depth = 0, inClass = false;
  for (let index = 1; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") { index += 1; if (index >= pattern.length) throw new Error("invalid-escape"); continue; }
    if (inClass) { if (char === "]") inClass = false; continue; }
    if (char === "[") { inClass = true; continue; }
    if (char === "(") depth += 1;
    else if (char === ")") { depth -= 1; if (depth < 0) throw new Error("invalid-constraint"); }
    else if (char === "/" && depth === 0) { segments.push({ value: pattern.slice(start, index), offset: start }); start = index + 1; }
  }
  if (depth !== 0 || inClass) throw new Error("invalid-constraint");
  segments.push({ value: pattern.slice(start), offset: start });
  const names = new Set();
  return segments.map(({ value, offset }) => {
    if (value === "*") return { kind: "splat", offset };
    if (!value.startsWith(":")) return { kind: "literal", value, offset };
    const name = parameterName.exec(value.slice(1))?.[0];
    if (!name || names.has(name)) throw new Error("invalid-parameter");
    names.add(name);
    const suffix = value.slice(name.length + 1);
    if (!suffix) return { kind: "parameter", name, expression: "[^/]+", offset };
    if (!suffix.startsWith("(")) throw new Error("invalid-constraint");
    let depth = 0, inClass = false, closedAt = -1;
    for (let index = 0; index < suffix.length; index += 1) {
      const char = suffix[index];
      if (char === "\\") { index += 1; if (index >= suffix.length) throw new Error("invalid-escape"); continue; }
      if (inClass) { if (char === "]") inClass = false; continue; }
      if (char === "[") { inClass = true; continue; }
      if (char === "(") depth += 1;
      if (char === ")") { depth -= 1; if (depth < 0) throw new Error("invalid-constraint"); if (depth === 0) { closedAt = index; break; } }
    }
    if (depth !== 0 || inClass || closedAt !== suffix.length - 1) throw new Error("invalid-constraint");
    return { kind: "parameter", name, expression: suffix.slice(1, -1), offset };
  });
}

export function validateRouteDetails(entry) {
  if (!isObject(entry) || typeof entry.pattern !== "string" || typeof entry.pathname !== "string" || !isObject(entry.parameters)) return [{ code: "route-shape", offset: -1 }];
  let tokens; try { tokens = parseRoutePattern(entry.pattern); } catch { return [{ code: "route-pattern", offset: -1 }]; }
  const splatIndex = tokens.findIndex((token) => token.kind === "splat");
  if (splatIndex !== -1 && splatIndex !== tokens.length - 1) return [{ code: "nonterminal-splat", offset: tokens[splatIndex].offset }];
  if (!entry.pathname.startsWith("/")) return [{ code: "pathname-pattern-mismatch", offset: -1 }];
  const prefix = splatIndex === -1 ? tokens : tokens.slice(0, -1);
  const segments = entry.pathname === "/" ? [] : entry.pathname.slice(1).split("/");
  const errors = [];
  if ((splatIndex === -1 && segments.length !== prefix.length) || (splatIndex !== -1 && segments.length < prefix.length)) errors.push({ code: "pathname-pattern-mismatch", offset: splatIndex === -1 ? -1 : tokens[splatIndex].offset });
  for (const [index, token] of prefix.entries()) {
    const segment = segments[index];
    if (token.kind === "literal") { if (segment !== token.value) errors.push({ code: "pathname-pattern-mismatch", offset: token.offset }); continue; }
    let matched = false;
    try { matched = typeof segment === "string" && new RegExp(`^(?:${token.expression})$`).test(segment); } catch { errors.push({ code: "route-pattern", offset: token.offset }); continue; }
    if (!matched) errors.push({ code: "pathname-pattern-mismatch", offset: token.offset });
    if (typeof entry.parameters[token.name] !== "string" || entry.parameters[token.name] !== segment) errors.push({ code: "parameter-capture-mismatch", offset: token.offset });
  }
  for (const key of Object.keys(entry.parameters)) if (!prefix.some((token) => token.kind === "parameter" && token.name === key)) errors.push({ code: "unexpected-parameter", offset: -1 });
  return errors;
}

export function validateRoute(entry) { return validateRouteDetails(entry).map((error) => error.code); }

export function evaluateRouteSemantics(entries) {
  const violations = [], blockers = [];
  for (const [inventoryIndex, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    if (entry?.disposition === "unresolved") blockers.push({ inventoryIndex, id: entry.id, reason: entry.reason });
    if (entry?.disposition !== "runnable") continue;
    for (const error of validateRouteDetails(entry)) violations.push({ inventoryIndex, tokenOffset: error.offset, code: error.code, id: entry.id, nonSplat: !entry.pattern?.endsWith("/*") });
  }
  violations.sort((left, right) => left.inventoryIndex - right.inventoryIndex || left.tokenOffset - right.tokenOffset || left.code.localeCompare(right.code));
  blockers.sort((left, right) => left.inventoryIndex - right.inventoryIndex || String(left.reason).localeCompare(String(right.reason)));
  return { violations, blockers, firstViolation: violations[0] ?? null, firstBlocker: blockers[0] ?? null };
}

/** Pure authority semantic assertion; callers decide whether and how to persist its result. */
export function requireAuthoritySemanticFailure(report) {
  const violations = report?.violations ?? [], blockers = report?.blockers ?? [], entries = report?.inventory?.entries ?? [];
  const nonSplat = violations.filter((violation) => violation.nonSplat);
  const terminalSplat = violations.filter((violation) => !violation.nonSplat);
  const invalidValues = violations.map((violation) => entries[violation.inventoryIndex]?.parameters ?? {}).flatMap((parameters) => Object.values(parameters)).filter((value) => value === "aaaaaaaa");
  if (violations.length !== 31 || nonSplat.length !== 30 || terminalSplat.length !== 1 || blockers.length !== 18 || invalidValues.length !== 31 || !violations.every((violation) => violation.code === "pathname-pattern-mismatch")) throw new Error("unexpected-authority-semantic-shape");
  return true;
}
