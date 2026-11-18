/**
 * The stylesheet scope every static style guard walks (BF overhaul W6): every `.css` under web/src,
 * the local app's shared sheets and every feature-local sheet alike (Cloud, Rooms, devices, guest,
 * display, admin, business, venue staff). tokens.css defines the values and is left to the guards
 * that read it on purpose.
 *
 * Vitest hands CSS ?raw imports back empty and the app's tsconfig has no Node types, so files are
 * read through Node's own loader from web/, where vitest runs.
 */
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
  existsSync(path: string): boolean;
};
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
export const fs = node.getBuiltinModule('node:fs') as Fs;
export const SOURCE = `${node.cwd()}/src/`;
export const ROOT = `${node.cwd()}/../`;

/** Every file under web/src, forward slashes, relative to web/src. */
export const SOURCE_FILES = fs.readdirSync(SOURCE, { recursive: true }).map((name) => name.replace(/\\/g, '/')).sort();

/** Every stylesheet under web/src. */
export const ALL_SHEETS = SOURCE_FILES.filter((name) => name.endsWith('.css'));

/** Every stylesheet a component rule may live in: all of them but tokens.css. */
export const COMPONENT_SHEETS = ALL_SHEETS.filter((name) => name !== 'styles/tokens.css');

/** App source (not tests, not the test helpers) of the given extensions. */
export const appSource = (pattern: RegExp) => SOURCE_FILES.filter((name) => pattern.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith('test/'));

export const readSource = (file: string) => fs.readFileSync(SOURCE + file, 'utf8');
/** A stylesheet with its comments removed. */
export const readSheet = (file: string) => readSource(file).replace(/\/\*[\s\S]*?\*\//g, '');

export type Rule = { file: string; selector: string; body: string };
/** Every innermost rule (selector and body) of the given sheets, at-rule bodies flattened. */
export function rulesOf(files: readonly string[]): Rule[] {
  return files.flatMap((file) => [...readSheet(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ file, selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] })));
}
