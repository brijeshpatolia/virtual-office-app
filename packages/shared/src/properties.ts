import type { RawProperty } from './tiled.ts'

type Kind = 'string' | 'int' | 'bool'

export interface PropertyReader {
  string(name: string): string
  // A string that names something: it must not be empty.
  id(name: string): string
  int(name: string): number
  bool(name: string): boolean
  oneOf<T extends string>(name: string, values: readonly [T, ...T[]]): T
  // undefined when the property is missing; a wrong type is still an issue.
  optionalString(name: string): string | undefined
  optionalInt(name: string): number | undefined
  optionalBool(name: string): boolean | undefined
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown): v is number => Number.isInteger(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

// Tiled stores custom properties as [{name, type, value}]. They are looked up by name, so their order never matters.
export function readProperties(
  properties: readonly RawProperty[] | undefined,
  where: string,
  issues: string[],
): PropertyReader {
  const byName = new Map<string, RawProperty>()
  for (const p of properties ?? []) {
    if (byName.has(p.name)) issues.push(`${where}: property "${p.name}" is defined more than once`)
    byName.set(p.name, p)
  }

  function value(name: string, kind: Kind, required: boolean, ok: (v: unknown) => boolean): unknown {
    const p = byName.get(name)
    if (p === undefined) {
      if (required) issues.push(`${where}: missing property "${name}" (${kind})`)
      return undefined
    }
    // Tiled omits "type" for string properties in some versions.
    const declared = p.type ?? 'string'
    if (declared !== kind || !ok(p.value)) {
      issues.push(`${where}: property "${name}" must be ${kind}, got ${declared} ${JSON.stringify(p.value)}`)
      return undefined
    }
    return p.value
  }

  const str = (name: string, required: boolean): string | undefined => {
    const v = value(name, 'string', required, isString)
    return isString(v) ? v : undefined
  }
  const int = (name: string, required: boolean): number | undefined => {
    const v = value(name, 'int', required, isInt)
    return isInt(v) ? v : undefined
  }
  const bool = (name: string, required: boolean): boolean | undefined => {
    const v = value(name, 'bool', required, isBool)
    return isBool(v) ? v : undefined
  }

  return {
    string: (name) => str(name, true) ?? '',
    id(name) {
      const v = str(name, true)
      if (v !== undefined && v.trim() === '') issues.push(`${where}: property "${name}" must not be empty`)
      return v ?? ''
    },
    int: (name) => int(name, true) ?? 0,
    bool: (name) => bool(name, true) ?? false,
    oneOf(name, values) {
      const v = str(name, true)
      if (v === undefined) return values[0]
      if (isOneOf(values, v)) return v
      issues.push(`${where}: property "${name}" must be one of ${values.join(', ')}; got "${v}"`)
      return values[0]
    },
    optionalString: (name) => str(name, false),
    optionalInt: (name) => int(name, false),
    optionalBool: (name) => bool(name, false),
  }
}
