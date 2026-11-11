import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SongMotif, VibeMotif } from './MusicObjects';

/** UF-0369-05: Selecta shows no album covers it doesn't have. The only pictures beside music are
 * decorative motifs drawn from an ID or an idea's name, hidden from assistive technology, and no
 * page loads an image that could pass for cover art. */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const pages = fs.readdirSync(SOURCE, { recursive: true })
  .map((name) => name.replace(/\\/g, '/'))
  .filter((name) => /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) && !name.startsWith('cloud/') && !name.startsWith('admin/') && !name.startsWith('test/'));

describe('truthful imagery', () => {
  it('no listening page draws an image or asks for cover art', () => {
    expect(pages.length).toBeGreaterThan(20);
    for (const name of pages) {
      const text = fs.readFileSync(SOURCE + name, 'utf8');
      expect(text, name).not.toMatch(/<img\b|new Image\(|background-image:\s*url\(/);
      expect(text, name).not.toMatch(/\b(cover_?art|album_?art|artwork_?url|cover_?url)\b/i);
    }
  });

  it('song and idea motifs are decorative and hidden from assistive technology', () => {
    const { container } = render(<><SongMotif songId={7} /><VibeMotif idea="evening-drive" group="The mood" /></>);
    const pictures = container.querySelectorAll('svg');
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) {
      expect(picture.getAttribute('aria-hidden')).toBe('true');
      expect(picture.querySelector('image')).toBeNull();
    }
  });

  it('a motif is the same for the same ID and different for another, so it never implies real art', () => {
    const one = render(<SongMotif songId={7} />).container.innerHTML;
    const again = render(<SongMotif songId={7} />).container.innerHTML;
    const other = render(<SongMotif songId={8} />).container.innerHTML;
    expect(again).toBe(one);
    expect(other).not.toBe(one);
  });
});
