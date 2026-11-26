/** Who rendered and measured a transition on this device, kept apart from the DSP so a page can
 * name it without loading the renderer. docs/engineering/device-render.md lists them.
 *
 * A result names the renderer and the stretcher together, as `web-render-1+wsola-stretch-v1`:
 * the stretcher is the one stage that cannot match the Desktop's (Rubber Band), so a clip made
 * with another stretcher is a different implementation. Bump the renderer's id when any stage
 * changes what it returns. */

/** The port of render(), in_context(), audit() and the repair rule (web/src/dsp/render/). */
export const RENDER_IMPLEMENTATION = 'web-render-1';

/** The Python script schema it reads (`script_json.SCHEMA_VERSION`). */
export const SCRIPT_SCHEMA = 1;
