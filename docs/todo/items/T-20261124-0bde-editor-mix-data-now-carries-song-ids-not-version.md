---
id: T-20261124-0bde
title: Editor: mix data now carries song ids, not version ids
area: editor
status: open
priority: normal
who: claude
created: 2026-11-24
source: ADR-0469 amendment 2 (duplicate songs fix)
commit:
---

asMixData (web/src/cloud/recipeStore.ts) now reports each mix item's song id (the primary id of its song, songVersions.ts primaryOf), and deviceMusicMixes.ts compares the x-mix-order header against song ids too. A mix made before grouping may hold another version's id in the recipe; it is shown and edited as the song, and an edit writes the song id back. Check the editor's own id comparisons (reorder, seams by position, phone editor) still agree, and that nothing in the editor reads recipe.songs directly expecting the shown ids.
