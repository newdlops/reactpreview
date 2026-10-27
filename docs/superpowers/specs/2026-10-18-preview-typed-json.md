# Typed document analysis projection

Reduce cold TypeScript parsing and retained heap for large generated GraphQL modules while
preserving preview features. The measured module contains megabytes of strict JSON under
`as unknown as DocumentNode<Result, Variables>` assertions. Its asserted types, rather than
the JSON implementation, supply preview payload shapes.

Only the private, analysis-only TypeScript program may replace these payloads. Runtime source,
bundles, providers, routers, readiness, all admission limits, and inference limits remain unchanged.
Source text and UTF-16 positions must remain original. Removed subtrees must charge their exact
original syntax-node cost to record-key inference, including duplicate keys and negative numbers.

Candidates are single-line, explicitly terminated exported constants in ordinary TypeScript files.
Require strict JSON objects with `kind: 'Document'` and array `definitions`, a double unknown
assertion, and a two-argument DocumentNode/TypedDocumentNode type reference. Verify every candidate
against the parsed projected file's actual top-level declarations before using any projection.
Any ambiguity, unsupported grammar, parse error, or verification failure falls back for the whole
file to the original TypeScript parse. Never expose projected trees to runtime transformations.

Acceptance: fewer parsed nodes/heap; identical declared document shapes, exported/checker types,
query lookup, original text/positions, dirty-edit behavior, admission coverage, and record-key
budget outcomes. Compare fresh-worker compilation on small, application, and leaf targets with
alternating order; retain unfavorable samples. Compare all browser artifacts and actual readiness.
Report whole-preview time separately from parser measurements and do not generalize noisy timings.

Use no new dependency or system service. The reference project remains read-only. Temporary
listeners bind only to 127.1.0.1. Preserve existing settings and learning. After a retained change,
run the complete repository check and package/install one patch release with exact bundle checks.
