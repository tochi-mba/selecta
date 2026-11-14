// Extract observed browser outcomes; never equate Playwright passing with hardware readiness.
import { readFile, writeFile } from 'node:fs/promises';
const [input = 'test-results/br64-10-results.json',
  output = 'test-results/br64-10-coverage.json'] = process.argv.slice(2);
const summary = {
  kind: 'browser-qa-only',
  source: input,
  pass: 0, failed: 0, skipped: 0, interrupted: 0, notRun: 0,
  hardwareCertified: false, productionCloudCertified: false,
  mobileOSCertified: false, externalSpeakerCertified: false,
  codecs: 'see per-test attached evidence',
  blockers: [
    'real iPad Safari venue foreground 6-hour test',
    'real Android Chrome tablet venue foreground 6-hour test',
    'actual phone render short/long and interruptions',
    'physical speaker, Bluetooth and USB routing',
    'real authenticated production Cloud end-to-end media flows',
  ],
};
try {
  const data = JSON.parse(await readFile(input, 'utf-8'));
  const walk = (suites) => {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) {
        if (!test.results?.length) { summary.notRun++; continue; }
        const final = test.results.at(-1);
        if (final.status === 'passed' && test.expectedStatus === 'skipped') summary.skipped++;
        else if (final.status === 'passed') summary.pass++;
        else if (final.status === 'skipped') summary.skipped++;
        else if (final.status === 'failed' || final.status === 'timedOut') summary.failed++;
        else summary.interrupted++;
      }
      walk(suite.suites);
    }
  };
  walk(data.suites);
} catch (error) {
  summary.notRun++;
  summary.failureToRead = String(error);
}
await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (summary.failed || summary.notRun || summary.interrupted) process.exitCode = 1;
