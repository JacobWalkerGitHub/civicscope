import { describe, expect, it } from 'vitest';
import { geocodeAddress } from './geocode';

const answer = (geographies: Record<string, unknown[]>) =>
  (async () =>
    new Response(
      JSON.stringify({
        result: {
          addressMatches: [{ matchedAddress: '1000 BANK ST, RICHMOND, VA, 23219', geographies }],
        },
      }),
    )) as unknown as typeof fetch;

describe('geocodeAddress', () => {
  it('reads the state and district layers, whatever year they are named for', async () => {
    const got = await geocodeAddress(
      '1000 Bank St, Richmond, VA',
      answer({
        States: [{ NAME: 'Virginia', STATE: '51', GEOID: '51' }],
        Counties: [{ NAME: 'Richmond city', GEOID: '51760' }],
        '120th Congressional Districts': [{ NAME: 'Congressional District 4', GEOID: '5104' }],
        '2026 State Legislative Districts - Upper': [
          { NAME: 'State Senate District 14', GEOID: '51014' },
        ],
        '2026 State Legislative Districts - Lower': [
          { NAME: 'State House District 78', GEOID: '51078' },
        ],
      }),
    );
    expect(got).toEqual({
      matchedAddress: '1000 BANK ST, RICHMOND, VA, 23219',
      state: 'VA',
      stateName: 'Virginia',
      county: 'Richmond city',
      congressional: 4,
      congressionalName: 'Congressional District 4',
      stateUpper: 14,
      stateUpperName: 'State Senate District 14',
      stateLower: 78,
      stateLowerName: 'State House District 78',
    });
  });

  it('treats an at-large seat as no district, and no match as null', async () => {
    const got = await geocodeAddress(
      'x',
      answer({
        States: [{ NAME: 'Wyoming', STATE: '56', GEOID: '56' }],
        '120th Congressional Districts': [
          { NAME: 'Congressional District (at Large)', GEOID: '5600' },
        ],
      }),
    );
    expect(got).toMatchObject({ state: 'WY', congressional: null, stateLower: null });
    const none = (async () =>
      new Response(JSON.stringify({ result: { addressMatches: [] } }))) as unknown as typeof fetch;
    expect(await geocodeAddress('nowhere', none)).toBeNull();
  });
});
