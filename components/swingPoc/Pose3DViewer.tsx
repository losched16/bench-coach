'use client'

// Estimated 3D pose, synchronised to the video.
//
// Draws MediaPipe's world landmarks for the current frame: the model's ESTIMATE
// of where the joints are in metres around the hips, from one camera. No hip
// or torso planes, no rotation numbers — those would read as measurements and
// the depth they need is exactly what a single camera estimates worst. The
// label says so on the canvas itself, so a screenshot cannot lose it.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const EDGES: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
  [0, 11], [0, 12],
]

export default function Pose3DViewer({ world }: { world: number[][] | null }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<{ lines: THREE.LineSegments; points: THREE.Points; renderer: THREE.WebGLRenderer } | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const w = mount.clientWidth || 320
    const h = mount.clientHeight || 320
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    } catch {
      mount.textContent = 'This browser cannot draw 3D (WebGL unavailable).'
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(w, h)
    renderer.setClearColor(0x0f172a)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 50)
    camera.position.set(0, 0.2, 2.6)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 0)
    controls.update()

    const grid = new THREE.GridHelper(2, 10, 0x334155, 0x1e293b)
    grid.position.y = -0.95
    scene.add(grid)

    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(EDGES.length * 6), 3))
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x34d399 }))
    scene.add(lines)
    const ptGeo = new THREE.BufferGeometry()
    ptGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(33 * 3), 3))
    const points = new THREE.Points(ptGeo, new THREE.PointsMaterial({ color: 0xf87171, size: 0.03 }))
    scene.add(points)
    stateRef.current = { lines, points, renderer }

    let raf = 0
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      renderer.dispose()
      mount.innerHTML = ''
      stateRef.current = null
    }
  }, [])

  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const visible = !!world && world.length === 33
    st.lines.visible = visible
    st.points.visible = visible
    if (!visible) return
    // MediaPipe world: metres around the hip centre, y DOWN. Three.js: y up.
    const p = (j: number) => [world![j][0], -world![j][1], -world![j][2]]
    const lp = st.lines.geometry.getAttribute('position') as THREE.BufferAttribute
    EDGES.forEach(([a, b], i) => {
      lp.setXYZ(i * 2, ...(p(a) as [number, number, number]))
      lp.setXYZ(i * 2 + 1, ...(p(b) as [number, number, number]))
    })
    lp.needsUpdate = true
    const pp = st.points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let j = 0; j < 33; j++) pp.setXYZ(j, ...(p(j) as [number, number, number]))
    pp.needsUpdate = true
  }, [world])

  return (
    <div className="relative">
      <div ref={mountRef} className="w-full h-72 rounded-lg overflow-hidden" data-testid="pose-3d" />
      <div className="absolute top-2 left-2 right-2 text-[11px] leading-tight text-amber-200 bg-slate-900/80 rounded px-2 py-1 pointer-events-none">
        Estimated 3D pose — a single-camera model estimate, not measured 3D. Drag to orbit, scroll to zoom.
      </div>
      {!world && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 pointer-events-none">
          No pose for this frame
        </div>
      )}
    </div>
  )
}
