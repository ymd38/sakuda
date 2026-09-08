import { describe, expect, it } from 'vitest'
import { BodyShapeSchema, bodyShapeFunctionSource, toBodyShape } from '../bodyShape'

describe('toBodyShape', () => {
  it('returns null for an empty or whitespace-only body', () => {
    expect(toBodyShape('application/json', '')).toBeNull()
    expect(toBodyShape('application/json', '   ')).toBeNull()
    expect(toBodyShape(null, '')).toBeNull()
  })

  it('shapes a JSON object as key names + types, dropping values', () => {
    const shape = toBodyShape('application/json', '{"email":"a@b.c","password":"hunter2","n":3}')
    expect(shape).toEqual({
      kind: 'json',
      root: {
        type: 'object',
        fields: {
          email: { type: 'string' },
          password: { type: 'string' },
          n: { type: 'number' },
        },
      },
    })
    expect(JSON.stringify(shape)).not.toContain('hunter2')
    expect(JSON.stringify(shape)).not.toContain('a@b.c')
  })

  it('honors a +json media type and a charset parameter', () => {
    const shape = toBodyShape('application/vnd.api+json; charset=utf-8', '{"x":true}')
    expect(shape).toEqual({
      kind: 'json',
      root: { type: 'object', fields: { x: { type: 'boolean' } } },
    })
  })

  it('maps JSON scalar types and null', () => {
    expect(toBodyShape('application/json', '"hi"')).toEqual({
      kind: 'json',
      root: { type: 'string' },
    })
    expect(toBodyShape('application/json', '42')).toEqual({
      kind: 'json',
      root: { type: 'number' },
    })
    expect(toBodyShape('application/json', 'true')).toEqual({
      kind: 'json',
      root: { type: 'boolean' },
    })
    expect(toBodyShape('application/json', 'null')).toEqual({
      kind: 'json',
      root: { type: 'null' },
    })
  })

  it('collapses an array to its distinct element shapes, ignoring order and multiplicity', () => {
    const shape = toBodyShape('application/json', '[1,2,3,"a","b",{"k":1},{"k":9}]')
    expect(shape).toEqual({
      kind: 'json',
      root: {
        type: 'array',
        items: [
          { type: 'number' },
          { type: 'string' },
          { type: 'object', fields: { k: { type: 'number' } } },
        ],
      },
    })
  })

  it('caps nesting depth: a container past depth 3 is truncated', () => {
    // root(0).a(1).b(2).c(3 → truncated, its 'd' child dropped)
    const shape = toBodyShape('application/json', '{"a":{"b":{"c":{"d":1}}}}')
    expect(shape).toEqual({
      kind: 'json',
      root: {
        type: 'object',
        fields: {
          a: {
            type: 'object',
            fields: { b: { type: 'object', fields: { c: { type: 'object', truncated: true } } } },
          },
        },
      },
    })
    expect(JSON.stringify(shape)).not.toContain('"d"')
  })

  it('shapes form-urlencoded as deduped, decoded field names only', () => {
    const shape = toBodyShape(
      'application/x-www-form-urlencoded',
      'user%20name=alice&pass=s3cret&user%20name=bob&flag',
    )
    expect(shape).toEqual({ kind: 'form', fields: ['user name', 'pass', 'flag'] })
    expect(JSON.stringify(shape)).not.toContain('alice')
    expect(JSON.stringify(shape)).not.toContain('s3cret')
  })

  it('is other for multipart, text, unknown, or malformed JSON', () => {
    expect(toBodyShape('multipart/form-data; boundary=xyz', '--xyz...')).toEqual({ kind: 'other' })
    expect(toBodyShape('text/plain', 'hello')).toEqual({ kind: 'other' })
    expect(toBodyShape(null, 'raw')).toEqual({ kind: 'other' })
    expect(toBodyShape('application/json', '{not valid json')).toEqual({ kind: 'other' })
  })

  it('is value-substitution invariant: bodies differing only in values share a shape', () => {
    const a = toBodyShape('application/json', '{"email":"real@corp.com","password":"P@ssw0rd!"}')
    const b = toBodyShape('application/json', '{"email":"x","password":"y"}')
    expect(a).toEqual(b)
  })

  it('never leaks a sentinel scalar value into the output for any body kind', () => {
    const sentinel = 'S3NT1NEL_SECRET_VALUE'
    const bodies: Array<[string, string]> = [
      ['application/json', JSON.stringify({ a: sentinel, b: [sentinel], c: { d: sentinel } })],
      ['application/x-www-form-urlencoded', `k=${sentinel}&j=${sentinel}`],
      ['text/plain', sentinel],
    ]
    for (const [ct, body] of bodies) {
      const shape = toBodyShape(ct, body)
      expect(JSON.stringify(shape)).not.toContain(sentinel)
    }
  })

  it('output always validates against BodyShapeSchema', () => {
    const samples = ['{"a":1,"b":{"c":[true,null]}}', 'k=v&x=y', 'garbage', '[1,"a"]']
    for (const body of samples) {
      const shape = toBodyShape('application/json', body)
      if (shape) expect(BodyShapeSchema.safeParse(shape).success).toBe(true)
    }
    expect(BodyShapeSchema.safeParse(toBodyShape('text/plain', 'x')).success).toBe(true)
  })
})

describe('bodyShapeFunctionSource (embedded into the Graal.js dump script)', () => {
  it('emits a self-assigning `var toBodyShape = function ...` with no external references', () => {
    const src = bodyShapeFunctionSource()
    expect(src.startsWith('var toBodyShape = ')).toBe(true)
    // Self-contained: the recursion helper is inlined and no module import leaks
    // in (which would break when the source runs standalone inside ZAP's Graal.js).
    expect(src).toContain('function shapeJson')
    expect(src).not.toContain('import')
    expect(src).not.toContain('require(')
    // The embedded source is `toBodyShape`'s own source by construction, so the
    // logic that runs in ZAP is exactly the logic exercised by the tests above.
    expect(src).toContain(toBodyShape.toString())
  })
})
