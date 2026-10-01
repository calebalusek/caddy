// Thick-solid with sharp (intersecting) corners: the engine's default rounds convex corners when the walls grow outward.
import { cast, getOC, isShape3D, type Face, type Shape3D } from 'replicad';

/** Hollow a solid with the given faces left open. thickness > 0 grows the walls inward from the surface; < 0 outward. */
export function thickSolid(shape: Shape3D, open: Face[], thickness: number): Shape3D {
  const oc = getOC();
  const list = new oc.NCollection_List_TopoDS_Shape();
  open.forEach((f) => list.Append(f.wrapped));
  const b = new oc.BRepOffsetAPI_MakeThickSolid();
  try {
    b.MakeThickSolidByJoin(shape.wrapped, list, -thickness, 0.001, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    const out = cast(b.Shape());
    if (!isShape3D(out)) throw new Error('could not shell');
    return out;
  } finally { b.delete(); list.delete(); }
}
