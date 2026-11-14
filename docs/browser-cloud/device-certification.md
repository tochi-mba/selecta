# Physical hardware and rendering certification protocol

Use one JSON record per tested configuration. Validate completed records with:

```sh
python tools/browser_test/evidence.py docs/browser-cloud/device-evidence.example.json
```

The example is intentionally `blocked`; **do not change it to certified** without a
real test. Reports must include exact model, OS/browser versions, hardware, source type,
codec, DSP revision, speaker route, tester, UTC time and raw observations. Do not
fill unknown values with invented zeros; distinguish `null`, unavailable and failed.

## Real iPad-only and Android-tablet-only venue runs

Perform **independent** six-hour minimum sessions on physical iPad Safari and
Android Chrome tablets: no second playback computer, no companion Python/FFmpeg
server. Connect device to reliable power; keep display awake with the app in the
foreground, and use owned source files on the tablet. Before each run confirm
the actual speaker via human audible sound check; note wired, Bluetooth or built-in
route. Verify source access, hands-on start, transition playback and no double speaker.
Log monotonic start/end times, underruns, peak transition error, source loss, battery
and temperature when observable. Repeat with chosen Bluetooth/USB devices.

Any unexpected audio gap, output uncertainty, browser discard or route switch is a
failure or a documented degradation, not a passing result. Do **not** simulate six
hours by advancing clocks or looping short mocks. A real venue certification records
physical hardware and `foreground_powered_awake_hours >= 6`. Screen-off, app switch
and reboot have **separate** tests; no guarantee of unattended restart.

## Phone local rendering

On real iPhone Safari and Android Chrome phones at minimum:

1. Select local sources, play and independently verify a physical speaker.
2. Export 30-second mix locally, decode or reimport, validate duration, channels,
   peak, loudness, transitions and expected song/revision identity.
3. Export long mix (at least one hour), record chunk size, duration, storage
   budget, CPU/memory where measurable, heat, battery and thermal throttling.
4. Exercise low storage/quota, background interruption, OS call/audio focus,
   cancellation and restart; verify no corrupt artifact is marked completed.
5. Downgrade one resource-intensive feature using explicit user-facing explanation;
   do not downgrade secretly or upload media as a fallback.
6. Work offline after source selection, disconnect Bluetooth/USB, restore output
   and repeat the sound check. Revoke file permission and handle source unavailability.

Record actually measured timings rather than predicted benchmark results.

## Manual accessibility

Use real VoiceOver on iPhone/iPad, TalkBack on Android, desktop NVDA/VoiceOver as
applicable. Test visible focus and keyboard navigation, zoom/reflow at 200%/400%,
reduced motion, dynamic type, portrait/landscape and screen-reader playback status.
Never pass these solely on automated axe or a desktop browser profile.

## Results policy

`certified` requires real hardware, human-verified speaker, observed pass, tester,
timestamp and every mandatory metric field; the validator additionally requires
the six-hour venue observation for iPad/Android sole-device venues. This validator
only checks record completeness and anti-fabrication rules, **not** whether a human
actually performed or independently reviewed the run. Evidence requires review
and an independently accessible recording/log as permitted by privacy policy.
