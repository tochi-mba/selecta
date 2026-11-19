# Setting up a SelectaDJ player

This guide is for the person who sets up the small player behind the bar: a mini PC, an Android
TV box or a tablet that runs the SelectaDJ player page at `/kiosk` with nobody watching it
(ADR-0445). It is versioned with the app. **Nothing in the table below has been checked on real
hardware yet.** Each row says "Not checked on hardware" until a person has done it and recorded
the device, the browser version and the date (ADR-0445 BZ-0445-12).

## 1. Pair the player

1. Open `https://<your SelectaDJ address>/kiosk` on the player. It shows a six-character code and
   a QR code. The code changes every 10 minutes and works once.
2. On your phone or computer, open the venue in SelectaDJ, go to **Devices**, type the code and
   choose the zone the player plays in. You need the "Pair a kiosk" permission at that venue.
3. The player shows the zone a few seconds later. A zone can have two players: a home player and
   a standby. To swap a broken player, use **Replace** on the old one; the old one stops at once.

## 2. Make it start with sound, without a tap

Browsers only play sound without a tap in some cases. The player checks this itself when it
starts: if sound is blocked it shows **Tap to start the music**, and inside opening hours your
managers are told. One tap lasts until the page is reloaded. To remove the tap entirely:

| Platform | How the page starts with sound | Status |
|---|---|---|
| Windows mini PC, Chrome | Chrome enterprise policy `AutoplayAllowed` (or `AutoplayAllowlist` with your SelectaDJ address); start Chrome with `--kiosk https://<address>/kiosk`, or add `--autoplay-policy=no-user-gesture-required` | Recommended. Not checked on hardware |
| Windows mini PC, Edge | Edge policy `AutoplayAllowed` or `AutoplayAllowlist`; Windows Assigned Access, or `msedge --kiosk https://<address>/kiosk --edge-kiosk-type=fullscreen` | Recommended. Not checked on hardware |
| Linux mini PC | Chromium with the same policy file in `/etc/chromium/policies/managed/` and `--kiosk`, started by the session autostart | Supported. Not checked on hardware |
| ChromeOS device | Kiosk app or managed guest policy with `AutoplayAllowlist` | Supported where a venue already manages ChromeOS. Not checked on hardware |
| Android tablet or TV box | No launch flags in Chrome for Android. Use a kiosk browser app that allows media without a gesture and starts on boot (a third-party app; the owner chooses and licenses one), or install the page to the home screen; otherwise one tap per restart | Owner to choose. Not checked on hardware |
| iPad | Safari always needs a tap after each page load and pauses sound when the screen locks; Guided Access keeps it on the page | One tap per restart, screen always on. Not recommended. Not checked on hardware |

## 3. Power cuts and restarts

- In the BIOS or firmware, set **restore on AC power loss** to **power on**.
- Sign in automatically to a local account used only for the player.
- Start the browser at sign-in in kiosk mode on `/kiosk`.
- Turn operating-system sleep off, and screen sleep off too if the device has no wake lock
  (the player's health in SelectaDJ says "Screen may sleep" when that is the case).
- After a restart inside opening hours the player resumes where the schedule says, with a 5
  second fade-in, and your managers see "Bar player restarted at 14:02 (power or crash?)".
- If the player restarts with no internet and its clock looks wrong, it does not start by
  itself: it shows **Tap to start the music** with "Time unknown", so a power return at night
  never wakes the street.

## 4. Updates

- The player updates itself only while the zone is closed (or in the 30 minutes before it
  warms up), never during service. An update reloads the page once ("Updating, back in a
  moment").
- Set **Windows Update active hours** (or your browser's relaunch window policy) to cover your
  opening hours, so the operating system never restarts the player during service. SelectaDJ
  shows the browser version in the player's health so a forced browser restart is visible.

## 5. Lock the device

- Use the operating system's kiosk mode (Assigned Access, Guided Access or a kiosk browser) so
  a customer cannot leave the page. If the page is closed, kiosk mode reopens it.
- Staff can open a small read-only panel by pressing and holding the top-left corner of the
  screen for 3 seconds (with the venue's staff PIN when PINs are on).

## 6. When the internet drops

- The player keeps up to about four hours of music saved ahead and plays it with no internet.
  Ask the browser to keep that storage: the player requests persistent storage when it is
  paired and reports whether it was granted.
- Past its saved music it replays saved songs with simple crossfades. Only when nothing saved
  is left does it show "The music will be back shortly".

## What SelectaDJ can and cannot know

SelectaDJ hears what the player sends out, not the room. A switched-off amplifier or an unplugged
cable is invisible to it, so check the sound now and then. A stolen player can play only the
music it has saved; unpair it in SelectaDJ and it gets nothing more and wipes its saved music
the next time it connects.
