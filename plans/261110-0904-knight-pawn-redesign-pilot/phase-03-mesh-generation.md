---
title: "Phase 3: Mesh generation"
status: done
priority: P1
effort: 1.5h
dependencies: [2]
---

> As built (2026-11-10)
>
> - Provider: Hyper3D through its own MCP server (OAuth, Creator plan), tool `rodin_generate`, tier Gen-2.5-Medium. The Blender add-on route (`generate_3d`) kept returning `API_NO_ACTIVE_SUBSCRIPTION`, so each file was downloaded and imported into `WS/pilot.blend` by hand. The session had no Hyper3D tools loaded; the calls ran through a headless `claude -p` run limited to the Hyper3D tools.
> - Only 2 generations were started (pawn-ref-a, knight-ref-a). Both passed all four checks, so the two B candidates and Task 3.4 were skipped to save credits. The user chose `Cand_pawn_1` and `Cand_knight_1`.
> - `candidate-pawn-1.png` and `candidate-knight-1.png` are the four-view pictures from `look`, not the Workbench renders of Task 3.3.
> - The chosen files are the downloaded GLBs copied to `WS/candidates/<piece>-chosen.glb` (500,000 triangles and 2048 px textures each).

# Phase 3: Mesh generation

## Goal

The user has picked one generated 3D mesh for the pawn and one for the knight, each saved as its own file, using at most 6 `generate_3d` calls.

`PLAN` means `plans/261110-0904-knight-pawn-redesign-pilot`. `WS` means `.tools/piece-redesign`. `ROOT` means the absolute worktree path `/Volumes/2/wizard-chess-3d/.claude/worktrees/redesign-3d-chess-pieces-bf8f22`. Blender tools need absolute paths.

## Files to Create / Modify

- Create (scratch): `WS/pilot.blend`, `WS/candidates/pawn-chosen.glb`, `WS/candidates/knight-chosen.glb`, `WS/generation-log.md`
- Create: `PLAN/visuals/candidate-<piece>-<n>.png`

## Rules for this phase

- Count every `generate_3d` call that starts a new generation in `WS/generation-log.md` (one line each: number, piece, reference image, provider, quality, result). Resuming a pending job with `job=` does not count.
- Hard limit: 6 new generations. Never start a 7th. If the limit is reached without an accepted mesh for both pieces, stop and report to the user.
- Use one provider for every call. Do not mix providers.
- Pass the user's original request text as `user_prompt` on every Blender tool call: `tôi cần thiết kế lại các quân cờ trong game`.

## Tasks & Steps

### Task 3.1 — Pick the provider and start a clean scene

- **Goal:** one provider is fixed for the pilot and the scene is empty.
- **Steps:**
  1. Call `get_addon_status`. Read the `generators` list.
  2. Pick the first provider that is switched on, in this order: `hunyuan3d`, `tripo`, `hyper3d`, `meshy`. Write the choice as the first line of `WS/generation-log.md`, in the form `provider: <name>`. Generation lines start with their call number; no other line may start with a digit.
  3. Call `execute_blender_code` with:
     ```python
     import bpy
     bpy.ops.wm.read_homefile(use_empty=True)  # not read_factory_settings: that resets preferences and can drop the MCP add-on
     bpy.ops.wm.save_as_mainfile(filepath="ROOT/.tools/piece-redesign/pilot.blend")
     print("SAVED", bpy.data.filepath)
     ```
     (replace `ROOT` with the absolute path).
- **Verify:** the tool output contains `SAVED` followed by the `pilot.blend` path. If no generator is switched on, that is a failed Verify: report it to the user with the Premium link from the tool output.

### Task 3.2 — Generate two candidates per piece

- **Goal:** four candidate meshes in the scene (calls 1 to 4).
- **Steps:** for each row below, call `generate_3d` with `image` set to the absolute path, `name` as given, `provider` as chosen, and no `quality` argument. If the call returns a job handle, call `generate_3d(job=<handle>, name=<same name>)` again until the object is imported. After each import, run `bpy.ops.wm.save_mainfile()` through `execute_blender_code`.

  | Call | name | image |
  |---|---|---|
  | 1 | `Cand_pawn_1` | `ROOT/PLAN/visuals/pawn-ref-a.png` |
  | 2 | `Cand_pawn_2` | `ROOT/PLAN/visuals/pawn-ref-b.png` |
  | 3 | `Cand_knight_1` | `ROOT/PLAN/visuals/knight-ref-a.png` |
  | 4 | `Cand_knight_2` | `ROOT/PLAN/visuals/knight-ref-b.png` |

  After all four: move the objects apart so they do not overlap, with `execute_blender_code` (set `location.x` to 0, 3, 6, 9 for the four root objects in table order), then save.
- **Success criteria:** four objects named as in the table.
- **Verify:** `get_scene_info` with `query="Cand_"` lists 4 objects, and `WS/generation-log.md` has 4 generation lines.

### Task 3.3 — Review the candidates

- **Goal:** each candidate has a four-view picture and a written check result.
- **Steps, for each candidate:**
  1. Call `look` with `mode="angles"`, `target=["<name>"]`, `views=["front","right","back","three_quarter"]`, `shading="material"`, `max_size=1024`.
  2. Save the same views for the user. Call `execute_blender_code` with this script, replacing `NAME` and `OUT` (absolute path `ROOT/PLAN/visuals/candidate-<piece>-<n>.png`):
     ```python
     import bpy, math, mathutils
     obj = bpy.data.objects["NAME"]
     objs = [obj] + list(obj.children_recursive)
     pts = [o.matrix_world @ mathutils.Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
     lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
     hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
     centre, size = (lo + hi) / 2, max(hi - lo)
     cam_data = bpy.data.cameras.new("ShotCam"); cam = bpy.data.objects.new("ShotCam", cam_data)
     cam_data.clip_start = size * 0.01; cam_data.clip_end = size * 20  # generated scale is arbitrary
     bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
     scene = bpy.context.scene
     try:
         scene.render.engine = "BLENDER_WORKBENCH"
     except TypeError as e:
         print("ENGINE_ERROR", e)
     scene.render.resolution_x = 640; scene.render.resolution_y = 640
     scene.display.shading.color_type = "TEXTURE"
     others = [o for o in scene.objects if o.type == "MESH" and o not in objs]
     for o in others: o.hide_render = True
     paths = []
     for i, ang in enumerate((0, 90, 180, 315)):
         a = math.radians(ang)
         cam.location = centre + mathutils.Vector((math.sin(a), -math.cos(a), 0.35)) * size * 2.2
         cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
         scene.render.filepath = "OUT".replace(".png", f"-{i}.png")
         bpy.ops.render.render(write_still=True); paths.append(scene.render.filepath)
     for o in others: o.hide_render = False
     bpy.data.objects.remove(cam)
     print("SHOTS", paths)
     ```
  3. Join the four files: `magick <OUT base>-0.png <OUT base>-1.png <OUT base>-2.png <OUT base>-3.png +append PLAN/visuals/candidate-<piece>-<n>.png`, then delete the four `-0..-3` files.
  4. Call `get_scene_info` with `query="<name>"` and `fields=["size","details","topology"]`. Note the face count.
  5. Write one line per candidate in `WS/generation-log.md` answering each with yes or no: (a) the whole figure is present, nothing cut off; (b) the chess cue is clear (pawn: domed helmet and shield; knight: arched neck and horse head); (c) no large floating pieces; (d) the design matches the reference image.
- **Success criteria:** four contact images and four check lines.
- **Verify:** `ls PLAN/visuals/candidate-*.png | wc -l` prints `4`. If the script prints `ENGINE_ERROR` or raises, that is a failed Verify.

### Task 3.4 — Optional third candidate (calls 5 and 6)

- **Goal:** a better option for a piece whose two candidates both failed a check in Task 3.3.
- **Steps:** only for a piece where neither candidate has four "yes" answers: call `generate_3d` once more for that piece with the reference image whose candidate scored better, `name` `Cand_<piece>_3`, and `quality="high"`. Then repeat Task 3.3 for the new object. At most one extra call per piece.
- **Verify:** `grep -c "^[0-9]" WS/generation-log.md` (generation lines) is at most `6`. If Task 3.4 is skipped for both pieces, write `3.4 skipped` in the log; no other verification needed.

### Task 3.5 — User gate: choose the meshes

- **Goal:** the user picks one candidate per piece.
- **Steps:**
  1. Send the user every `PLAN/visuals/candidate-*.png` plus the check lines from the log. Tell them the candidates are also open in their Blender scene.
  2. Ask: "Which candidate for the pawn, and which for the knight?" Wait for the answer.
  3. If the user rejects all candidates for a piece, stop the phase and report how many of the 6 calls are used. Do not generate more without the user's approval in chat.
- **Verify:** the user names one candidate per piece in chat.

### Task 3.6 — Save the chosen meshes

- **Goal:** each chosen mesh is its own file with its texture.
- **Steps:** for each chosen object, call `execute_blender_code` (replace `NAME`, `OUT` with `ROOT/.tools/piece-redesign/candidates/<piece>-chosen.glb`):
  ```python
  import bpy
  bpy.ops.object.select_all(action="DESELECT")
  obj = bpy.data.objects["NAME"]
  for o in [obj] + list(obj.children_recursive):
      o.select_set(True)
  bpy.context.view_layer.objects.active = obj
  bpy.ops.export_scene.gltf(filepath="OUT", use_selection=True, export_format="GLB", export_yup=True)
  bpy.ops.wm.save_mainfile()
  print("EXPORTED", "OUT")
  ```
- **Verify:** `ls -l WS/candidates/pawn-chosen.glb WS/candidates/knight-chosen.glb` lists both files, each larger than 100000 bytes.

## Verification

- `grep -c "^[0-9]" WS/generation-log.md` prints a number from `4` to `6`.
- Both `*-chosen.glb` files exist.

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
