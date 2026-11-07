# Selecta 3.0: places, addresses and the shell

Covers S3-0048-01, S3-0048-03, S3-0048-04, S3-0048-05, S3-0048-07, S3-0048-08, S3-0049-02, S3-0049-05, S3-0049-07, S3-0071-05 and S3-0076-03. The code is `web/src/router.ts` and `web/src/shell/manifest.ts`.

## Five places, and what belongs to each

| Destination | Address | Holds |
|---|---|---|
| Listen | `/listen` | What's playing, what's next, lyrics, the Stage |
| Explore | `/mixes` | Mixes, then `/discover` for word connections and `/discover/harmonic` for harmonic matches |
| My Mixes | `/mixes/mine` | The current mix, your drafts, the render line. Editing opens from here |
| Library | `/library` | Every song, its details and corrections |
| Workspace | `/workshop` | `/analysis`, `/sources`, `/storage`, `/learning`, `/diagnostics`, and the study at `/listening` |

Edit is contextual: `/mix/current/edit` and `/mixes/drafts/:id/edit` belong under My Mixes, and the rail also has a direct Edit link once there's a mix. Requests, Activity, Search and shortcuts are reachable from every page through the header bar and the rail.

## Addresses

The existing addresses stay the real ones. Nothing was moved, so every bookmark, installed app and direct link means what it always meant.

| Older address | Still does |
|---|---|
| `/`, `/mixes` | Explore: Mixes |
| `/mixes/mine` | My Mixes |
| `/listen` | Listen |
| `/library?q=&show=&sort=&pages=` | Library with that search, filter, order and depth. Older links with `show` and `sort` keep working |
| `/discover`, `/discover/words` | Word connections |
| `/discover/harmonic` | Harmonic matches |
| `/workshop`, `/workshop/:tab` | Workspace and its sections |
| `/listening` | The blind study |
| `/mix/current/edit` | Edit the current mix |
| `/mixes/drafts/:id/edit` | Edit that draft, or a clear message if it has gone |

New aliases, added and never reinterpreting anything: `/explore`, `/explore/mixes`, `/explore/words`, `/explore/harmonic`, `/my-mixes`, `/workspace`, `/workspace/:tab`, `/studies`. The server has to know them too, so reloading works: see `PAGE_ADDRESSES` in `api_common.py`.

An unknown address shows "There's nothing at this address", says your music is fine, and offers a way back. It doesn't redirect, so an old link is visibly old.

## Scroll, history and titles

- A new page starts at the top, with focus at its start. Back and Forward return to the saved scroll position.
- Typing in a search replaces the address, so Back doesn't walk through every letter. Choosing a filter or order adds to history, so Back undoes it.
- The title follows what's playing when something is, so the system's media surface stays right, and otherwise the page's name.
- A page change is announced once by name. Breadcrumbs appear in the header, and the current one is `aria-current="page"`.

## Current versus draft

The address decides which mix is being edited, and nothing else can. The draft id comes from the URL, every write carries that scope, and every position-based write carries `x-mix-order`, so a stale page is refused rather than changing the wrong thing. The header says which it is and what it does or doesn't touch.

## Shell geometry

All of it lives in `tokens.css` on the root, so there is one answer to how much room the bars take:

```
--rail-offset      the rail's width on wide screens, 0 on narrow ones and on the Stage
--nav-bottom       0 on wide screens, the nav bar plus the safe area on narrow ones
--player-height    66px when the mini-player shows, otherwise 0
--bottom-chrome    --nav-bottom + --player-height
--keyboard-inset   how much of the window an on-screen keyboard covers
```

Two old bugs went with this. A later `.mini { bottom: 0 }` beat the mobile offset, so the mini-player sat on top of the bottom navigation. And `--bottom-chrome` was worked out on the root while the player's height was set further down, so it never saw the player, and the last row of a page could end up underneath it.

Stacking, lowest first: page sticky parts, header, navigation, player, sheets, dialogs, toasts.

With an on-screen keyboard up on a narrow screen, the navigation and player step aside so nothing covers what's being typed. Overlays and toasts lift above it.

## Full player, mini-player and Stage

- Listen holds the full player. Every other page gets the mini-player. Neither owns the audio.
- The Stage is a presentation of Listen. Going in remembers where focus was, and coming out puts it back.
- If the browser refuses fullscreen, the Stage fills the page and says so. Escape and the exit button both work either way.
- On the Stage, only real problems interrupt. Other messages wait in Activity.

## The rail

Wide screens get the rail, expanded or collapsed. The choice is kept in this browser. Collapsed, each item keeps its name for screen readers and shows it in a tooltip on a resting pointer or keyboard focus. The current page uses `aria-current="page"`, and a parent of the current page uses `aria-current="true"`.

## Going back: the kill switch

There is no data migration, so going back loses nothing.

- **Older navigation:** Workspace, Diagnostics, Interface, or `?ui=classic` on any address, or `?ui=new` to return. It brings back the Mixes, Discover and Workshop labels over the same pages.
- **Everything else:** the frontend is a build served by the backend, so an older build can be put back as it is. Additive API routes and preference keys are simply ignored by older code, and `last_deleted_draft` is still written so an older restore keeps working.
