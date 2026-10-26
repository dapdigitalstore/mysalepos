import { assertTemplateDeletable, assertValuesRemovable, cleanName, diffTemplateValues } from './variation-template.rules';

const existing = [
  { id: 10, name: 'Small' },
  { id: 11, name: 'Medium' },
  { id: 12, name: 'Large' },
];

describe('diffTemplateValues', () => {
  it('keeps ids and reports nothing when unchanged', () => {
    const d = diffTemplateValues(existing, existing);
    expect(d).toEqual({ toCreate: [], toRename: [], toDelete: [] });
  });
  it('renames by id and adds rows without an id', () => {
    const d = diffTemplateValues(existing, [
      { id: 10, name: ' S ' },
      { id: 11, name: 'Medium' },
      { id: 12, name: 'Large' },
      { name: 'XL' },
    ]);
    expect(d.toRename).toEqual([{ id: 10, name: 'S', oldName: 'Small' }]);
    expect(d.toCreate).toEqual(['XL']);
    expect(d.toDelete).toEqual([]);
  });
  it('deletes only the values missing from the payload', () => {
    const d = diffTemplateValues(existing, [{ id: 10, name: 'Small' }, { id: 12, name: 'Large' }]);
    expect(d.toDelete).toEqual([{ id: 11, name: 'Medium' }]);
  });
  it('ignores blank rows', () => {
    const d = diffTemplateValues([], [{ name: 'Red' }, { name: '  ' }, { name: '' }]);
    expect(d.toCreate).toEqual(['Red']);
  });
  it('needs at least one value', () => {
    expect(() => diffTemplateValues(existing, [])).toThrow();
    expect(() => diffTemplateValues(existing, [{ name: ' ' }])).toThrow();
  });
  it('rejects ids that belong to another template', () => {
    expect(() => diffTemplateValues(existing, [{ id: 99, name: 'X' }])).toThrow();
  });
  it('rejects a repeated id and duplicate names', () => {
    expect(() => diffTemplateValues(existing, [{ id: 10, name: 'A' }, { id: 10, name: 'B' }])).toThrow();
    expect(() => diffTemplateValues(existing, [{ id: 10, name: 'Red' }, { name: 'red' }])).toThrow();
  });
  it('creates every value of a brand new template', () => {
    expect(diffTemplateValues([], [{ name: 'A' }, { name: 'B' }]).toCreate).toEqual(['A', 'B']);
  });
});

describe('assertValuesRemovable', () => {
  it('passes when no removed value is in use', () => {
    expect(() => assertValuesRemovable([{ id: 11, name: 'Medium' }], [10, 12])).not.toThrow();
    expect(() => assertValuesRemovable([], [10])).not.toThrow();
  });
  it('blocks a value that is in use and names it', () => {
    expect(() => assertValuesRemovable([{ id: 11, name: 'Medium' }], new Set([11]))).toThrow(/Medium/);
  });
});

describe('assertTemplateDeletable / cleanName', () => {
  it('blocks deleting a used template', () => {
    expect(() => assertTemplateDeletable(0)).not.toThrow();
    expect(() => assertTemplateDeletable(2)).toThrow();
  });
  it('trims names and rejects blank ones', () => {
    expect(cleanName('  Size ')).toBe('Size');
    expect(() => cleanName('   ')).toThrow();
    expect(() => cleanName(undefined)).toThrow();
  });
});
