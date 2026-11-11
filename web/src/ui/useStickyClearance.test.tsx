import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollParent, useStickyClearance } from './useStickyClearance';

/**
 * P0074 / P0081 (MP-0288-06, WCAG 2.4.11): a header pinned at the top of a scrolling panel never hides
 * the focused control. The hook measures the pinned header into --sticky-clearance on its scroll
 * container, and the stylesheet turns that into scroll-padding. Geometry in a real browser:
 * web/e2e/mp-0288-seam-inspector.e2e.ts MP-0288-06.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const read = (file: string) => fs.readFileSync(`${node.cwd()}/src/${file}`, 'utf8');

function Pinned({ position = 'sticky' }: { position?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useStickyClearance(ref);
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      <div>
        <div ref={ref} data-testid="pinned" style={{ position: position as 'sticky' }}>Morning Light into Slow Tide</div>
      </div>
    </div>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('useStickyClearance', () => {
  it('finds the scrolling ancestor the header is pinned inside', () => {
    const { getByTestId } = render(<Pinned />);
    expect(scrollParent(getByTestId('pinned'))).toBe(getByTestId('scroller'));
  });

  it('gives the scroll container room for the pinned header, and takes it back on close', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 97.2 } as DOMRect);
    const { getByTestId, unmount } = render(<Pinned />);
    const scroller = getByTestId('scroller');
    expect(scroller.style.getPropertyValue('--sticky-clearance')).toBe('98px');
    unmount();
    expect(scroller.style.getPropertyValue('--sticky-clearance')).toBe('');
  });

  it('needs no room when a short screen unpins the header', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 97 } as DOMRect);
    const { getByTestId } = render(<Pinned position="static" />);
    expect(getByTestId('scroller').style.getPropertyValue('--sticky-clearance')).toBe('0px');
  });

  it('is wired to the transition identity, the song identity and the Studio head', () => {
    expect(read('views/SeamInspector.tsx')).toMatch(/useStickyClearance\(identity\)[\s\S]*className="inspector-identity" ref=\{identity\}/);
    expect(read('views/EditorRows.tsx')).toMatch(/useStickyClearance\(identity\)[\s\S]*className="inspector-identity" ref=\{identity\}/);
    expect(read('views/Studio.tsx')).toMatch(/useStickyClearance\(head\)[\s\S]*className="studio-head" ref=\{head\}/);
  });

  it('turns the measured height into scroll-padding, and keeps a focused square clear of the Studio ruler and names', () => {
    const css = read('styles/creation.css');
    expect(css).toMatch(/:is\(\.overlay-body, \.edit-inspector\):has\(\.inspector-identity, \.studio-head\) \{ scroll-padding-top: calc\(var\(--sticky-clearance, 0px\) \+ var\(--space-3\)\); \}/);
    expect(css).toMatch(/\.studio-grid \{[^}]*scroll-padding: var\(--space-6\) 0 0 var\(--name-width\);/);
  });
});
