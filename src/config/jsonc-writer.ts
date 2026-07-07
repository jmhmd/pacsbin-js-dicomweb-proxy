import { modify, applyEdits, FormattingOptions } from "jsonc-parser";

/** Sentinel used by getSanitizedConfig() to mask secret values. */
export const SECRET_MASK = "***CONFIGURED***";

/** Secret paths that getSanitizedConfig() masks and must not be written back verbatim. */
const SECRET_PATHS: (string | number)[][] = [
  ["ssl", "certPath"],
  ["ssl", "keyPath"],
  ["dimseProxySettings", "proxyServer", "securityOptions", "key"],
  ["dimseProxySettings", "proxyServer", "securityOptions", "cert"],
  ["dimseProxySettings", "proxyServer", "securityOptions", "ca"],
  ["dashboardAuth", "password"],
];

const FORMATTING: FormattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function getAtPath(obj: any, path: (string | number)[]): any {
  return path.reduce(
    (acc, key) => (acc == null ? undefined : acc[key]),
    obj
  );
}

function setAtPath(obj: any, path: (string | number)[], value: any): void {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!isPlainObject(cur[key])) return; // don't create structure
    cur = cur[key];
  }
  cur[path[path.length - 1]!] = value;
}

/**
 * Replaces masked secret placeholders in an incoming config with the real
 * values from the current config, so a round-trip through the sanitized
 * /config/current view never overwrites real cert paths / passwords with the
 * literal "***CONFIGURED***" string. Returns a shallow-cloned config.
 */
export function restoreMaskedSecrets(
  incoming: any,
  current: any
): any {
  const clone = JSON.parse(JSON.stringify(incoming));
  for (const path of SECRET_PATHS) {
    if (getAtPath(clone, path) === SECRET_MASK) {
      const real = getAtPath(current, path);
      if (real !== undefined) {
        setAtPath(clone, path, real);
      }
    }
  }
  return clone;
}

interface FieldEdit {
  path: (string | number)[];
  value: any;
}

/**
 * Collects the minimal set of leaf edits that transform `oldObj` into `newObj`.
 * Objects are recursed; arrays and scalars are treated as atomic values
 * (replaced wholesale when they differ). Removed keys yield an edit with
 * `undefined`, which jsonc-parser's modify() turns into a property removal.
 */
function collectEdits(
  oldVal: any,
  newVal: any,
  path: (string | number)[],
  edits: FieldEdit[]
): void {
  if (isPlainObject(oldVal) && isPlainObject(newVal)) {
    const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    for (const key of keys) {
      collectEdits(oldVal[key], newVal[key], [...path, key], edits);
    }
    return;
  }
  if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
    edits.push({ path, value: newVal });
  }
}

/** Applies a list of field edits to JSONC text, preserving comments/formatting. */
export function applyFieldEdits(
  originalText: string,
  edits: FieldEdit[]
): string {
  let text = originalText;
  for (const edit of edits) {
    const jsoncEdits = modify(text, edit.path, edit.value, {
      formattingOptions: FORMATTING,
    });
    text = applyEdits(text, jsoncEdits);
  }
  return text;
}

/**
 * Produces updated JSONC text that reflects `newConfig` while preserving the
 * comments and formatting of `originalText`. Only fields that differ from
 * `currentConfig` are edited, so untouched sections (and their comments) are
 * left exactly as-is.
 */
export function updateJsoncConfig(
  originalText: string,
  newConfig: any,
  currentConfig: any
): string {
  const edits: FieldEdit[] = [];
  collectEdits(currentConfig, newConfig, [], edits);
  return applyFieldEdits(originalText, edits);
}
