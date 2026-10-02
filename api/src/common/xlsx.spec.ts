import * as XLSX from 'xlsx';
import { type Readable } from 'node:stream';
import { streamXlsx, cellSafe } from './xlsx';

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Parse the streamed workbook back into an array-of-arrays (row 0 = header). */
async function readStreamed(stream: Readable): Promise<string[][]> {
  const buf = await collect(stream);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
}

describe('streamXlsx', () => {
  it('writes the header then every row across multiple batches (nothing dropped)', async () => {
    const batches = [
      [{ Name: 'Alice', Town: 'Mumbai' }, { Name: 'Bob', Town: 'Pune' }],
      [{ Name: 'Carol', Town: 'Delhi' }],
    ];
    let i = 0;
    const stream = streamXlsx({
      sheetName: 'People',
      headers: ['Name', 'Town'],
      nextBatch: async () => batches[i++] ?? [],
    });

    const aoa = await readStreamed(stream);
    expect(aoa[0]).toEqual(['Name', 'Town']); // header
    expect(aoa.slice(1)).toEqual([
      ['Alice', 'Mumbai'],
      ['Bob', 'Pune'],
      ['Carol', 'Delhi'],
    ]);
  });

  it('formula-guards every string cell AND header (cellSafe)', async () => {
    const stream = streamXlsx({
      sheetName: 'Danger',
      headers: ['=HEADER', 'Safe'],
      nextBatch: (() => {
        let done = false;
        return async () => {
          if (done) return [];
          done = true;
          return [{ '=HEADER': '=cmd|calc', Safe: 'ok' }];
        };
      })(),
    });

    const aoa = await readStreamed(stream);
    // Header and the injection cell are prefixed with an apostrophe (forced to text).
    expect(aoa[0]).toEqual([cellSafe('=HEADER'), 'Safe']);
    expect(aoa[0][0]).toBe("'=HEADER");
    expect(aoa[1][0]).toBe("'=cmd|calc");
    expect(aoa[1][1]).toBe('ok');
  });

  it('keeps columns aligned when a row is missing a key (empty cell, no shift)', async () => {
    const stream = streamXlsx({
      sheetName: 'Sparse',
      headers: ['A', 'B', 'C'],
      nextBatch: (() => {
        let done = false;
        return async () => {
          if (done) return [];
          done = true;
          return [{ A: 'a1', C: 'c1' }]; // B missing
        };
      })(),
    });

    const aoa = await readStreamed(stream);
    expect(aoa[0]).toEqual(['A', 'B', 'C']);
    expect(aoa[1]).toEqual(['a1', '', 'c1']);
  });

  it('emits a header-only sheet when there are zero rows', async () => {
    const stream = streamXlsx({
      sheetName: 'Empty',
      headers: ['X', 'Y'],
      nextBatch: async () => [],
    });
    const aoa = await readStreamed(stream);
    expect(aoa[0]).toEqual(['X', 'Y']);
    expect(aoa.slice(1)).toEqual([]);
  });

  it('destroys the stream when a batch fetch throws', async () => {
    const stream = streamXlsx({
      sheetName: 'Boom',
      headers: ['A'],
      nextBatch: async () => {
        throw new Error('db exploded');
      },
    });
    await expect(collect(stream)).rejects.toThrow('db exploded');
  });
});
