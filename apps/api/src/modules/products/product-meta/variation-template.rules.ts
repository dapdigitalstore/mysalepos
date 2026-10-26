import { BadRequestException } from '@nestjs/common';

export interface ValueInput {
  id?: number | null;
  name: string;
}

export interface ExistingValue {
  id: number;
  name: string;
}

export interface ValueDiff {
  /** New values to insert (names only). */
  toCreate: string[];
  /** Existing values whose name changed. Their ids stay the same. */
  toRename: { id: number; name: string; oldName: string }[];
  /** Existing values missing from the payload. */
  toDelete: ExistingValue[];
}

export function cleanName(raw: string | null | undefined, what = 'Name'): string {
  const name = (raw ?? '').trim();
  if (!name) throw new BadRequestException(`${what} is required`);
  return name;
}

/**
 * Works out what an edit of a variation template does to its values.
 * Mirrors Laravel's VariationTemplateController@update: values that already exist are matched by id, so their id
 * never changes (products keep pointing at them), a changed name is a rename, a row without an id is a new value.
 * Blank rows are ignored like Laravel does. Unlike Laravel, a value that is no longer in the payload is removed
 * (the caller must still check `assertValuesRemovable` before deleting).
 */
export function diffTemplateValues(existing: ExistingValue[], payload: ValueInput[]): ValueDiff {
  const rows = payload
    .map((v) => ({ id: v.id ?? null, name: (v.name ?? '').trim() }))
    .filter((v) => v.name !== '');
  if (rows.length === 0) throw new BadRequestException('A variation needs at least one value');

  const byId = new Map(existing.map((e) => [e.id, e]));
  const seenIds = new Set<number>();
  const seenNames = new Set<string>();
  const toCreate: string[] = [];
  const toRename: ValueDiff['toRename'] = [];

  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (seenNames.has(key)) throw new BadRequestException(`Duplicate value "${row.name}"`);
    seenNames.add(key);

    if (row.id == null) {
      toCreate.push(row.name);
      continue;
    }
    const current = byId.get(row.id);
    if (!current) throw new BadRequestException(`Value ${row.id} does not belong to this variation`);
    if (seenIds.has(row.id)) throw new BadRequestException(`Value ${row.id} was sent twice`);
    seenIds.add(row.id);
    if (current.name !== row.name) toRename.push({ id: row.id, name: row.name, oldName: current.name });
  }

  const toDelete = existing.filter((e) => !seenIds.has(e.id));
  return { toCreate, toRename, toDelete };
}

/** A value already used by a product variation cannot be removed from its template. */
export function assertValuesRemovable(toDelete: ExistingValue[], usedValueIds: Iterable<number>): void {
  const used = new Set(usedValueIds);
  const blocked = toDelete.filter((v) => used.has(v.id));
  if (blocked.length > 0) {
    throw new BadRequestException(`These values are used by products and cannot be removed: ${blocked.map((v) => v.name).join(', ')}`);
  }
}

/** A template used by a product cannot be deleted (Laravel hides the delete button in that case). */
export function assertTemplateDeletable(productVariationCount: number): void {
  if (productVariationCount > 0) throw new BadRequestException('This variation is used by products and cannot be deleted');
}
