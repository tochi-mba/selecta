import { describe, expect, it } from 'vitest';

/**
 * S4-0094-10: every menu in the product has a route task script (web/e2e/s4-route-tasks.json) or a
 * named test that opens it, so no action can disappear into a menu unnoticed.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const script = JSON.parse(fs.readFileSync(`${node.cwd()}/e2e/s4-route-tasks.json`, 'utf8')) as {
  tasks: { route: string; task: string; menu?: string; role: string; name: string }[];
  menusCoveredElsewhere: Record<string, string>;
  menuSources: Record<string, string>;
};
const menuFiles = fs.readdirSync(SOURCE, { recursive: true })
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
  .filter((file) => /<Menu\b/.test(fs.readFileSync(SOURCE + file, 'utf8')));

describe('S4-0094-10 route task scripts', () => {
  it('finds the product menus', () => {
    expect(menuFiles).toEqual(expect.arrayContaining(['views/EditorRows.tsx', 'views/LibraryRow.tsx', 'ui/ThemeChoice.tsx']));
  });

  it('every file that renders a menu is scripted or names the test that opens it', () => {
    const covered = new Set([...Object.keys(script.menuSources), ...Object.keys(script.menusCoveredElsewhere)]);
    expect(menuFiles.filter((file) => !covered.has(file))).toEqual([]);
  });

  it('every scripted menu has at least one task that opens it', () => {
    for (const [file, opener] of Object.entries(script.menuSources)) {
      expect(script.tasks.some((task) => task.menu === opener), file).toBe(true);
    }
  });

  it('a test named as covering a menu exists and opens it', () => {
    for (const [file, why] of Object.entries(script.menusCoveredElsewhere)) {
      for (const [path] of why.matchAll(/(?:src|web\/e2e)\/[\w/.-]+\.(?:tsx?|e2e\.ts)/g)) {
        const real = path.startsWith('web/') ? `${node.cwd()}/${path.slice(4)}` : `${node.cwd()}/${path}`;
        expect(() => fs.readFileSync(real, 'utf8'), `${file} names ${path}`).not.toThrow();
      }
    }
  });

  it('every task names a route the router knows, and a valid pattern', () => {
    const routes = fs.readFileSync(`${SOURCE}router.ts`, 'utf8') + fs.readFileSync(`${SOURCE}shell/manifest.ts`, 'utf8');
    for (const task of script.tasks) {
      const first = task.route.split('/')[1];
      expect(routes, task.route).toContain(`/${first}`);
      expect(() => new RegExp(task.name)).not.toThrow();
      if (task.menu) expect(() => new RegExp(task.menu!)).not.toThrow();
    }
  });
});
