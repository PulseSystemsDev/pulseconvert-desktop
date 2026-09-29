import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, RotateCcw, Shield } from 'lucide-react';
import { pc } from '../lib/bridge';
import { preparePreview } from './previewScene';
import { Spinner } from './ui';

export default function ModelViewer({ source }: { source: { kind: 'job' | 'vehicle'; id: string } }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const collisionRef = useRef<THREE.Object3D[]>([]);
  const [hasCollision, setHasCollision] = useState(false);
  const [showCollision, setShowCollision] = useState(false);

  useEffect(() => {
    for (const node of collisionRef.current) node.visible = showCollision;
  }, [showCollision, hasCollision]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError('3D preview needs WebGL, which is not available on this computer.');
      setState('error');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1f2a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9a5c, 0.8);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;

    let frame = 0;
    const render = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    void (async () => {
      const result = await pc.fetchPreview(source);
      if (disposed) return;
      if (!result.ok) {
        setError(result.error);
        setState('error');
        return;
      }
      new GLTFLoader().parse(
        result.data,
        '',
        (gltf) => {
          if (disposed) return;
          const model = gltf.scene;
          scene.add(model);
          const { box, collision } = preparePreview(model);
          collisionRef.current = collision;
          setHasCollision(collision.length > 0);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          const radius = Math.max(size.x, size.y, size.z) || 1;
          resetRef.current = () => {
            camera.position.set(radius * 1.35, radius * 0.6, radius * 1.35);
            camera.near = radius / 100;
            camera.far = radius * 50;
            camera.updateProjectionMatrix();
            controls.target.set(0, 0, 0);
            controls.update();
          };
          resetRef.current();
          setState('ready');
          render();
        },
        (err) => {
          if (disposed) return;
          setError((err as unknown as Error)?.message || 'This preview could not be read.');
          setState('error');
        },
      );
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [source.kind, source.id]);

  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-border-subtle bg-[radial-gradient(ellipse_at_center,#172131_0%,#080b12_75%)]">
      <div ref={hostRef} className="absolute inset-0" />
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-slate-400">
          <Spinner /> Loading 3D preview
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-slate-500">
          <Box className="h-5 w-5" />
          {error ?? 'No 3D preview is available.'}
        </div>
      )}
      {state === 'ready' && (
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          {hasCollision && (
            <button
              onClick={() => setShowCollision((value) => !value)}
              aria-pressed={showCollision}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${showCollision ? 'border-accent-orange/60 bg-accent-orange/15 text-accent-orange' : 'border-border bg-bg-base/80 text-slate-300 hover:text-white'}`}
            >
              <Shield className="h-3 w-3" /> Collision
            </button>
          )}
          <button
            onClick={() => resetRef.current()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-bg-base/80 px-2 py-1 text-[11px] text-slate-300 hover:text-white"
          >
            <RotateCcw className="h-3 w-3" /> Reset view
          </button>
        </div>
      )}
    </div>
  );
}
