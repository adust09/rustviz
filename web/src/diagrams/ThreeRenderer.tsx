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
  dir: THREE.DirectionalLight;
  dirTarget: THREE.Object3D;
  picks: Map<string, THREE.Mesh>;
  /** Per-building name labels, hidden when the camera is farther than labelCull. */
  cityLabels: CSS2DObject[];
  labelCull: number;
  /** Crate dependency wires, restyled to highlight the focused crate's edges. */
  wires: Wire[];
  raf: number;
}

interface Wire {
  line: THREE.Line;
  source: string;
  target: string;
  mutual: boolean;
}

// Wire colours: depends-on (outgoing) warm, used-by (incoming) cyan, cycle red.
const WIRE_OUT = 0xffd23f;
const WIRE_IN = 0x3bd6ff;
const WIRE_CYCLE = 0xff2d55;
const WIRE_IDLE = 0x6b7a93;

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.setSize(w, h);
    labels.domElement.style.position = "absolute";
    labels.domElement.style.top = "0";
    labels.domElement.style.pointerEvents = "none";
    mount.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    // Sky/ground hemisphere + low ambient + a raking key light give the
    // buildings clear lit/shadowed faces (volume), and the key light casts
    // shadows onto the district floors.
    scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x0a0e16, 0.5));
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.bias = -0.0006;
    const dirTarget = new THREE.Object3D();
    dir.target = dirTarget;
    scene.add(dir);
    scene.add(dirTarget);

    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 4000);
    camera.position.set(30, 36, 46);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const content = new THREE.Group();
    scene.add(content);

    const ctx: Ctx = { renderer, labels, scene, camera, controls, content, dir, dirTarget, picks: new Map(), cityLabels: [], labelCull: Infinity, wires: [], raf: 0 };
    ctxRef.current = ctx;

    const loop = (): void => {
      controls.update();
      // Declutter: only show building name labels near the camera.
      for (const bl of ctx.cityLabels) {
        bl.element.style.display = camera.position.distanceTo(bl.position) < ctx.labelCull ? "" : "none";
      }
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
    ctx.picks.clear();
    ctx.cityLabels = [];
    ctx.wires = [];
    if (props.scene.kind === "structure") buildStructure(ctx.content, props.scene, ctx.picks, ctx.cityLabels, ctx.wires);
    else buildSequence(ctx.content, props.scene);
    frameCamera(ctx);
  }, [props.scene]);

  // Highlight the focused building (emissive) + the wires of its crate, without
  // a rebuild. Outgoing deps glow warm, incoming (used-by) cyan, cycles red.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (const [id, mesh] of ctx.picks) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const on = id === props.selectedId;
      mat.emissive.setHex(on ? 0x3b6cff : 0x000000);
      mat.emissiveIntensity = on ? 0.55 : 0;
    }

    const sc = props.scene;
    let focus: string | null = null;
    if (sc.kind === "structure" && props.selectedId) {
      const b = sc.boxes.find((x) => x.id === props.selectedId);
      focus = b ? b.crate : sc.crates.some((c) => c.name === props.selectedId) ? props.selectedId : null;
    }
    for (const wire of ctx.wires) styleWire(wire, focus);
  }, [props.selectedId, props.scene]);

  return <div ref={mountRef} className="three-mount" />;
}

// Pick the building/lifeline whose projected center is nearest the click. In a
// dense city of small towers this matches intent far better than a raycast
// first-hit (which clips gaps and selects a taller tower behind the target).
function pick(ctx: Ctx, mount: HTMLDivElement, ev: MouseEvent, props: RendererProps<DiagramScene>): void {
  const rect = mount.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  const v = new THREE.Vector3();
  let best: string | null = null;
  let bestD = Infinity;
  for (const [id, mesh] of ctx.picks) {
    const geo = mesh.geometry as THREE.BoxGeometry;
    const topY = (geo.parameters?.height ?? 0) / 2;
    for (const oy of [0, topY]) {
      v.set(mesh.position.x, mesh.position.y + oy, mesh.position.z).project(ctx.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
  }
  if (best === null || bestD > 80) return;
  props.onSelect(best);
  // Lifeline click re-roots the sequence; building click just selects.
  if (props.scene.kind === "sequence") props.onDrillToSequence?.(best);
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
  // Building labels appear once the camera is within ~half the scene radius.
  ctx.labelCull = radius * 0.55;

  // Aim the key light + its shadow frustum at the scene so shadows cover it.
  ctx.dir.position.set(center.x + radius * 0.85, center.y + radius * 1.7, center.z + radius * 0.95);
  ctx.dirTarget.position.copy(center);
  ctx.dirTarget.updateMatrixWorld();
  const sc = ctx.dir.shadow.camera;
  const s = radius * 1.4;
  sc.left = -s;
  sc.right = s;
  sc.top = s;
  sc.bottom = -s;
  sc.near = radius * 0.1;
  sc.far = radius * 6;
  sc.updateProjectionMatrix();
}

// 3D structure = a "code city": the ground plane is partitioned into role zones
// (X) × dependency-layer bands (Z); each type is a building (height ∝ members),
// elevated by its dependency layer (Y). Crate is shown by colour; crate
// dependency wires connect crate centroids.
const FLOOR = 16;
const MAX_BUILDING = 13;

// Wires are shown only for the focused crate: outgoing (depends-on) warm,
// incoming (used-by) cyan, cycle red; everything else is hidden to avoid the
// scattered-crate clutter.
function styleWire(wire: Wire, focus: string | null): void {
  const related = focus !== null && (wire.source === focus || wire.target === focus);
  wire.line.visible = related;
  if (!related) return;
  const mat = wire.line.material as THREE.LineBasicMaterial;
  const out = wire.source === focus;
  mat.color.setHex(wire.mutual ? WIRE_CYCLE : out ? WIRE_OUT : WIRE_IN);
  mat.opacity = 0.95;
}

function buildStructure(root: THREE.Group, scene: StructureScene, picks: Map<string, THREE.Mesh>, cityLabels: CSS2DObject[], wires: Wire[]): void {
  const layerY = (l: number): number => l * FLOOR;

  // Role-zone × layer cell platforms (neutral ground tiles, not pickable).
  for (const rg of scene.regions) {
    const geo = new THREE.BoxGeometry(rg.w * S, 0.5, rg.h * S);
    const mat = new THREE.MeshStandardMaterial({ color: 0x161d28, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((rg.x + rg.w / 2) * S, layerY(rg.layer), (rg.y + rg.h / 2) * S);
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  // One role label per zone, placed on its top (nearest) layer.
  const topByRole = new Map<string, (typeof scene.regions)[number]>();
  for (const rg of scene.regions) {
    const cur = topByRole.get(rg.title);
    if (!cur || rg.layer > cur.layer) topByRole.set(rg.title, rg);
  }
  for (const rg of topByRole.values()) {
    const label = makeLabel(rg.title, "three-label");
    label.position.set((rg.x + rg.w / 2) * S, layerY(rg.layer) + MAX_BUILDING + 3, (rg.y + rg.h / 2) * S);
    root.add(label);
  }

  // Buildings (one per type / module-fn box), standing on their role/layer cell.
  // Track each crate's tallest building — its landmark, used as the wire anchor
  // (the role layout scatters a crate's types, so a bbox centroid is meaningless).
  const anchor = new Map<string, { v: THREE.Vector3; members: number; isType: boolean }>();
  for (const b of scene.boxes) {
    const members = b.fields.length + b.variants.length + b.ops.length;
    // Taller-than-wide so even average types read as blocks, not tiles.
    const height = Math.min(MAX_BUILDING, 1.8 + members * 0.5);
    const side = Math.max(b.w * S * 0.5, 1.0);
    const geo = new THREE.BoxGeometry(side, height, side);
    const color = hexToColor(crateColor(b.crate, scene.crateNames));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.14 });
    const mesh = new THREE.Mesh(geo, mat);
    const cx = (b.x + b.w / 2) * S;
    const cz = (b.y + b.h / 2) * S;
    const top = layerY(b.layer) + 0.3 + height;
    mesh.position.set(cx, top - height / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = b.id;
    root.add(mesh);
    picks.set(b.id, mesh);

    // Landmark = tallest real type (struct/enum/trait), preferred over module-fn
    // boxes so wires anchor on a representative type rather than a test module.
    const isType = b.kind !== "modulefns";
    const cur = anchor.get(b.crate);
    const beats = !cur || (isType !== cur.isType ? isType : members > cur.members);
    if (beats) anchor.set(b.crate, { v: new THREE.Vector3(cx, top + 1.2, cz), members, isType });

    // Name label above the building (distance-culled in the render loop).
    const label = makeLabel(b.title.split("::").pop() ?? b.title, "three-blabel");
    label.position.set(cx, top + 0.5, cz);
    root.add(label);
    cityLabels.push(label);
  }

  // Crate dependency wires: anchored at each crate's landmark (tallest) building,
  // and hidden until a building is focused (see styleWire) to avoid clutter.
  for (const e of scene.crateEdges) {
    const a = anchor.get(e.source)?.v;
    const b = anchor.get(e.target)?.v;
    if (!a || !b) continue;
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color: WIRE_IDLE, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    root.add(line);
    wires.push({ line, source: e.source, target: e.target, mutual: e.mutual });
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
