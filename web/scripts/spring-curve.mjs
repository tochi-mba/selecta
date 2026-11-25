// Prints the CSS linear() curves used for the spatial motion tokens in src/styles/tokens.css
// (ADR-0477), so the numbers there can be reproduced or retuned instead of hand-edited.
//
//   node scripts/spring-curve.mjs
//
// A spring's step response for damping ratio zeta, with time scaled so the curve's length is 1:
//   under-damped (zeta < 1): 1 - e^(-zeta w t) (cos(wd t) + zeta / sqrt(1 - zeta^2) sin(wd t))
//   critically damped (zeta = 1): 1 - e^(-w t) (1 + w t)
// The natural frequency w is chosen so the under-damped curves reach their first peak at `peak`
// of the way through, and the critically damped one is 99.4% settled at 90%.

const STEPS = 10;

function underDamped(zeta, peak) {
  const wd = Math.PI / peak;
  const w = wd / Math.sqrt(1 - zeta * zeta);
  const k = zeta / Math.sqrt(1 - zeta * zeta);
  return (t) => 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + k * Math.sin(wd * t));
}

function criticallyDamped(w) {
  return (t) => 1 - Math.exp(-w * t) * (1 + w * t);
}

function linear(curve) {
  const stops = [];
  for (let index = 1; index < STEPS; index += 1) {
    const t = index / STEPS;
    stops.push(`${Number(curve(t).toFixed(3))} ${t * 100}%`);
  }
  return `linear(0, ${stops.join(', ')}, 1)`;
}

const springs = {
  // no overshoot: pages, shared things travelling, timeline drops, everything in Subtle
  '--spring-gentle': criticallyDamped(8.07),
  // about 4.5% over, peaking around 70%: an arrival, a lifted card settling
  '--spring-snappy': underDamped(0.7, 0.68),
  // about 16% over, peaking at 40%: a control springing back, a celebration
  '--spring-bouncy': underDamped(0.5, 0.4),
};

for (const [name, curve] of Object.entries(springs)) console.log(`${name}: ${linear(curve)};`);
