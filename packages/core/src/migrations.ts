import { GuideSchema, type Guide } from './schema.js';
import { SCHEMA_VERSION } from './version.js';

/** Upgrades a raw guide object from `from` to `from + 1`. Must not mutate its input. */
export type Migration = {
  from: number;
  describe: string;
  up: (raw: Record<string, unknown>) => Record<string, unknown>;
};

/**
 * Registered migrations, one per schema bump. v1 is the first published schema, so the list
 * is empty; add `{ from: 1, ... }` here when introducing schema v2.
 */
export const MIGRATIONS: readonly Migration[] = [];

export class GuideFormatError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'GuideFormatError';
  }
}

function versionOf(raw: Record<string, unknown>): number {
  const v = raw.schemaVersion;
  if (v === undefined) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new GuideFormatError('This file has an invalid schema version.');
  }
  return v;
}

/** Applies migrations in order until the raw object reaches `target`. Exposed for tests. */
export function migrateRaw(
  input: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new GuideFormatError('This file is not a ABCXYZ guide.');
  }
  let raw = input as Record<string, unknown>;
  let version = versionOf(raw);
  if (version > target) {
    throw new GuideFormatError(
      `This guide was made with a newer version of ABCXYZ (schema ${version}). Update ABCXYZ to open it.`,
    );
  }
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new GuideFormatError(`No upgrade path from guide schema ${version}.`);
    }
    raw = { ...step.up(raw), schemaVersion: version + 1 };
    version += 1;
  }
  return raw;
}

/** Migrate any supported guide JSON to the current schema and validate it. */
export function parseGuide(input: unknown): Guide {
  const raw = migrateRaw(input);
  const result = GuideSchema.safeParse(raw);
  if (!result.success) {
    throw new GuideFormatError(
      'This guide file is damaged or incomplete.',
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Serialise a guide after validating it, so invalid data never reaches disk. */
export function serializeGuide(guide: Guide): string {
  return JSON.stringify(GuideSchema.parse(guide), null, 2);
}
