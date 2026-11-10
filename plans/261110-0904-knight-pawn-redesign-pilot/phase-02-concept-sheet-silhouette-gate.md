---
title: "Phase 2: Concept sheet and silhouette gate"
status: done
priority: P1
effort: 2h
dependencies: [1]
---

# Phase 2: Concept sheet and silhouette gate

## Goal

One style sheet shows all six pieces, the user can name every piece from its black silhouette at in-game size, and approved single-figure reference images for the pawn and knight exist. No 3D credits are spent in this phase.

`PLAN` means `plans/261110-0904-knight-pawn-redesign-pilot`. `WS` means `.tools/piece-redesign`.

## Files to Create / Modify

- Create (scratch): `WS/concept/sheet-prompt.txt`, `WS/concept/sheet-v<N>.png`, `WS/concept/col-*.png`, `WS/concept/{pawn,knight}-ref-{a,b}-prompt.txt`
- Create: `PLAN/visuals/concept-sheet.png`, `PLAN/visuals/silhouette-strip-120.png`, `PLAN/visuals/silhouette-strip-70.png`, `PLAN/visuals/{pawn,knight}-ref-{a,b}.png`

## Design brief (use this text; do not shorten the piece descriptions)

Write exactly this into `WS/concept/sheet-prompt.txt`:

```text
Character design sheet for a fantasy chess set called "Wizard's Chess": six enchanted marble statues of wizard-warriors that come alive on the board. Show exactly six figures standing in one horizontal row, evenly spaced, not overlapping, in this left-to-right order: PAWN, ROOK, KNIGHT, BISHOP, QUEEN, KING.

Shared style: carved ivory-white marble bodies, antique gold trim on armour edges and belts, forged steel weapons, a few small glowing amber gems. Chunky, simplified sculpted forms like a collectible game miniature: large clear shapes, no thin spikes, no loose cloth strips, no floating parts. Weapons and arms are held close to the body and point straight up or straight down. Every figure stands on the same low round stone plinth with one gold band.

Each piece must be recognisable from its black silhouette alone, using the classic chess cue on top, exaggerated about 1.3 times:
- PAWN (shortest, 62% of the king's height): a young squire in a round domed helmet like a ball, a tall kite shield held in front of the body, a short spear held upright against the shoulder. Compact and stocky.
- ROOK (72%): a living castle-tower golem. A wide cylindrical tower body with a square crenellated battlement crown, a guardian face inside an arched window, heavy fists resting on a tower shield. The widest and blockiest figure.
- KNIGHT (80%): an armoured rider on a compact warhorse. The horse's strongly arched neck and long horse head are the highest and most forward shape. The rider sits low behind the neck, lance held vertical. One front hoof raised. Body length no more than the figure's height.
- BISHOP (86%): a tall slender battle-priest in a long narrow robe, wearing a tall pointed mitre with one deep diagonal notch cut into it, holding a straight staff topped with a small orb. The narrowest figure.
- QUEEN (93%): a sorceress in a wide bell-shaped gown, wearing a tall coronet of five separate points, each tipped with a small ball. A wand held upright at her chest.
- KING (100%, tallest): a broad-shouldered wizard-king in a heavy cloak, wearing a closed crown topped with one large cross, both hands resting on the pommel of a great sword that stands point-down in front of him.

Camera: straight-on front view, raised slightly above eye level, the same for all six. Lighting: soft even studio light. Background: flat solid dark charcoal grey (#1a1a1a), no floor line, no cast shadows on the background, no vignette, no gradient. No text, no labels, no numbers, no border, no watermark.
```

## Tasks & Steps

### Task 2.1 — Generate the sheet

- **Goal:** a sheet image that satisfies the brief.
- **Steps:**
  1. Run `GLABS_API_KEY=$(security find-generic-password -s glabs -w) node scripts/glabs-image.mjs --prompt-file WS/concept/sheet-prompt.txt --aspect 21:9 --out WS/concept/sheet-v1.png`. If the server rejects `21:9`, use `16:9`.
  2. Open the image with the Read tool and check this list: exactly six figures; order pawn, rook, knight, bishop, queen, king; no overlap between neighbours; dark plain background; no text.
  3. If any item fails, run step 1 again with `sheet-v2.png`, then `sheet-v3.png`. At most three sheets in total. Changing the prompt text is not allowed here.
  4. Copy the accepted sheet to `PLAN/visuals/concept-sheet.png`.
- **Success criteria:** one accepted sheet.
- **Verify:** `ls -l PLAN/visuals/concept-sheet.png` shows a file larger than 200000 bytes. If all three sheets fail the check list, that is a failed Verify.

### Task 2.2 — Build the shuffled silhouette strips

- **Goal:** black-on-white silhouettes at in-game size, in an order the viewer does not know.
- **Steps (run from the worktree root):**
  1. `magick PLAN/visuals/concept-sheet.png -colorspace Gray -threshold 22% -negate WS/concept/sil-full.png`
  2. `magick WS/concept/sil-full.png -crop 6x1@ +repage WS/concept/col-%d.png` (creates `col-0.png` … `col-5.png`; 0 = pawn, 1 = rook, 2 = knight, 3 = bishop, 4 = queen, 5 = king).
  3. `magick WS/concept/col-3.png WS/concept/col-0.png WS/concept/col-5.png WS/concept/col-2.png WS/concept/col-4.png WS/concept/col-1.png +append -resize x120 PLAN/visuals/silhouette-strip-120.png`
  4. `magick PLAN/visuals/silhouette-strip-120.png -resize x70 PLAN/visuals/silhouette-strip-70.png`
  5. Open `silhouette-strip-120.png` with the Read tool. Each of the six cells must show one solid black figure on white, and no figure may touch the left or right edge of its cell (a figure cut by the equal six-column crop is a failed Verify: generate the next sheet version in Task 2.1). If a cell is mostly black (background not removed) or mostly empty, repeat step 1 with `-threshold 30%`, then `-threshold 15%`, and rebuild.
  6. As built: the cells were cut at the empty gaps between the figures (column projection of `sil-full.png`, done with PIL) and centred in equal-width cells, not with the equal `6x1@` crop of step 2, because the knight is wider than one sixth of the sheet. Sheet v1 was accepted; the user named six of six.
- **Success criteria:** the strip order is bishop, pawn, king, knight, queen, rook. Do not tell the user this order.
- **Verify:** `magick identify -format "%h\n" PLAN/visuals/silhouette-strip-120.png` prints `120`, and `ls WS/concept/col-*.png | wc -l` prints `6`.

### Task 2.3 — User gate: silhouette test

- **Goal:** the user confirms that all six silhouettes read correctly.
- **Steps:**
  1. Send the user `PLAN/visuals/silhouette-strip-70.png` and `PLAN/visuals/silhouette-strip-120.png` (not the colour sheet yet).
  2. Ask: "Name the six silhouettes from left to right." Wait for the answer.
  3. Correct answer: bishop, pawn, king, knight, queen, rook (Vietnamese names count: Tượng, Tốt, Vua, Mã, Hậu, Xe).
  4. If one or more is wrong and fewer than three sheets were generated in Task 2.1, generate the next sheet version, rebuild the strips and ask again.
- **Success criteria:** six of six correct.
- **Verify:** the user's answer matches the order in step 3. Three sheets used without a six-of-six answer is a failed Verify.

### Task 2.4 — Single-figure reference images

- **Goal:** two clean reference images each for the pawn and the knight, drawn from the approved sheet, ready for image-to-3D.
- **Steps:**
  1. Write `WS/concept/pawn-ref-a-prompt.txt`:
     ```text
     Using the attached character sheet as the exact design reference, draw only the PAWN (the first figure on the left: squire with round domed helmet, kite shield and upright short spear). Same design, same proportions, same ivory marble with antique gold trim, steel spear tip and small amber gems. One single figure, whole body visible from head to feet, centred, filling 80% of the image height. Remove the plinth: the figure stands on nothing. Three-quarter front view from slightly above. Soft even studio light, no strong shadows. Flat plain light grey background (#d0d0d0). No text, no other figures.
     ```
  2. Write `WS/concept/pawn-ref-b-prompt.txt`: the same text with the sentence "Three-quarter front view from slightly above." replaced by "Straight front view at eye level."
  3. Write `WS/concept/knight-ref-a-prompt.txt` and `knight-ref-b-prompt.txt` the same way, replacing the second sentence's description with: "draw only the KNIGHT (the third figure from the left: armoured rider on a compact warhorse with a strongly arched neck, lance held vertical, one front hoof raised)". For the knight, view A is "Three-quarter front view from slightly above." and view B is "Straight side view at eye level, horse facing left."
  4. Run, for each of the four prompt files: `GLABS_API_KEY=$(security find-generic-password -s glabs -w) node scripts/glabs-image.mjs --prompt-file WS/concept/<name>-prompt.txt --ref PLAN/visuals/concept-sheet.png --aspect 1:1 --out PLAN/visuals/<name>.png` (names: `pawn-ref-a`, `pawn-ref-b`, `knight-ref-a`, `knight-ref-b`).
  5. Open each with the Read tool. Check: one figure only; whole figure inside the frame; no plinth; plain light background; same design as the sheet. Regenerate a failing image once.
- **Success criteria:** four reference images that pass the check.
- **Verify:** `ls PLAN/visuals/pawn-ref-a.png PLAN/visuals/pawn-ref-b.png PLAN/visuals/knight-ref-a.png PLAN/visuals/knight-ref-b.png | wc -l` prints `4`. An image that still fails the check after one regeneration is a failed Verify.

### Task 2.5 — User gate: style approval

- **Goal:** the user approves the look before credits are spent.
- **Steps:**
  1. Send the user `concept-sheet.png` and the four reference images.
  2. Ask: "Approve this style for the pawn and knight, or list changes?" Wait for the answer.
  3. If the user lists changes, append them as extra sentences at the end of the affected prompt file, regenerate only the affected images, and ask again.
- **Verify:** the user answers with an approval in chat. Do not start phase 3 without it.

## Verification

- `ls PLAN/visuals/ | grep -c -E "^(concept-sheet|silhouette-strip-(70|120)|(pawn|knight)-ref-[ab])\.png$"` prints `7`.
- `grep -rnE "X-API-Key: [A-Za-z0-9_-]{20,}|GLABS_API_KEY=[A-Za-z0-9_-]{20,}" plans scripts e2e | wc -l` prints `0` (no key in tracked files).

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
