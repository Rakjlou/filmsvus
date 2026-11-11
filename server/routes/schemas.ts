const nullableText = { type: ['string', 'null'], maxLength: 50_000 };
const strings = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, maxItems: 100, uniqueItems: true };
const positiveId = { type: 'integer', minimum: 1 };
export const idParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: positiveId } };
export const ratingsBody = {
  type: 'object', required: ['ratings'], additionalProperties: false,
  properties: { ratings: { type: 'array', maxItems: 100, items: {
    type: 'object', required: ['viewer_id', 'score'], additionalProperties: false,
    properties: { viewer_id: positiveId, score: { type: ['number', 'null'], minimum: -10, maximum: 10 } },
  } } },
};
export const tagsBody = { type: 'object', required: ['tag_ids'], additionalProperties: false,
  properties: { tag_ids: { type: 'array', maxItems: 100, uniqueItems: true, items: positiveId } } };
export const tagBody = { type: 'object', required: ['label'], additionalProperties: false,
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
    emoji: { type: ['string', 'null'], maxLength: 32 },
    color: { anyOf: [{ type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, { type: 'null' }] },
  } };
const credit = { type: 'object', additionalProperties: false, required: ['role', 'name', 'position', 'source'],
  properties: {
    role: { type: 'string', enum: ['director', 'writer', 'composer', 'cinematographer', 'editor', 'producer', 'actor'] },
    name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    position: { type: 'integer', minimum: 0 }, source: { const: 'manual' },
  } };
const filmProperties = {
  title: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
  title_fr: nullableText, original_title: nullableText,
  year: { type: ['integer', 'null'], minimum: 1800, maximum: 2200 },
  watched_at: { type: 'string', format: 'date-time' },
  director_text: nullableText, summary: nullableText, comment: nullableText,
  imdb_id: { type: ['string', 'null'], maxLength: 500 },
  letterboxd_url: { anyOf: [{ type: 'string', pattern: '^https?://', format: 'uri', maxLength: 2000 }, { type: 'null' }] },
  runtime_min: { type: ['integer', 'null'], minimum: 0, maximum: 100_000 },
  genres: strings, countries: strings, languages: strings,
  ...ratingsBody.properties, ...tagsBody.properties,
  credits: { type: 'array', maxItems: 200, items: credit },
  companies: { type: 'array', maxItems: 100, items: {
    type: 'object', additionalProperties: false, required: ['name', 'source'],
    properties: { name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' }, source: { const: 'manual' } },
  } },
};
export const createFilmBody = { type: 'object', additionalProperties: false, required: ['title'], properties: filmProperties };
export const patchFilmBody = { type: 'object', additionalProperties: false, minProperties: 1, properties: filmProperties };
