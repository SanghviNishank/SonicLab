import { useEffect, useRef } from "react";
import * as THREE from "three";

export type SculptureMode = "idle" | "clearvoice" | "roadsonic";
const ROWS = 34, COLS = 130;

/** A frequency-landscape ribbon sculpture. Decorative: it is driven by closed-form sine terms, not by any recording.
 *  Cost control: low-power GPU hint, DPR capped, ~30 fps, paused when off-screen/hidden, single static frame under reduced motion. */
export default function SoundSculpture({ mode, reduced }: { mode: SculptureMode; reduced: boolean }) {
  const host = useRef<HTMLDivElement>(null), modeRef = useRef<SculptureMode>(mode);
  modeRef.current = mode;
  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    el.appendChild(renderer.domElement); renderer.domElement.setAttribute("aria-hidden", "true");
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50); camera.position.set(0, 2.6, 8);
    const css = getComputedStyle(document.documentElement), cyan = new THREE.Color(css.getPropertyValue("--cyan").trim() || "#22d3ee"), violet = new THREE.Color(css.getPropertyValue("--violet").trim() || "#8b7cf6"), amber = new THREE.Color(css.getPropertyValue("--amber").trim() || "#ffb020");
    const group = new THREE.Group(); scene.add(group);
    const lines: { geo: THREE.BufferGeometry; mat: THREE.LineBasicMaterial; pos: Float32Array }[] = [];
    for (let r = 0; r < ROWS; r++) {
      const pos = new Float32Array(COLS * 3), geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ color: cyan.clone().lerp(violet, r / (ROWS - 1)), transparent: true, opacity: 0.25 + 0.6 * (1 - Math.abs(r / (ROWS - 1) - 0.5) * 2) });
      group.add(new THREE.Line(geo, mat)); lines.push({ geo, mat, pos });
    }
    const update = (t: number) => {
      const m = modeRef.current;
      for (let r = 0; r < ROWS; r++) {
        const z = (r / (ROWS - 1) - 0.5) * 6, { pos, geo, mat } = lines[r];
        for (let c = 0; c < COLS; c++) {
          const x = (c / (COLS - 1) - 0.5) * 11, env = Math.exp(-(x * x) / 20);
          const y = m === "roadsonic" ? env * 0.8 * Math.sin(2.0 * x + 1.8 * Math.sin(0.35 * x + 0.6 * t - r * 0.1) - 1.1 * t)
            : env * (0.55 * Math.sin(2.2 * x - 1.2 * t + r * 0.25) + 0.25 * Math.sin(4.3 * x + 0.7 * t - r * 0.4));
          pos[c * 3] = x; pos[c * 3 + 1] = y; pos[c * 3 + 2] = z;
        }
        (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        mat.color.copy(cyan).lerp(m === "roadsonic" ? amber : violet, r / (ROWS - 1));
      }
    };
    const size = () => { const w = el.clientWidth || 600, h = el.clientHeight || 400; renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; camera.aspect = w / h; camera.updateProjectionMatrix(); };
    size(); const ro = new ResizeObserver(size); ro.observe(el);
    let tx = 0, ty = 0, raf = 0, visible = true, last = 0;
    const onMove = (e: PointerEvent) => { const b = el.getBoundingClientRect(); tx = ((e.clientX - b.left) / b.width - 0.5) * 0.5; ty = ((e.clientY - b.top) / b.height - 0.5) * 0.25; };
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; }); io.observe(el);
    if (reduced) { update(2); group.rotation.set(0.25, -0.35, 0); renderer.render(scene, camera); }
    else {
      window.addEventListener("pointermove", onMove);
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden || now - last < 33) return;
        last = now; update(now / 1000);
        group.rotation.y += (-0.35 + tx - group.rotation.y) * 0.05; group.rotation.x += (0.25 + ty - group.rotation.x) * 0.05;
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); ro.disconnect(); io.disconnect();
      lines.forEach((l) => { l.geo.dispose(); l.mat.dispose(); }); renderer.dispose(); renderer.domElement.remove();
    };
  }, [reduced]);
  return <div ref={host} className="hero-canvas" />;
}
