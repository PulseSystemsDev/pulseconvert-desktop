import * as THREE from 'three';

// GLTFLoader strips dots from node names; the original name is kept in userData.name.
const nodeName = (obj: THREE.Object3D) => String(obj.userData?.name ?? obj.name).toLowerCase();
const isCollisionNode = (obj: THREE.Object3D) => obj.userData?.pc_role === 'collision' || nodeName(obj).endsWith('.col');

/** Hides collision bounds (Sollumz puts them under `<name>.col`, newer previews tag them `pc_role`), at any depth. */
function hideCollision(root: THREE.Object3D): THREE.Object3D[] {
  const hidden: THREE.Object3D[] = [];
  const walk = (obj: THREE.Object3D) => {
    if (isCollisionNode(obj)) {
      obj.visible = false;
      hidden.push(obj);
      return;
    }
    for (const child of obj.children) walk(child);
  };
  walk(root);
  return hidden;
}

/** GTA shaders come through as alpha blended even when solid; keep real transparency for glass only. */
function fixMaterials(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) continue;
      const name = mat.name.toLowerCase();
      mat.side = THREE.DoubleSide;
      if (/glass|window|windscreen/.test(name)) {
        mat.transparent = true;
        mat.opacity = Math.max(mat.opacity, 0.35);
        mat.depthWrite = false;
      } else if (/decal|badge|emissive|light|cutout|alpha|sign|plate/.test(name)) {
        mat.transparent = false;
        mat.opacity = 1;
        mat.alphaTest = 0.5;
        mat.depthWrite = true;
      } else {
        mat.transparent = false;
        mat.opacity = 1;
        mat.alphaTest = 0;
        mat.depthWrite = true;
      }
      mat.needsUpdate = true;
    }
  });
}

/** Vehicles ship one wheel mesh that the game instances onto every wheel bone; copy it onto the empty ones. */
function addMissingWheels(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const wheelNodes = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (/^wheel_([lr])(f|r|m\d)$/i.test(obj.name) && !wheelNodes.has(obj.name.toLowerCase())) wheelNodes.set(obj.name.toLowerCase(), obj);
  });
  const meshesUnder = (node: THREE.Object3D) => {
    const found: THREE.Mesh[] = [];
    node.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) found.push(obj as THREE.Mesh);
    });
    return found;
  };
  const withGeometry = [...wheelNodes.entries()].filter(([, node]) => meshesUnder(node).length > 0);
  if (withGeometry.length === 0) return;

  const up = new THREE.Vector3(0, 1, 0);
  const rootInverse = root.matrixWorld.clone().invert();
  for (const [name, target] of wheelNodes) {
    if (meshesUnder(target).length > 0) continue;
    const side = name.charAt(6);
    const axle = name.slice(7);
    const [donorName, donor] =
      withGeometry.find(([n]) => n.slice(7) === axle) ?? withGeometry.find(([n]) => n.slice(7) === 'f' && axle !== 'r') ?? withGeometry[0];
    const donorPos = new THREE.Vector3().setFromMatrixPosition(donor.matrixWorld);
    const targetPos = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
    const transform = new THREE.Matrix4()
      .makeTranslation(targetPos.x, targetPos.y, targetPos.z)
      .multiply(donorName.charAt(6) !== side ? new THREE.Matrix4().makeRotationAxis(up, Math.PI) : new THREE.Matrix4())
      .multiply(new THREE.Matrix4().makeTranslation(-donorPos.x, -donorPos.y, -donorPos.z));
    for (const mesh of meshesUnder(donor)) {
      const copy = mesh.clone();
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(rootInverse).multiply(transform).multiply(mesh.matrixWorld);
      root.add(copy);
    }
  }
}

/** Readies a converted GTA model for display and returns the box of what is actually visible. */
export function preparePreview(root: THREE.Object3D): { box: THREE.Box3; collision: THREE.Object3D[] } {
  const collision = hideCollision(root);
  fixMaterials(root);
  addMissingWheels(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    let visible = true;
    for (let node: THREE.Object3D | null = obj; node; node = node.parent) if (!node.visible) visible = false;
    if (visible) box.expandByObject(obj);
  });
  if (box.isEmpty()) box.setFromObject(root);
  return { box, collision };
}
