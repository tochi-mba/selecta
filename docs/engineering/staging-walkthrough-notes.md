# Staging walkthrough notes

Things to refine, found by walking staging (app.staging.selectadj.app) as the owner's accounts. Each item says what was seen, where, and what good looks like. Newest first. Owner of each fix in brackets.

## 2026-11-24 evening: admin console, hosted storage

### Hosted storage (tochimba26 after the console switch)
1. **Upload fails with the wrong words.** Add music, one 3.4 MB MP3: the API answered 503 and the page said "SelectaDJ is being updated and is back in a moment. Anything playing keeps playing." The server log says `Couldn't start upload ...: NoSuchBucket`: the staging R2 bucket does not exist. A storage misconfiguration must never read as an update. Good: "We couldn't store this file right now. Nothing was lost. Try again later, or contact support with reference R-..." and an operator alert. [audit]
2. **The failed upload lingers as "Unfinished uploads ... 1 part"** with "Choose the same file again and SelectaDJ carries on". That is wrong when the cause is on our side. Good: say it failed on our side, offer Remove, and retry by itself when storage is healthy. [audit]
3. **"Nothing has changed for you" note shown to an account that was just switched to hosted mode.** It is the note for older hosted accounts ("Your hosted library ... work exactly as they did"). Good: a newly granted account sees "Cloud storage is on for your account. Upload songs in Add music; they're stored privately and mixes can be rendered for you." once. [audit]
4. **The Library mixes both modes without explaining.** After the switch, Library still leads with "Connect music" and "2,918 of 2,919 songs can play here. Choose your music folder", next to a new "Add music" upload page. Good: one clear explanation of where this account's songs live (on this device, in Cloud storage, or both) and which button does what. [audit + editor]
5. **The Library took about 30 seconds to open** (2,919 songs) and showed "This is taking longer than expected. You can keep waiting." Good: first rows within a second (paged, or from the offline catalogue), the rest streaming in. [audit]

### Admin console
6. **System and Overview did not catch the missing bucket.** "File storage (R2): Not reporting" is all it said. Good: the System page checks each configured bucket exists and is writable, and Overview turns red with "Storage bucket selecta-staging-originals doesn't exist" and the fix. [admin]
7. **Most services "Not reporting".** Fine as honest, but each needs a one-line "how to connect" and the important ones (API, Stripe webhooks, storage) should report from the API itself, not only from tasks that may not run on staging. [admin]
8. **Leave console** sits at the bottom of the sidebar and scrolls out of view on short screens; it is not in the phone menu. Owner asked for it in the sidebar. [admin, sent]
9. **The welcome page** lists the role well. The setup checklist is good; "Turn on two-factor sign-in" should tick itself when the staff organization already requires it. [admin]
10. **Make changes** works and the 15-minute window is clear. The orange environment bar reads "Staging · email · role · session ends", which is good.

### Account switching in one browser
11. Signing out and in as another account in Helium worked, but each switch needed the owner. Covered by section H in ADR-0475 (being built). [devices]
