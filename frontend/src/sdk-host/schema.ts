/**
 * A small JSON Schema subset used by the App API spec. It is enough to describe every
 * method's parameters for plugins, the assistant's tool definitions and the docs, and to
 * validate calls at the boundary without pulling in a schema library.
 */
export type JsonSchema =
  | { type: "string"; description?: string; enum?: string[]; maxLength?: number; minLength?: number; default?: string }
  | { type: "number" | "integer"; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: "boolean"; description?: string; default?: boolean }
  | { type: "array"; description?: string; items: JsonSchema; maxItems?: number }
  | ObjectSchema
  | { description?: string; anyOf: JsonSchema[]; /** Any JSON value, including null and nested arrays. */ json?: true };

export interface ObjectSchema {
  type: "object";
  description?: string;
  properties: Record<string, JsonSchema>;
  required?: string[];
  /** When true, unknown keys are allowed (free-form maps such as row values or token sets). */
  additionalProperties?: boolean | JsonSchema;
}

export const s = {
  str: (description: string, extra: { enum?: string[]; maxLength?: number; minLength?: number; default?: string } = {}): JsonSchema => ({ type: "string", description, ...extra }),
  num: (description: string, extra: { minimum?: number; maximum?: number; default?: number } = {}): JsonSchema => ({ type: "number", description, ...extra }),
  int: (description: string, extra: { minimum?: number; maximum?: number; default?: number } = {}): JsonSchema => ({ type: "integer", description, ...extra }),
  bool: (description: string, extra: { default?: boolean } = {}): JsonSchema => ({ type: "boolean", description, ...extra }),
  arr: (description: string, items: JsonSchema, maxItems?: number): JsonSchema => ({ type: "array", description, items, ...(maxItems ? { maxItems } : {}) }),
  map: (description: string, values?: JsonSchema): JsonSchema => ({ type: "object", description, properties: {}, additionalProperties: values ?? true }),
  any: (description: string): JsonSchema => ({ description, anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", items: { type: "string" } }, { type: "object", properties: {}, additionalProperties: true }] }),
  /** Any JSON value (null, arrays of anything, nested objects). */
  json: (description: string): JsonSchema => ({ description, json: true, anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", items: { type: "string" } }, { type: "object", properties: {}, additionalProperties: true }] }),
  obj: (properties: Record<string, JsonSchema>, required: string[] = [], description?: string): ObjectSchema => ({
    type: "object",
    ...(description ? { description } : {}),
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }),
};

export const EMPTY: ObjectSchema = { type: "object", properties: {}, additionalProperties: false };

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/** Returns the first problem with `value`, or "" when it matches. Paths read like `params.blocks[2]`. */
export function validate(schema: JsonSchema, value: unknown, path = "params"): string {
  if ("anyOf" in schema) {
    if (schema.json) return value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" ? `${path} must be JSON` : "";
    return schema.anyOf.some((option) => validate(option, value, path) === "") ? "" : `${path} has an unsupported type`;
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return `${path} must be a string`;
      if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is longer than ${schema.maxLength} characters`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} must not be empty`;
      return "";
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${path} must be a whole number`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
      return "";
    case "boolean":
      return typeof value === "boolean" ? "" : `${path} must be true or false`;
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} has more than ${schema.maxItems} items`;
      for (let index = 0; index < value.length; index += 1) {
        const problem = validate(schema.items, value[index], `${path}[${index}]`);
        if (problem) return problem;
      }
      return "";
    }
    case "object": {
      if (typeOf(value) !== "object") return `${path} must be an object`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (record[key] === undefined || record[key] === null) return `${path}.${key} is required`;
      }
      for (const [key, item] of Object.entries(record)) {
        if (item === undefined) continue;
        const property = schema.properties[key];
        if (property) {
          const problem = validate(property, item, `${path}.${key}`);
          if (problem) return problem;
          continue;
        }
        if (schema.additionalProperties === false || schema.additionalProperties === undefined) return `${path}.${key} is not a known parameter`;
        if (typeof schema.additionalProperties === "object") {
          const problem = validate(schema.additionalProperties, item, `${path}.${key}`);
          if (problem) return problem;
        }
      }
      return "";
    }
  }
}

/** Renders a schema as a compact TypeScript type, for the docs and the generated SDK types. */
export function toTypeScript(schema: JsonSchema, indent = ""): string {
  if ("anyOf" in schema) return "unknown";
  switch (schema.type) {
    case "string":
      return schema.enum ? schema.enum.map((item) => JSON.stringify(item)).join(" | ") : "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const inner = toTypeScript(schema.items, indent);
      return /[|&]/.test(inner) && !inner.startsWith("{") ? `Array<${inner}>` : `${inner}[]`;
    }
    case "object": {
      const keys = Object.keys(schema.properties);
      const extra = schema.additionalProperties;
      if (!keys.length) {
        if (extra === true) return "Record<string, unknown>";
        if (extra && typeof extra === "object") return `Record<string, ${toTypeScript(extra, indent)}>`;
        return "{}";
      }
      const next = `${indent}  `;
      const lines = keys.map((key) => {
        const property = schema.properties[key];
        const optional = schema.required?.includes(key) ? "" : "?";
        const doc = property.description ? `${next}/** ${property.description} */\n` : "";
        return `${doc}${next}${key}${optional}: ${toTypeScript(property, next)};`;
      });
      return `{\n${lines.join("\n")}\n${indent}}`;
    }
  }
}
