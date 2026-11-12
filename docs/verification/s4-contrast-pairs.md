# Selecta 4.0 contrast pair table (S4-0090-10)

Generated from `web/src/styles/tokens.css` by `python -m selecta.audit.contrast_pairs --write`; `tests/test_s4_contrast_pairs.py` fails when it falls behind or a pair drops below its minimum without a listed exception.

Minimums: text 4.5:1, non-text marks 3:1 (WCAG 2.2 1.4.3 and 1.4.11). Decoration and disabled controls (text at opacity 0.42) are WCAG-exempt and shown for information. The system-light block equals the Light block: yes.

## Exceptions for owner review

None: every measured pair meets its minimum.

## Dark

| Kind | Foreground | Background | Colours | Ratio | Minimum | Result |
|---|---|---|---|---|---|---|
| text | `--text` | `--surface-base` | #f4f0e4 on #100f0c | 16.82:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-base` | #a8a292 on #100f0c | 7.53:1 | 4.5:1 | pass |
| text | `--link` | `--surface-base` | #e8ff3a on #100f0c | 17.16:1 | 4.5:1 | pass |
| text | `--text` | `--surface-raised` | #f4f0e4 on #1a1814 | 15.56:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-raised` | #a8a292 on #1a1814 | 6.96:1 | 4.5:1 | pass |
| text | `--link` | `--surface-raised` | #e8ff3a on #1a1814 | 15.87:1 | 4.5:1 | pass |
| text | `--text` | `--surface-control` | #f4f0e4 on #24211b | 14.09:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-control` | #a8a292 on #24211b | 6.3:1 | 4.5:1 | pass |
| text | `--link` | `--surface-control` | #e8ff3a on #24211b | 14.37:1 | 4.5:1 | pass |
| text | `--text` | `--surface-overlay` | #f4f0e4 on #272520 | 13.44:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-overlay` | #a8a292 on #272520 | 6.01:1 | 4.5:1 | pass |
| text | `--link` | `--surface-overlay` | #e8ff3a on #272520 | 13.7:1 | 4.5:1 | pass |
| text | `--text` | `--surface-selected` | #f4f0e4 on #333419 | 11.2:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-selected` | #a8a292 on #333419 | 5.01:1 | 4.5:1 | pass |
| text | `--link` | `--surface-selected` | #e8ff3a on #333419 | 11.42:1 | 4.5:1 | pass |
| status text | `--status-ready` | `--surface-base` | #9ed46a on #100f0c | 11.02:1 | 4.5:1 | pass |
| status text | `--status-working` | `--surface-base` | #e8ff3a on #100f0c | 17.16:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-base` | #a8a292 on #100f0c | 7.53:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-base` | #ff7a4d on #100f0c | 7.43:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-base` | #ff7a4d on #100f0c | 7.43:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-base` | #6fd3ff on #100f0c | 11.35:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-base` | #6fd3ff on #100f0c | 11.35:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-base` | #ff7a4d on #100f0c | 7.43:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-base` | #7c7769 on #100f0c | 4.29:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-base` | #e8ff3a on #100f0c | 17.16:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-base` | #e8ff3a on #100f0c | 17.16:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-base` | #ff7a4d on #100f0c | 7.43:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-base` | #666155 on #100f0c | 3.11:1 | 3.0:1 | pass |
| non-text mark | `--motif` | `--surface-base` | #cbd562 on #100f0c | 12.08:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-base` | #3a362c on #100f0c | 1.59:1 | none | info |
| status text | `--status-ready` | `--surface-raised` | #9ed46a on #1a1814 | 10.2:1 | 4.5:1 | pass |
| status text | `--status-working` | `--surface-raised` | #e8ff3a on #1a1814 | 15.87:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-raised` | #a8a292 on #1a1814 | 6.96:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-raised` | #ff7a4d on #1a1814 | 6.87:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-raised` | #ff7a4d on #1a1814 | 6.87:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-raised` | #6fd3ff on #1a1814 | 10.5:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-raised` | #6fd3ff on #1a1814 | 10.5:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-raised` | #ff7a4d on #1a1814 | 6.87:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-raised` | #7c7769 on #1a1814 | 3.97:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-raised` | #e8ff3a on #1a1814 | 15.87:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-raised` | #e8ff3a on #1a1814 | 15.87:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-raised` | #ff7a4d on #1a1814 | 6.87:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-raised` | #666155 on #1a1814 | 2.88:1 | 3.0:1 | FAIL |
| non-text mark | `--motif` | `--surface-raised` | #cbd562 on #1a1814 | 11.17:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-raised` | #3a362c on #1a1814 | 1.47:1 | none | info |
| status text | `--status-ready` | `--surface-control` | #9ed46a on #24211b | 9.23:1 | 4.5:1 | pass |
| status text | `--status-working` | `--surface-control` | #e8ff3a on #24211b | 14.37:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-control` | #a8a292 on #24211b | 6.3:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-control` | #ff7a4d on #24211b | 6.22:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-control` | #ff7a4d on #24211b | 6.22:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-control` | #6fd3ff on #24211b | 9.51:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-control` | #6fd3ff on #24211b | 9.51:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-control` | #ff7a4d on #24211b | 6.22:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-control` | #7c7769 on #24211b | 3.59:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-control` | #e8ff3a on #24211b | 14.37:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-control` | #e8ff3a on #24211b | 14.37:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-control` | #ff7a4d on #24211b | 6.22:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-control` | #666155 on #24211b | 2.6:1 | 3.0:1 | FAIL |
| non-text mark | `--motif` | `--surface-control` | #cbd562 on #24211b | 10.11:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-control` | #3a362c on #24211b | 1.33:1 | none | info |
| status text | `--status-ready` | `--surface-overlay` | #9ed46a on #272520 | 8.81:1 | 4.5:1 | pass |
| status text | `--status-working` | `--surface-overlay` | #e8ff3a on #272520 | 13.7:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-overlay` | #a8a292 on #272520 | 6.01:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-overlay` | #ff7a4d on #272520 | 5.94:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-overlay` | #ff7a4d on #272520 | 5.94:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-overlay` | #6fd3ff on #272520 | 9.07:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-overlay` | #6fd3ff on #272520 | 9.07:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-overlay` | #ff7a4d on #272520 | 5.94:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-overlay` | #7c7769 on #272520 | 3.43:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-overlay` | #e8ff3a on #272520 | 13.7:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-overlay` | #e8ff3a on #272520 | 13.7:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-overlay` | #ff7a4d on #272520 | 5.94:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-overlay` | #666155 on #272520 | 2.48:1 | 3.0:1 | FAIL |
| non-text mark | `--motif` | `--surface-overlay` | #cbd562 on #272520 | 9.65:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-overlay` | #3a362c on #272520 | 1.27:1 | none | info |
| action | `--primary-ink` | `--primary-fill` | #14140a on #e8ff3a | 16.57:1 | 4.5:1 | pass |
| action edge | `--primary-edge` | `--surface-base` | #e8ff3a on #100f0c | 17.16:1 | 3.0:1 | pass |
| action edge | `--primary-edge` | `--surface-raised` | #e8ff3a on #1a1814 | 15.87:1 | 3.0:1 | pass |
| action edge | `--primary-edge` | `--surface-control` | #e8ff3a on #24211b | 14.37:1 | 3.0:1 | pass |
| action edge | `--primary-edge` | `--surface-overlay` | #e8ff3a on #272520 | 13.7:1 | 3.0:1 | pass |
| action | `--word-ink` | `--surface-base` | #e8ff3a on #100f0c | 17.16:1 | 4.5:1 | pass |
| action | `--word-ink` | `--surface-raised` | #e8ff3a on #1a1814 | 15.87:1 | 4.5:1 | pass |
| action | `--word-ink` | `--surface-control` | #e8ff3a on #24211b | 14.37:1 | 4.5:1 | pass |
| action | `--word-ink` | `--surface-overlay` | #e8ff3a on #272520 | 13.7:1 | 4.5:1 | pass |
| disabled (exempt) | `--text` | `--surface-control` | #7b786f on #24211b | 3.64:1 | none | info |
| disabled (exempt) | `--text` | `--surface-base` | #706e67 on #100f0c | 3.76:1 | none | info |

## Light

| Kind | Foreground | Background | Colours | Ratio | Minimum | Result |
|---|---|---|---|---|---|---|
| text | `--text` | `--surface-base` | #16140e on #f5f2e9 | 16.45:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-base` | #6a6555 on #f5f2e9 | 5.2:1 | 4.5:1 | pass |
| text | `--link` | `--surface-base` | #2b2a14 on #f5f2e9 | 12.99:1 | 4.5:1 | pass |
| text | `--text` | `--surface-raised` | #16140e on #fffdf6 | 18.09:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-raised` | #6a6555 on #fffdf6 | 5.72:1 | 4.5:1 | pass |
| text | `--link` | `--surface-raised` | #2b2a14 on #fffdf6 | 14.29:1 | 4.5:1 | pass |
| text | `--text` | `--surface-control` | #16140e on #ece8db | 15.02:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-control` | #6a6555 on #ece8db | 4.75:1 | 4.5:1 | pass |
| text | `--link` | `--surface-control` | #2b2a14 on #ece8db | 11.86:1 | 4.5:1 | pass |
| text | `--text` | `--surface-overlay` | #16140e on #fffdf6 | 18.09:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-overlay` | #6a6555 on #fffdf6 | 5.72:1 | 4.5:1 | pass |
| text | `--link` | `--surface-overlay` | #2b2a14 on #fffdf6 | 14.29:1 | 4.5:1 | pass |
| text | `--text` | `--surface-selected` | #16140e on #e6e4db | 14.45:1 | 4.5:1 | pass |
| text | `--text-soft` | `--surface-selected` | #6a6555 on #e6e4db | 4.57:1 | 4.5:1 | pass |
| text | `--link` | `--surface-selected` | #2b2a14 on #e6e4db | 11.42:1 | 4.5:1 | pass |
| status text | `--status-ready` | `--surface-base` | #3f7a1a on #f5f2e9 | 4.68:1 | 4.5:1 | pass |
| status text | `--status-working` | `--surface-base` | #2b2a14 on #f5f2e9 | 12.99:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-base` | #6a6555 on #f5f2e9 | 5.2:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-base` | #b93d10 on #f5f2e9 | 5.02:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-base` | #b93d10 on #f5f2e9 | 5.02:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-base` | #086a93 on #f5f2e9 | 5.37:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-base` | #086a93 on #f5f2e9 | 5.37:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-base` | #b93d10 on #f5f2e9 | 5.02:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-base` | #6a6555 on #f5f2e9 | 5.2:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-base` | #2b2a14 on #f5f2e9 | 12.99:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-base` | #2b2a14 on #f5f2e9 | 12.99:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-base` | #b93d10 on #f5f2e9 | 5.02:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-base` | #aaa593 on #f5f2e9 | 2.2:1 | 3.0:1 | FAIL |
| non-text mark | `--motif` | `--surface-base` | #474531 on #f5f2e9 | 8.67:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-base` | #d5cfbd on #f5f2e9 | 1.39:1 | none | info |
| status text | `--status-ready` | `--surface-raised` | #3f7a1a on #fffdf6 | 5.15:1 | 4.5:1 | pass |
| status text | `--status-working` | `--surface-raised` | #2b2a14 on #fffdf6 | 14.29:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-raised` | #6a6555 on #fffdf6 | 5.72:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-raised` | #b93d10 on #fffdf6 | 5.52:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-raised` | #b93d10 on #fffdf6 | 5.52:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-raised` | #086a93 on #fffdf6 | 5.91:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-raised` | #086a93 on #fffdf6 | 5.91:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-raised` | #b93d10 on #fffdf6 | 5.52:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-raised` | #6a6555 on #fffdf6 | 5.72:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-raised` | #2b2a14 on #fffdf6 | 14.29:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-raised` | #2b2a14 on #fffdf6 | 14.29:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-raised` | #b93d10 on #fffdf6 | 5.52:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-raised` | #aaa593 on #fffdf6 | 2.42:1 | 3.0:1 | FAIL |
| non-text mark | `--motif` | `--surface-raised` | #474531 on #fffdf6 | 9.54:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-raised` | #d5cfbd on #fffdf6 | 1.53:1 | none | info |
| status text | `--status-ready` | `--surface-control` | #3f7a1a on #ece8db | 4.27:1 | 4.5:1 | FAIL |
| status text | `--status-working` | `--surface-control` | #2b2a14 on #ece8db | 11.86:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-control` | #6a6555 on #ece8db | 4.75:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-control` | #b93d10 on #ece8db | 4.58:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-control` | #b93d10 on #ece8db | 4.58:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-control` | #086a93 on #ece8db | 4.9:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-control` | #086a93 on #ece8db | 4.9:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-control` | #b93d10 on #ece8db | 4.58:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-control` | #6a6555 on #ece8db | 4.75:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-control` | #2b2a14 on #ece8db | 11.86:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-control` | #2b2a14 on #ece8db | 11.86:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-control` | #b93d10 on #ece8db | 4.58:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-control` | #aaa593 on #ece8db | 2.01:1 | 3.0:1 | FAIL |
| non-text mark | `--motif` | `--surface-control` | #474531 on #ece8db | 7.92:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-control` | #d5cfbd on #ece8db | 1.27:1 | none | info |
| status text | `--status-ready` | `--surface-overlay` | #3f7a1a on #fffdf6 | 5.15:1 | 4.5:1 | pass |
| status text | `--status-working` | `--surface-overlay` | #2b2a14 on #fffdf6 | 14.29:1 | 4.5:1 | pass |
| status text | `--status-planned` | `--surface-overlay` | #6a6555 on #fffdf6 | 5.72:1 | 4.5:1 | pass |
| status text | `--status-warning` | `--surface-overlay` | #b93d10 on #fffdf6 | 5.52:1 | 4.5:1 | pass |
| status text | `--status-failed` | `--surface-overlay` | #b93d10 on #fffdf6 | 5.52:1 | 4.5:1 | pass |
| status text | `--status-recovering` | `--surface-overlay` | #086a93 on #fffdf6 | 5.91:1 | 4.5:1 | pass |
| status text | `--status-request` | `--surface-overlay` | #086a93 on #fffdf6 | 5.91:1 | 4.5:1 | pass |
| status text | `--danger` | `--surface-overlay` | #b93d10 on #fffdf6 | 5.52:1 | 4.5:1 | pass |
| non-text mark | `--edge-interactive` | `--surface-overlay` | #6a6555 on #fffdf6 | 5.72:1 | 3.0:1 | pass |
| non-text mark | `--edge-focus` | `--surface-overlay` | #2b2a14 on #fffdf6 | 14.29:1 | 3.0:1 | pass |
| non-text mark | `--edge-selected` | `--surface-overlay` | #2b2a14 on #fffdf6 | 14.29:1 | 3.0:1 | pass |
| non-text mark | `--edge-error` | `--surface-overlay` | #b93d10 on #fffdf6 | 5.52:1 | 3.0:1 | pass |
| non-text mark | `--edge-overlay` | `--surface-overlay` | #aaa593 on #fffdf6 | 2.42:1 | 3.0:1 | FAIL |
| non-text mark | `--motif` | `--surface-overlay` | #474531 on #fffdf6 | 9.54:1 | 3.0:1 | pass |
| decoration | `--edge-decorative` | `--surface-overlay` | #d5cfbd on #fffdf6 | 1.53:1 | none | info |
| action | `--primary-ink` | `--primary-fill` | #14140a on #e8ff3a | 16.57:1 | 4.5:1 | pass |
| action edge | `--primary-edge` | `--surface-base` | #16140e on #f5f2e9 | 16.45:1 | 3.0:1 | pass |
| action edge | `--primary-edge` | `--surface-raised` | #16140e on #fffdf6 | 18.09:1 | 3.0:1 | pass |
| action edge | `--primary-edge` | `--surface-control` | #16140e on #ece8db | 15.02:1 | 3.0:1 | pass |
| action edge | `--primary-edge` | `--surface-overlay` | #16140e on #fffdf6 | 18.09:1 | 3.0:1 | pass |
| action | `--word-ink` | `--word-fill` | #14140a on #e8ff3a | 16.57:1 | 4.5:1 | pass |
| disabled (exempt) | `--text` | `--surface-control` | #928f85 on #ece8db | 2.64:1 | none | info |
| disabled (exempt) | `--text` | `--surface-base` | #97958d on #f5f2e9 | 2.68:1 | none | info |
