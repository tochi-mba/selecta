/** Pure scheduling helpers; AudioParam curves are calculated outside the realtime callback. */
export function boundedPosition(value: number, duration: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(0, value), Math.max(0, duration - 0.001));
}
export function boundedFade(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(12, value)) : 0;
}
export function transitionWindow(remaining: number, requested: number, nextDuration: number): number {
  return Math.min(boundedFade(requested), Math.max(0, remaining), Math.max(0, nextDuration));
}
export function equalPowerCurves(steps = 64): { outgoing: Float32Array; incoming: Float32Array } {
  const count = Math.max(2, Math.floor(steps));
  const outgoing = new Float32Array(count);
  const incoming = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const radians = (index / (count - 1)) * Math.PI / 2;
    outgoing[index] = Math.cos(radians);
    incoming[index] = Math.sin(radians);
  }
  return { outgoing, incoming };
}
export function remainingMs(duration: number, position: number, fade: number): number {
  return Math.max(0, (duration - position - boundedFade(fade)) * 1000);
}
