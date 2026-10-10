/**
 * Recognizes declared string fields that hold calendar text although their names do not say "date".
 *
 * Name rules caught `created_at`, `openDate`, or `releaseDate`, but project types also keep dates in
 * range endpoints (`periodStart`, `promoEnd`, `valid_from`) and in fields documented only by their
 * comment (`start: string // 'YYYY-MM-DD'`, SimSheet's `current: string` "W0(이번 주) 월요일").
 * Those got a key label such as "Current", and date helpers rendered "0/0" or "Invalid Date".
 * Endpoints named `…From`/`…To` in camelCase stay text: `gradientFrom` is a color, `to` a route.
 */
import ts from 'typescript';
import { PREVIEW_DATE_RANGE_ENDPOINT_PATTERN } from '../previewDateRangeEndpoint';

/**
 * Calendar text kind: a `YYYY-MM-DD` day, an ISO date-time, or a year-less `'M/D'` table day
 * (`'MM/DD'` when zero-padded), as SKUTable's documented `depleteMD` showed "Deplete md".
 */
export type PreviewDateTextKind = 'date' | 'date-time' | 'month-day' | 'month-day-padded';

/** Comment wording that documents a calendar value. */
const DATE_COMMENT =
  /(?:YYYY|yyyy)[-/.]?MM|ISO[ -]?8601|날짜|일자|[월화수목금토일]요일|\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/u;

/** Comment wording that documents a year-less month/day (`'M/D'`, `MM/DD`). */
const MONTH_DAY_COMMENT = /(?<![A-Za-z])(M{1,2})\/(D{1,2})(?![A-Za-z])/u;

/** Comment wording that documents a time of day as well. */
const DATE_TIME_COMMENT = /(?:HH|hh):mm|ISO[ -]?8601|T\d{2}:\d{2}/u;

/** Returns the calendar text a declared string field holds, or undefined for ordinary text. */
export function readPreviewDateTextEvidence(
  name: string,
  declaration: ts.Node | undefined,
): PreviewDateTextKind | undefined {
  if (PREVIEW_DATE_RANGE_ENDPOINT_PATTERN.test(name)) return 'date';
  const comment = readDeclarationComment(declaration);
  if (comment === undefined) return undefined;
  if (!DATE_COMMENT.test(comment)) {
    const monthDay = MONTH_DAY_COMMENT.exec(comment);
    if (monthDay === null) return undefined;
    return monthDay[1] === 'MM' ? 'month-day-padded' : 'month-day';
  }
  return DATE_TIME_COMMENT.test(comment) ? 'date-time' : 'date';
}

/** Reads the comments directly before and after the property or parameter owning a type node. */
function readDeclarationComment(node: ts.Node | undefined): string | undefined {
  let current = node;
  for (let steps = 0; current !== undefined && steps < 4; steps += 1) {
    if (
      ts.isPropertySignature(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isParameter(current)
    ) {
      break;
    }
    current = (current as { readonly parent?: ts.Node }).parent;
  }
  if (
    current === undefined ||
    !(
      ts.isPropertySignature(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isParameter(current)
    )
  ) {
    return undefined;
  }
  const text = current.getSourceFile().text;
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, current.getFullStart()) ?? []),
    ...(ts.getTrailingCommentRanges(text, current.getEnd()) ?? []),
  ];
  const comment = ranges.map((range) => text.slice(range.pos, range.end)).join('\n');
  return comment.length === 0 ? undefined : comment;
}
