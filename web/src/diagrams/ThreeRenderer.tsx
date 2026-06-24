import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { crateColor } from "../lenses";
import type { DiagramScene, RendererProps, SequenceScene, StructureScene } from "./types";

// Real 3D renderer (three.js / WebGL). Rotatable / zoomable via OrbitControls.
// Structure: crate slabs on the floor, type boxes extruded upward (height ∝
// member count). Sequence: lifelines as vertical pillars, messages as arrows
// descending in time. Labels are crisp DOM via CSS2DRenderer. Default export so
// DiagramView can React.lazy() it — three.js stays out of the main bundle.

const S = 0.03; // layout-unit → world-unit scale

interface Ctx {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  raf: number;
}

function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function makeLabel(text: string, cls: string): CSS2DObject {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  return new CSS2DObject(el);
}

function disposeGroup(group: THREE.Group): void {
  for (const obj of [...group.children]) {
    group.remove(obj);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
      if (o instanceof CSS2DObject) o.element.remove();
    });
  }
}

export default function ThreeRenderer(props: RendererProps<DiagramScene>): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Mount once: renderer / camera / controls / label layer / RAF loop.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.setSize(w, h);
    labels.domElement.style.position = "absolute";
    labels.domElement.style.top = "0";
    labels.domElement.style.pointerEvents = "none";
    mount.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(20, 40, 30);
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 2000);
    camera.position.set(30, 36, 46);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const content = new THREE.Group();
    scene.add(content);

    const ctx: Ctx = { renderer, labels, scene, camera, controls, content, raf: 0 };
    ctxRef.current = ctx;

    const loop = (): void => {
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
      ctx.raf = requestAnimationFrame(loop);
    };
    ctx.raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth || w;
      const nh = mount.clientHeight || h;
      renderer.setSize(nw, nh);
      labels.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    const onClick = (ev: MouseEvent): void => pick(ctx, mount, ev, propsRef.current);
    renderer.domElement.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(ctx.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      disposeGroup(content);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labels.domElement.remove();
      ctxRef.current = null;
    };
  }, []);

  // Rebuild geometry whenever the scene changes (diagram type / focus / data).
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    disposeGroup(ctx.content);
    if (props.scene.kind === "structure") buildStructure(ctx.content, props.scene);
    else buildSequence(ctx.content, props.scene);
    frameCamera(ctx);
  }, [props.scene]);

  return <div ref={mountRef} className="three-mount" />;
}

function pick(ctx: Ctx, mount: HTMLDivElement, ev: MouseEvent, props: RendererProps<DiagramScene>): void {
  const rect = mount.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, ctx.camera);
  const hit = ray.intersectObjects(ctx.content.children, true).find((h) => h.object.userData.id);
  if (!hit) return;
  const id = hit.object.userData.id as string;
  props.onSelect(id);
  // Lifeline click re-roots the sequence; box click drills its sequence.
  if (props.scene.kind === "sequence") props.onDrillToSequence?.(id);
}

function frameCamera(ctx: Ctx): void {
  const box = new THREE.Box3().setFromObject(ctx.content);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 10;
  ctx.controls.target.copy(center);
  ctx.camera.position.set(center.x + radius * 0.7, center.y + radius * 0.8, center.z + radius * 1.2);
  ctx.camera.near = radius / 100;
  ctx.camera.far = radius * 20;
  ctx.camera.updateProjectionMatrix();
  ctx.controls.update();
}

// 3D structure = dependency layers as stacked floors, one slab per crate, with
// crate dependency edges. Coarse on purpose (crate granularity); per-member LoD
// is left to the 2D/2.5D views for now.
function buildStructure(root: THREE.Group, scene: StructureScene): void {
  const FLOOR = 14;
  const centerOf = new Map<string, THREE.Vector3>();
  for (const c of scene.crates) {
    const geo = new THREE.BoxGeometry(c.w * S, 1.2, c.h * S);
    const color = hexToColor(crateColor(c.name, scene.crateNames));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.92 });
    const mesh = new THREE.Mesh(geo, mat);
    const cx = (c.x + c.w / 2) * S;
    const cz = (c.y + c.h / 2) * S;
    const y = c.layer * FLOOR;
    mesh.position.set(cx, y, cz);
    mesh.userData.id = c.name;
    root.add(mesh);
    centerOf.set(c.name, new THREE.Vector3(cx, y, cz));
    const label = makeLabel(`${c.name} ·L${c.layer}`, "three-label");
    label.position.set(cx, y + 1.5, cz);
    root.add(label);
  }

  for (const e of scene.crateEdges) {
    const a = centerOf.get(e.source);
    const b = centerOf.get(e.target);
    if (!a || !b) continue;
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color: e.mutual ? 0xff2d55 : 0x6b7a93, transparent: true, opacity: 0.6 });
    root.add(new THREE.Line(geo, mat));
  }
}

function buildSequence(root: THREE.Group, scene: SequenceScene): void {
  const COL = 6;
  const ROW = 1.1;
  const length = Math.max(4, scene.messages.length * ROW + 2);
  const xOf = (col: number): number => col * COL;

  for (const l of scene.lifelines) {
    const x = xOf(l.col);
    const color = hexToColor(crateColor(l.crate, scene.crateNames));
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 1.4, 1.2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    );
    head.position.set(x, 0, 0);
    head.userData.id = l.id;
    root.add(head);
    const pillar = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -0.7, 0), new THREE.Vector3(x, -length, 0)]),
      new THREE.LineBasicMaterial({ color: 0x2c3647 }),
    );
    root.add(pillar);
    const label = makeLabel(l.title, "three-label");
    label.position.set(x, 1.2, 0);
    root.add(label);
  }

  const xById = new Map(scene.lifelines.map((l) => [l.id, xOf(l.col)]));
  for (const m of scene.messages) {
    const fx = xById.get(m.fromId);
    const tx = xById.get(m.toId);
    if (fx === undefined || tx === undefined) continue;
    const y = -1.6 - m.row * ROW;
    const from = new THREE.Vector3(fx, y, 0);
    const to = new THREE.Vector3(m.selfCall ? fx + 1.6 : tx, y, 0);
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color: 0x9aa6b6 })));
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length() || 1;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0x9aa6b6 }));
    cone.position.copy(to);
    cone.rotation.z = dir.x >= 0 ? -Math.PI / 2 : Math.PI / 2;
    cone.scale.setScalar(len > 0.5 ? 1 : 0.6);
    root.add(cone);
  }
}
