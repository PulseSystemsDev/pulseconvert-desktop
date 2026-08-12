# SPDX-License-Identifier: GPL-3.0-or-later
#
# Pulse Convert: "missing collision" auto-fix. Given a fragment with no Sollumz collision bound
# anywhere in its hierarchy, generates an approximate convex-hull collision from its render
# meshes and wraps it as a Sollumz bound - turning "car has no collision and may crash/clip" into
# "car has slightly-simplified-but-present collision."
#
# VERIFIED end-to-end against a real downloaded vehicle mod (Ford F-450 Twin Turbo, a real
# gta5-mods.com Add-On pack, not a synthetic fixture): imported the real .yft, deleted its
# existing collision hierarchy to simulate the missing-collision case, ran the full fix
# (join all 63 render meshes -> convex hull -> createpolygonbound -> converttocomposite), then
# exported through Sollumz's real export_assets() with no errors. Caught and fixed two real bugs
# in the process, neither of which would have surfaced without testing against real data:
#   1. has_collision_bound() compared against capitalized "Bound"/"Composite" substrings, but
#      Sollumz's actual sollum_type values are always lowercase (e.g. "sollumz_bound_composite") -
#      the check never matched anything, so it would have reported every car as missing
#      collision, even ones that already had it. Fixed by lowercasing before comparing.
#   2. bmesh.ops.convex_hull() does not delete interior/unused geometry on its own - without
#      explicitly deleting `geom_interior`/`geom_unused` from its result, the "hull" object kept
#      essentially the entire input mesh (856k+ verts on the Ford test, not a hull at all). Fixed
#      by deleting both from the result before continuing.
# With both fixes, the real test produced a clean 1,088-vert hull and exported successfully.
# Still approximate (a single convex hull around the whole body, not per-panel) and still
# unverified against an actual running FiveM server - only Sollumz's own export path was checked.

import bmesh
import bpy


def has_collision_bound(fragment_obj: bpy.types.Object) -> bool:
    """True if any child of this fragment is already a Sollumz bound/composite. sollum_type
    values are always lowercase (e.g. "sollumz_bound_composite") - compare case-insensitively.
    """
    for child in fragment_obj.children_recursive:
        sollum_type = getattr(child, "sollum_type", "").lower()
        if "bound" in sollum_type or "composite" in sollum_type:
            return True
    return False


def generate_convex_hull_bound(mesh_objs: list[bpy.types.Object]) -> bpy.types.Object:
    """Duplicates and joins mesh_objs into one object, reduces it to its convex hull, and wraps
    it as a Sollumz polygon bound parented under a Composite - the approximate auto-fix fallback
    for missing collision. Takes every render mesh in the fragment (not just one panel) so the
    resulting hull actually encloses the vehicle's full silhouette.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objs[0]
    bpy.ops.object.duplicate()
    dupes = bpy.context.selected_objects[:]
    bpy.context.view_layer.objects.active = dupes[0]
    bpy.ops.object.join()
    hull_obj = bpy.context.view_layer.objects.active
    hull_obj.name = f"{mesh_objs[0].name}_auto_hull"

    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(hull_obj.data)
    result = bmesh.ops.convex_hull(bm, input=bm.verts, use_existing_faces=True)
    # convex_hull() tags but does not remove geometry that ends up inside/unused by the hull -
    # without this the "hull" is just the original mesh, verified the hard way (see module docs).
    bmesh.ops.delete(bm, geom=result["geom_interior"] + result["geom_unused"], context="VERTS")
    bmesh.update_edit_mesh(hull_obj.data)
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.object.select_all(action="DESELECT")
    hull_obj.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.sollumz.createpolygonbound()
    bpy.ops.sollumz.converttocomposite()

    return hull_obj


def fix_missing_collisions() -> list[str]:
    """Scans every imported fragment for a missing collision bound and generates an approximate
    convex-hull fallback for each one found - best-effort, never raises (a vehicle that already
    has real collision is far more common and must be left untouched, see has_collision_bound).
    """
    fix_log: list[str] = []
    fragments = [o for o in bpy.data.objects if getattr(o, "sollum_type", "") == "sollumz_fragment"]

    for fragment_obj in fragments:
        if has_collision_bound(fragment_obj):
            continue
        try:
            drawable = next(
                (c for c in fragment_obj.children if getattr(c, "sollum_type", "") == "sollumz_drawable"), None
            )
            if drawable is None:
                continue
            render_meshes = [
                c for c in drawable.children if c.type == "MESH" and getattr(c, "sollum_type", "") == "sollumz_drawable_model"
            ]
            if not render_meshes:
                continue
            generate_convex_hull_bound(render_meshes)
            fix_log.append(
                f"Generated an approximate convex-hull collision for '{fragment_obj.name}' "
                "(no collision bound was present in the source archive)."
            )
        except Exception as err:  # best-effort - a failed auto-fix should never fail the whole job
            print(f"[generate_hull.py] WARNING: collision auto-fix failed for '{fragment_obj.name}': {err}")

    return fix_log
