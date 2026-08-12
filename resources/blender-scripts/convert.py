# SPDX-License-Identifier: GPL-3.0-or-later
#
# Pulse Convert headless Sollumz automation script.
#
# This file runs *inside* Blender's Python interpreter and calls Sollumz's registered
# operators (bpy.ops.sollumz.*) directly - that makes it a combined work with Sollumz
# (GPL-3.0) at runtime, so it is released under GPL-3.0-or-later itself. The rest of Pulse
# Convert (the Next.js web app, the job queue, the Rust RPF tool) is a separate process invoked
# at arm's length and is not GPL - see the project plan for the licensing reasoning.
#
# VERIFIED end-to-end during the Phase 0 spike (Blender 5.1.2 + Sollumz 2.8.3, Windows): a real
# binary .ydr round-tripped through import_directory() -> export_directory() correctly,
# producing valid gen8 + gen9 output with its embedded texture intact. Concrete findings from
# that run, baked into this script:
#   - Sollumz requires a separate PyPI dependency (`szio`, MIT, published by the Sollumz org)
#     before bpy.ops.sollumz.import_assets/export_assets actually register - without it the
#     operator exists by name but Blender's RNA system never registers the class, and calling it
#     raises "could not be found". Setting the CI=1 environment variable before launching
#     Blender makes Sollumz's own addon init auto-install szio (and the optional, Windows-only,
#     separately-licensed `pymateria` accelerator) on first run - this MUST be set in the
#     worker container's environment. See dependencies.py's mount_dependencies()/CI check in
#     Sollumz's own source for why this works.
#   - As a Blender Extension (not a legacy addon), Sollumz registers under a namespaced module
#     name like "bl_ext.user_default.sollumz", not bare "Sollumz" - enable_sollumz() below
#     matches on that.
#   - export_assets with no extra settings produces BOTH gen8 (legacy FiveM) and gen9 (FiveM
#     Enhanced) output by default, each as a binary file plus a CodeWalker-style XML sidecar.
#     FiveM resources in this project only need gen8 - restricting export to one target version
#     is a real Phase 2 follow-up (see ExportSettingsBase.target_versions in Sollumz's source).
#   - A standalone .ytd never imports via the generic operator ("Unsupported file format"),
#     REGARDLESS of whether a .yft referencing it is present in the same batch - confirmed
#     against a real downloaded vehicle mod, not just an orphan-file test. Root cause confirmed
#     two ways: (1) Sollumz's _import_asset dispatch has no case for a texture dictionary; (2)
#     reading szio's own AssetType enum shows it has no TEXTURE_DICTIONARY member at all. Going
#     further: Sollumz's *export* side has no YTD category either (an earlier read of
#     `sz_export_types` including "YTD" turned out to be from GitHub's main branch, not the
#     installed v2.8.3 release - a real trap with this dependency, watch for "main vs release"
#     mismatches). So a standalone .ytd is a dead end for Blender/Sollumz on BOTH ends - this
#     script no longer tries to touch them at all. See native/rpf-tool's `ytd-optimize`
#     subcommand instead, which patches a .ytd directly in Rust, independent of Blender
#     entirely (called from the Node worker, before this script ever runs).
#
# TEXTURE OPTIMIZATION:
#   - Embedded textures (packed directly inside a .yft/.ydr, the less common case for real
#     vehicles): handled here. Tried resizing via Blender's own Image API before export first -
#     verified that does nothing, since Sollumz's exporter embeds a texture's raw DDS bytes
#     verbatim from `image.packed_file.data`/`image.filepath`, never from Blender's decoded
#     pixel buffer. Real fix: decode/resize/re-encode the DDS bytes externally
#     (native/rpf-tool's `dds-resize` subcommand), write a new file, point the Blender Image at
#     it via `image.unpack(method='REMOVE')` + `image.filepath = new_path`. Verified (hash
#     comparison against a control export) that Sollumz's export then embeds the swapped bytes.
#   - External .ytd (the common case for real vehicles): NOT handled here at all anymore -
#     native/rpf-tool's `ytd-optimize` patches the .ytd file directly and completely
#     independently of Blender/Sollumz, since neither can import nor export one. See that
#     subcommand's own module docs (ytd_patch.rs) for how.
#
# Usage (headless):
#   CI=1 blender --background --factory-startup --python convert.py -- \
#     --input /path/to/extracted/files --output /path/to/export/dir --rpf-tool-path /path/to/rpf-tool
#
# --factory-startup disables user addons by default, including Sollumz - it must be
# re-enabled explicitly in-script (see enable_sollumz() below) rather than relying on whatever
# addon state happens to be saved in the worker container's Blender profile.

import sys
import argparse
import subprocess
import tempfile
from pathlib import Path

import bpy

# Blender doesn't reliably add the running script's own directory to sys.path (confirmed: it
# depends on the working directory Blender was launched from, not the --python path) - insert it
# explicitly so the sibling generate_hull.py module can be imported regardless of cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_hull import fix_missing_collisions  # noqa: E402

SUPPORTED_IMPORT_EXTENSIONS = {".yft", ".ytd", ".ydr", ".ydd", ".ybn", ".ycd"}


def parse_args():
    # Blender swallows its own CLI args; anything after a bare `--` is ours.
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Directory containing extracted .yft/.ytd/etc files")
    parser.add_argument("--output", required=True, help="Directory to export converted files into")
    parser.add_argument(
        "--max-texture-size", type=int, default=1024,
        help="Downscale any texture wider or taller than this (FiveM's practical cap is ~1024 for diffuse). 0 disables resizing.",
    )
    parser.add_argument("--rpf-tool-path", default=None, help="Path to the compiled rpf-tool binary (needed for texture resizing)")
    parser.add_argument(
        "--export-preview-glb", default=None,
        help="If set, also export the current scene as a single GLB (for the web preview viewer) after the FiveM steps below run",
    )
    parser.add_argument(
        "--skip-native-export", action="store_true",
        help="Skip the FiveM NATIVE/CWXML export (export_directory) entirely - for a preview-only pass that must never touch the actual converted resource",
    )
    return parser.parse_args(argv)


def enable_sollumz():
    # VERIFIED by running this against a real Blender 5.1 + Sollumz 2.8.3 install: as a Blender
    # Extension (the packaging format Sollumz ships in since it bundles a blender_manifest.toml),
    # the registered module name is namespaced as "bl_ext.<repo>.sollumz" (e.g.
    # "bl_ext.user_default.sollumz"), NOT the bare "Sollumz" name a legacy addon would use.
    # --factory-startup disables it regardless of which form is installed, so it must be
    # re-enabled here either way.
    addons = bpy.context.preferences.addons
    existing = next((name for name in addons.keys() if name == "Sollumz" or name.endswith(".sollumz")), None)
    if existing:
        return
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.sollumz")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block_collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.images):
        for block in list(block_collection):
            if block.users == 0:
                block_collection.remove(block)


def import_directory(input_dir: Path):
    # .ytd is excluded here - Sollumz's generic importer has no working path for a standalone
    # texture dictionary at all (see the module docstring), so passing one through just produces
    # a noisy "Unsupported file format" warning for no benefit. Texture optimization for the
    # external-.ytd case happens entirely outside this script now (native/rpf-tool's
    # ytd-optimize, run by the Node worker before this script is even invoked).
    filenames = [
        f.name for f in input_dir.iterdir()
        if f.is_file() and f.suffix.lower() in (SUPPORTED_IMPORT_EXTENSIONS - {".ytd"})
    ]
    if not filenames:
        raise RuntimeError(f"No importable files (.yft/.ydr/.ydd/.ybn/.ycd) found in {input_dir}")

    # ImportAssetsOperatorImpl expects a trailing slash on `directory` (standard Blender
    # file-select convention) and `files` as a collection of {"name": filename} dicts.
    bpy.ops.sollumz.import_assets(
        directory=str(input_dir) + "/",
        files=[{"name": name} for name in filenames],
    )


def _extract_dds_bytes(image) -> bytes | None:
    packed = image.packed_file
    if packed and packed.data:
        return bytes(packed.data)
    if image.filepath:
        path = Path(bpy.path.abspath(image.filepath))
        if path.is_file():
            return path.read_bytes()
    return None


def downscale_oversized_textures(max_size: int, rpf_tool_path: str | None) -> list[str]:
    """Shrinks any texture wider or taller than max_size by decoding/resizing/re-encoding its
    DDS bytes externally (native/rpf-tool's dds-resize subcommand) and pointing the Blender
    Image at the new file - see the module docstring for why this has to happen at the byte
    level rather than through Blender's own Image.scale().
    """
    if max_size <= 0 or not rpf_tool_path:
        return []

    fix_log: list[str] = []
    tmp_dir = Path(tempfile.mkdtemp(prefix="pulseconvert_tex_"))

    for image in list(bpy.data.images):
        if image.source == "VIEWER":
            continue
        original_bytes = _extract_dds_bytes(image)
        if not original_bytes or not original_bytes.startswith(b"DDS "):
            continue

        in_path = tmp_dir / f"{image.name}_in.dds"
        out_path = tmp_dir / f"{image.name}_out.dds"
        in_path.write_bytes(original_bytes)

        result = subprocess.run(
            [rpf_tool_path, "dds-resize", str(in_path), "--out", str(out_path), "--max-size", str(max_size)],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"[convert.py] WARNING: dds-resize failed for '{image.name}': {result.stderr.strip()}")
            continue
        if "SKIPPED" in result.stdout:
            continue

        old_w, old_h = image.size[:]
        if image.packed_file:
            image.unpack(method="REMOVE")
        image.filepath = str(out_path)
        image.source = "FILE"
        image.reload()
        fix_log.append(f"Resized texture '{image.name}' from {old_w}x{old_h} to {image.size[0]}x{image.size[1]}")

    return fix_log


def export_preview_glb(glb_path: Path):
    """Exports the whole current scene as a single GLB, for the web preview viewer -
    independent of export_directory()'s FiveM-specific NATIVE/CWXML output. use_selection=False
    exports everything regardless of Blender's own selection state (import_directory leaves
    everything selected already, but this shouldn't depend on that). export_apply=True bakes
    modifiers into the exported mesh, matching what a viewer expects to just render as-is.
    """
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
    )


def export_directory(output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    # direct_export=True skips the (GUI-only) directory-picker dialog, which would otherwise
    # hang forever in --background mode waiting for a window that doesn't exist.
    # use_custom_settings + target_formats/target_versions restricts output to just the binary
    # GEN8 (legacy FiveM) format - by default Sollumz also writes GEN9 + a CWXML sidecar, which
    # this project's pipeline has no use for (verified property names: ExportSettingsBase in
    # Sollumz's sollumz_preferences.py).
    bpy.ops.sollumz.export_assets(
        directory=str(output_dir) + "/",
        direct_export=True,
        use_custom_settings=True,
        target_formats={"NATIVE"},
        target_versions={"GEN8"},
    )


def main():
    args = parse_args()
    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    enable_sollumz()
    clear_scene()
    import_directory(input_dir)
    fix_log = downscale_oversized_textures(args.max_texture_size, args.rpf_tool_path)
    fix_log += fix_missing_collisions()

    if args.export_preview_glb:
        export_preview_glb(Path(args.export_preview_glb))

    if not args.skip_native_export:
        export_directory(output_dir)

    for line in fix_log:
        print(f"[convert.py] FIX: {line}")
    if args.skip_native_export:
        print(f"[convert.py] Imported from {input_dir}, preview-only pass (no NATIVE export).")
    else:
        print(f"[convert.py] Imported from {input_dir}, exported to {output_dir}.")


if __name__ == "__main__":
    main()
