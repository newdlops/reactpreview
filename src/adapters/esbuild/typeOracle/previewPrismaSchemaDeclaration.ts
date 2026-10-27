/**
 * Turns a Prisma schema into a small `@prisma/client` type declaration for the type oracle only.
 *
 * A project that uses `prisma-client-js` imports model and enum types from `@prisma/client`, whose
 * real declarations exist only after `prisma generate`. Without them every model value is `any`,
 * so declared values lose enum literals, nullable timestamps, and field shapes. The declaration
 * keeps what previews need: scalar fields with nullability, enums as unions in declaration order,
 * relations one level deep (related models carry their scalars only, so a recursive model graph
 * cannot exhaust the synthesis budget), `_count` for list relations, and model delegates whose
 * reads resolve to the model. Nothing here runs project code or writes files.
 */

/** One model, view, or composite-type field. */
export interface PreviewPrismaField {
  /** String literal of a `@default("…")` attribute, when the field declares one. */
  readonly defaultText?: string;
  readonly list: boolean;
  readonly name: string;
  readonly optional: boolean;
  readonly type: string;
}

/** Parsed declarations of one schema. */
export interface PreviewPrismaSchema {
  /** Composite types (MongoDB `type` blocks): fields only, no delegate. */
  readonly composites: ReadonlyMap<string, readonly PreviewPrismaField[]>;
  /** Enum values in declaration order. */
  readonly enums: ReadonlyMap<string, readonly string[]>;
  /** Generator blocks with their `provider` and optional `output`. */
  readonly generators: readonly { readonly output?: string; readonly provider?: string }[];
  /** Models and views with their fields in declaration order. */
  readonly models: ReadonlyMap<string, readonly PreviewPrismaField[]>;
}

const SCALAR_TYPES: Readonly<Record<string, string>> = {
  BigInt: 'number',
  Boolean: 'boolean',
  Bytes: 'any',
  DateTime: 'Date',
  Decimal: 'Prisma.Decimal',
  Float: 'number',
  Int: 'number',
  Json: 'any',
  String: 'string',
};
const BLOCK_PATTERN = /^(model|view|type|enum|generator|datasource)\s+([A-Za-z_]\w*)\s*$/u;
const FIELD_PATTERN = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?/u;
const IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/u;
const STRING_DEFAULT_PATTERN = /@default\(\s*"((?:[^"\\]|\\.)*)"\s*\)/u;

/**
 * Parses the declarations a type declaration needs; attributes and unknown lines are ignored.
 *
 * @param text Schema text; several schema files may be concatenated.
 * @returns Models, views, composite types, enums, and generators.
 */
export function parsePreviewPrismaSchema(text: string): PreviewPrismaSchema {
  const models = new Map<string, PreviewPrismaField[]>();
  const composites = new Map<string, PreviewPrismaField[]>();
  const enums = new Map<string, string[]>();
  const generators: { output?: string; provider?: string }[] = [];
  for (const block of readBlocks(stripComments(text))) {
    const lines = block.body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('@@'));
    if (block.kind === 'enum') {
      enums.set(
        block.name,
        lines
          .map((line) => line.split(/\s/u)[0] ?? '')
          .filter((value) => IDENTIFIER_PATTERN.test(value)),
      );
    } else if (block.kind === 'generator') {
      const settings = Object.fromEntries(
        lines.flatMap((line) => {
          const match = /^(\w+)\s*=\s*"([^"]*)"/u.exec(line);
          return match === null ? [] : [[match[1], match[2]]];
        }),
      ) as Record<string, string | undefined>;
      generators.push({
        ...(settings.output === undefined ? {} : { output: settings.output }),
        ...(settings.provider === undefined ? {} : { provider: settings.provider }),
      });
    } else if (block.kind !== 'datasource') {
      const fields = lines.flatMap((line): PreviewPrismaField[] => {
        const match = FIELD_PATTERN.exec(line);
        const defaultText = STRING_DEFAULT_PATTERN.exec(line)?.[1];
        return match === null
          ? []
          : [
              {
                ...(defaultText === undefined
                  ? {}
                  : { defaultText: defaultText.replace(/\\(.)/gu, '$1') }),
                list: match[3] !== undefined,
                name: match[1] ?? '',
                optional: match[4] !== undefined,
                type: match[2] ?? '',
              },
            ];
      });
      (block.kind === 'type' ? composites : models).set(block.name, fields);
    }
  }
  return { composites, enums, generators, models };
}

/**
 * Creates the declaration module served for `@prisma/client`.
 *
 * @param schema Parsed schema.
 * @returns Declaration text with top-level exports.
 */
export function createPreviewPrismaClientDeclaration(schema: PreviewPrismaSchema): string {
  const enumName = (name: string): string => `PreviewEnum_${name}`;
  const scalarsName = (name: string): string => `PreviewScalars_${name}`;
  const fieldType = (field: PreviewPrismaField, relation: (model: string) => string): string => {
    const base =
      SCALAR_TYPES[field.type] ??
      (schema.enums.has(field.type)
        ? enumName(field.type)
        : schema.composites.has(field.type)
          ? field.type
          : schema.models.has(field.type)
            ? relation(field.type)
            : 'any');
    if (field.list) return `${base}[]`;
    return field.optional ? `${base} | null` : base;
  };
  const scalarFields = (fields: readonly PreviewPrismaField[]): readonly PreviewPrismaField[] =>
    fields.filter((field) => !schema.models.has(field.type));
  const lines: string[] = [
    '// Generated by React Preview from the Prisma schema, for type analysis only.',
    'export declare namespace Prisma {',
    '  type JsonValue = any;',
    '  type JsonObject = any;',
    '  type JsonArray = any;',
    '  type InputJsonValue = any;',
    '  class Decimal {',
    '    constructor(value?: unknown);',
    '    toNumber(): number;',
    '    toString(): string;',
    '    toFixed(digits?: number): string;',
    '    valueOf(): number;',
    '  }',
    '  class PrismaClientKnownRequestError extends Error {',
    '    code: string;',
    '  }',
    "  type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction'>;",
    '}',
  ];
  const enumObject = (values: readonly string[]): string =>
    `{ ${values.map((value) => `readonly ${value}: '${value}';`).join(' ')} }`;
  for (const [name, values] of schema.enums) {
    // An explicit union keeps declaration order, which sample values follow.
    const union = values.length === 0 ? 'never' : values.map((value) => `'${value}'`).join(' | ');
    lines.push(
      `type ${enumName(name)} = ${union};`,
      `export type ${name} = ${enumName(name)};`,
      `export declare const ${name}: ${enumObject(values)};`,
    );
  }
  lines.push(
    'export declare namespace $Enums {',
    ...[...schema.enums].flatMap(([name, values]) => [
      `  type ${name} = ${enumName(name)};`,
      `  const ${name}: ${enumObject(values)};`,
    ]),
    '}',
  );
  for (const [name, fields] of schema.composites) {
    lines.push(
      `export type ${name} = { ${fields.map((field) => `${field.name}: ${fieldType(field, () => 'any')};`).join(' ')} };`,
    );
  }
  for (const [name, fields] of schema.models) {
    lines.push(
      `type ${scalarsName(name)} = { ${scalarFields(fields)
        .map((field) => `${field.name}: ${fieldType(field, () => 'any')};`)
        .join(' ')} };`,
    );
    const listRelations = fields.filter((field) => field.list && schema.models.has(field.type));
    lines.push(
      `export type ${name} = { ${[
        ...fields.map((field) => `${field.name}: ${fieldType(field, scalarsName)};`),
        ...(listRelations.length === 0
          ? []
          : [`_count: { ${listRelations.map((field) => `${field.name}: number;`).join(' ')} };`]),
      ].join(' ')} };`,
    );
  }
  lines.push(
    'interface PreviewPrismaDelegate<M> {',
    '  findUnique(args?: any): Promise<M | null>;',
    '  findUniqueOrThrow(args?: any): Promise<M>;',
    '  findFirst(args?: any): Promise<M | null>;',
    '  findFirstOrThrow(args?: any): Promise<M>;',
    '  findMany(args?: any): Promise<M[]>;',
    '  create(args?: any): Promise<M>;',
    '  createMany(args?: any): Promise<{ count: number }>;',
    '  createManyAndReturn(args?: any): Promise<M[]>;',
    '  update(args?: any): Promise<M>;',
    '  updateMany(args?: any): Promise<{ count: number }>;',
    '  updateManyAndReturn(args?: any): Promise<M[]>;',
    '  upsert(args?: any): Promise<M>;',
    '  delete(args?: any): Promise<M>;',
    '  deleteMany(args?: any): Promise<{ count: number }>;',
    '  count(args?: any): Promise<number>;',
    '  aggregate(args?: any): Promise<any>;',
    '  groupBy(args?: any): Promise<any[]>;',
    '}',
    'export declare class PrismaClient {',
    '  constructor(options?: unknown);',
    ...[...schema.models.keys()].map(
      (name) =>
        `  ${name.charAt(0).toLowerCase()}${name.slice(1)}: PreviewPrismaDelegate<${name}>;`,
    ),
    '  $connect(): Promise<void>;',
    '  $disconnect(): Promise<void>;',
    '  $on(...args: any[]): void;',
    '  $extends(extension: unknown): this;',
    '  $queryRaw<T = unknown>(...args: any[]): Promise<T>;',
    '  $queryRawUnsafe<T = unknown>(...args: any[]): Promise<T>;',
    '  $executeRaw(...args: any[]): Promise<number>;',
    '  $executeRawUnsafe(...args: any[]): Promise<number>;',
    '  $transaction<T>(callback: (client: Prisma.TransactionClient) => Promise<T>, options?: unknown): Promise<T>;',
    '  $transaction<P extends readonly unknown[]>(operations: [...P], options?: unknown): Promise<{ [K in keyof P]: Awaited<P[K]> }>;',
    '}',
  );
  return `${lines.join('\n')}\n`;
}

/** Removes `//` comments outside string literals. */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"' && line[index - 1] !== '\\') quoted = !quoted;
        if (!quoted && character === '/' && line[index + 1] === '/') return line.slice(0, index);
      }
      return line;
    })
    .join('\n');
}

/** Reads top-level `keyword Name { … }` blocks, skipping braces inside string literals. */
function readBlocks(
  text: string,
): readonly { readonly body: string; readonly kind: string; readonly name: string }[] {
  const blocks: { body: string; kind: string; name: string }[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('{', index);
    if (open === -1) break;
    const header = text.slice(index, open).split('\n').at(-1)?.trim() ?? '';
    let depth = 1;
    let quoted = false;
    let cursor = open + 1;
    for (; cursor < text.length && depth > 0; cursor += 1) {
      const character = text[cursor];
      if (character === '"' && text[cursor - 1] !== '\\') quoted = !quoted;
      else if (!quoted && character === '{') depth += 1;
      else if (!quoted && character === '}') depth -= 1;
    }
    const match = BLOCK_PATTERN.exec(header);
    if (match !== null) {
      blocks.push({
        body: text.slice(open + 1, cursor - 1),
        kind: match[1] ?? '',
        name: match[2] ?? '',
      });
    }
    index = cursor;
  }
  return blocks;
}
