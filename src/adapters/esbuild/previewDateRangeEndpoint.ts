/**
 * Names of range endpoints that hold calendar text (`periodStart`, `promoEnd`, `valid_from`).
 *
 * Generators that pick sample text by field name treated these as ordinary labels ("Period start"),
 * so date helpers rendered "0/0" or "Invalid Date". camelCase `…From`/`…To` stay text because
 * project code uses them for colors and routes (`gradientFrom`, `to`), and so do snake_case
 * `_from`/`_to` without a period word (`assigned_to`, `reply_to`, `copied_from`).
 */
export const PREVIEW_DATE_RANGE_ENDPOINT_PATTERN =
  /(?:[a-z0-9](?:Start|End|Since|Until)|_(?:start|end|since|until)|(?:^|_)(?:valid|effective|active|available|date|period|range|promo|sale|time)_(?:from|to))$/u;

/**
 * The opening endpoint of such a range (`periodStart`, `activeSince`, `valid_from`). A typed sample
 * period opens nine days back so it holds every generated row date (rows step back one day each);
 * a one-day period hid all rows but today's (InboundTab filters rows by `periodStart`/`periodEnd`).
 */
export const PREVIEW_DATE_RANGE_START_PATTERN =
  /(?:[a-z0-9](?:Start|Since)|_(?:start|since)|(?:^|_)(?:valid|effective|active|available|date|period|range|promo|sale|time)_from)$/u;
