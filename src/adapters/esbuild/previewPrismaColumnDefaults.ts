/**
 * Gives typed Prisma query results the string defaults the project's schema declares. A free-form
 * `String` column such as `status String @default("draft")` otherwise gets a key-derived label
 * ("Status"), which the project's own allow-list checks reject (`toIrEventStatus` returning null
 * sends the IR selection console to `notFound()`). The default is the value a new row holds, read
 * from the schema rather than invented. Relations are followed through the schema, so `select`,
 * `include`, and nested rows are covered alike.
 */
import { readFile } from 'node:fs/promises';
import { findPreviewPrismaSchemaFiles } from './previewPrismaClientTypes';
import { parsePreviewPrismaSchema } from './typeOracle/previewPrismaSchemaDeclaration';
import {
  PREVIEW_TYPED_VALUE_TAG,
  type PreviewTypedValue,
} from './typeOracle/previewTypeValueSynthesizer';

/** One model's string column defaults and relation targets. */
interface PreviewPrismaModelColumns {
  /** Column name to its `@default("…")` text. */
  readonly defaults: ReadonlyMap<string, string>;
  /** Relation field name to the related model's name. */
  readonly relations: ReadonlyMap<string, string>;
}

/** String column defaults of one schema, by model name. */
export interface PreviewPrismaColumnDefaults {
  readonly models: ReadonlyMap<string, PreviewPrismaModelColumns>;
}

const MAX_DEPTH = 6;
const MAX_CACHED_SCHEMAS = 8;
const defaultsBySchema = new Map<string, PreviewPrismaColumnDefaults | undefined>();

/**
 * Reads the string column defaults of a project's Prisma schema.
 *
 * @param projectRoot Package boundary whose schema is read.
 * @returns Defaults by model, or `undefined` when no schema declares a string default.
 */
export async function collectPreviewPrismaColumnDefaults(
  projectRoot: string,
): Promise<PreviewPrismaColumnDefaults | undefined> {
  const schemaFiles = await findPreviewPrismaSchemaFiles(projectRoot);
  if (schemaFiles.length === 0) return undefined;
  const identity = JSON.stringify(schemaFiles.map((file) => [file.path, file.mtimeMs, file.size]));
  if (defaultsBySchema.has(identity)) return defaultsBySchema.get(identity);
  const schema = parsePreviewPrismaSchema(
    (await Promise.all(schemaFiles.map((file) => readFile(file.path, 'utf8')))).join('\n'),
  );
  const models = new Map<string, PreviewPrismaModelColumns>();
  let declared = false;
  for (const [name, fields] of schema.models) {
    const defaults = new Map<string, string>();
    const relations = new Map<string, string>();
    for (const field of fields) {
      if (field.type === 'String' && !field.list && field.defaultText !== undefined) {
        defaults.set(field.name, field.defaultText);
      }
      if (schema.models.has(field.type)) relations.set(field.name, field.type);
    }
    declared ||= defaults.size > 0;
    models.set(name, { defaults, relations });
  }
  const result = declared ? { models } : undefined;
  defaultsBySchema.set(identity, result);
  for (const stale of [...defaultsBySchema.keys()].slice(0, -MAX_CACHED_SCHEMAS)) {
    defaultsBySchema.delete(stale);
  }
  return result;
}

/**
 * Finds the model behind a client delegate (`prisma.irEvent` serves model `IrEvent`).
 *
 * @param columns Schema defaults.
 * @param delegate Delegate property name.
 * @returns The model name, or `undefined` when no model owns the delegate.
 */
export function findPreviewPrismaDelegateModel(
  columns: PreviewPrismaColumnDefaults,
  delegate: string,
): string | undefined {
  for (const name of columns.models.keys()) {
    if (`${name.charAt(0).toLowerCase()}${name.slice(1)}` === delegate) return name;
  }
  return undefined;
}

/**
 * Puts schema defaults into the string columns of one model's typed rows, following relations.
 *
 * @param value Typed query result: a row, rows, or anything else (returned as is).
 * @param model Model the rows belong to.
 * @param columns Schema defaults.
 * @returns The value with defaulted string columns.
 */
export function applyPreviewPrismaColumnDefaults(
  value: PreviewTypedValue,
  model: string,
  columns: PreviewPrismaColumnDefaults,
  depth = 0,
): PreviewTypedValue {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item: PreviewTypedValue) =>
      applyPreviewPrismaColumnDefaults(item, model, columns, depth + 1),
    );
  }
  const row = value as Readonly<Record<string, PreviewTypedValue>>;
  const modelColumns = columns.models.get(model);
  if (modelColumns === undefined || Object.hasOwn(row, PREVIEW_TYPED_VALUE_TAG)) return value;
  const output: Record<string, PreviewTypedValue> = {};
  for (const [key, field] of Object.entries(row)) {
    const defaultText = modelColumns.defaults.get(key);
    const related = modelColumns.relations.get(key);
    output[key] =
      defaultText !== undefined && typeof field === 'string'
        ? defaultText
        : related !== undefined
          ? applyPreviewPrismaColumnDefaults(field, related, columns, depth + 1)
          : field;
  }
  return output;
}
