import 'reflect-metadata'; // the DTO decorators need the metadata polyfill (no Nest import pulls it in here)
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRecceDto } from './create-recce.dto';

// Marking the recce photo is COMPULSORY: every POSM line must carry a markup with >= 1 shape.
const line = (over: Record<string, unknown> = {}) => ({
  posmTypeId: 'p1',
  dimensions: { width: 30, height: 40, unit: 'cm' },
  photo: { key: 'posm-media/c1/x.jpg', geo: { lat: 19.07, lng: 72.87 } },
  markup: { version: 1, shapes: [{ type: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.25 }] },
  ...over,
});
const dtoOf = (body: Record<string, unknown>) => plainToInstance(CreateRecceDto, body);

describe('CreateRecceDto — markup is compulsory', () => {
  it('accepts a line with a valid markup (>= 1 shape)', async () => {
    const errors = await validate(dtoOf({ siteId: 's1', posms: [line()] }));
    expect(errors).toHaveLength(0);
  });

  it('rejects a line with NO markup', async () => {
    const noMarkup = line();
    delete (noMarkup as Record<string, unknown>).markup;
    const errors = await validate(dtoOf({ siteId: 's1', posms: [noMarkup] }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a line whose markup has zero shapes', async () => {
    const errors = await validate(dtoOf({ siteId: 's1', posms: [line({ markup: { version: 1, shapes: [] } })] }));
    expect(errors.length).toBeGreaterThan(0);
  });
});
