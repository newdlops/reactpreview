/**
 * Names the timestamps whose presence marks an ending state of a record (deleted, archived,
 * suspended, cancelled, expired, purged). Pages test them to open tombstone, deletion, or
 * suspension notices, so a sample value is the ordinary live state: no such timestamp. Other
 * timestamp names hold an ordinary instant that sample values place on the current day.
 */

/** Timestamp of an ending state, such as `deletedAt`, `purged_at`, or `deletionScheduledAt`. */
export const PREVIEW_LIFECYCLE_END_TIMESTAMP_PATTERN =
  /(?:deleted|deletion|archived|suspended|banned|revoked|cancell?ed|cancellation|expired|purged|deactivated|terminated)(?:scheduled|requested)?_?(?:at|on|date|time)$/iu;

/** Ordinary timestamp name, such as `createdAt`, `start_date`, or `timestamp`. */
export const PREVIEW_TIMESTAMP_NAME_PATTERN =
  /(?:_at|[a-z]At|_on|_date|[a-z]Date|_time|[a-z]Time|[tT]imestamp)$|^(?:date|time)$/u;

/** Accessor names that read like timestamps but are methods (`getTime`, `toDate`). */
const ACCESSOR_NAME_PATTERN = /^(?:get|set|to)[A-Z]/u;

/**
 * Reports a property name that holds an ordinary (non-ending) timestamp.
 *
 * @param name Property name.
 * @returns Whether a sample value should be today's instant.
 */
export function isPreviewOrdinaryTimestampName(name: string): boolean {
  return (
    PREVIEW_TIMESTAMP_NAME_PATTERN.test(name) &&
    !ACCESSOR_NAME_PATTERN.test(name) &&
    !PREVIEW_LIFECYCLE_END_TIMESTAMP_PATTERN.test(name)
  );
}
