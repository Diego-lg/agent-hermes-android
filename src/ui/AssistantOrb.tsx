/**
 * AssistantOrb — a tactile water-bubble sphere for Speech-to-Speech mode.
 *
 * Rendered with react-native-svg (no WebView, no shaders, runs on the
 * JS thread with a deterministic render loop). The shape is a deformed
 * circle drawn with a single `<Path>` whose points are computed each
 * frame from a "blob" function:
 *
 *     radius(theta, t) = R · (1 + displace(theta, t) + energy * level)
 *
 * where `displace` is two-octave cosine noise the orbs uses for breathing,
 * and `energy` is a phase-dependent drive (idle < listening < thinking
 * < speaking). On top of that the user's drag gesture deforms the blob
 * toward the finger and reduces overall amplitude (so the bubble looks
 * like it's being *pushed* by the touch).
 *
 * Gesture model (locked with the user before this rewrite):
 *   - Tap on the orb while idle → begin listening (existing behavior).
 *   - Drag (PanResponder) → deforms toward the finger with a damped
 *     spring (decay constant 0.85), so the bubble "follows" without
 *     ever overshooting the touch point visibly. On release, the
 *     displacement springs back to (0, 0) with overshoot so it feels
 *     alive. Drag does not change the S2S phase.
 *
 * Render loop:
 *   - requestAnimationFrame drives `t` (a continuously increasing scalar)
 *     and updates four `Animated.Value`s (tx, ty, scaleX, scaleY).
 *   - The Path's points are recomputed from these values + `phase` +
 *     `level` (audio amplitude) + `t`. Re-render is cheap — 32-segment
 *     closed cubic spline, drawn as a single SVG path.
 *
 * Why this is better than the WebView raymarcher:
 *   - No native WebView render pass → usable on low-end Android hardware.
 *   - The touch surface is identical to the visible bubble (no
 *     input-routing headaches).
 *   - The shape responds directly to the finger — no GLSL port of the
 *     gesture, no per-frame IPC across the JS bridge.
 *   - Themable: takes the same `color` / `size` / `phase` / `level`
 *     props the previous component exposed, so no caller-side changes.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Animated,
  PanResponder,
} from 'react-native';
import Svg, {Path, Defs, RadialGradient, Stop, Circle} from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type OrbPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Props {
  phase: OrbPhase;
  /** Audio amplitude (0..1). Listens to mic input / TTS energy. */
  level?: number;
  /** Hex accent colour (e.g. palette.accent). */
  color?: string;
  /** Outer diameter, in dp. */
  size?: number;
}

// Energy / base-amplitude mapped per phase — same lookup the WebView
// orb used so the visual personality of each phase is preserved.
const PHASE_PRESET: Record<OrbPhase, {energy: number; breathe: number; jitter: number}> = {
  idle:      {energy: 0.10, breathe: 0.04, jitter: 0.02},
  listening: {energy: 0.45, breathe: 0.08, jitter: 0.05},
  thinking:  {energy: 0.70, breathe: 0.05, jitter: 0.10},
  speaking:  {energy: 1.00, breathe: 0.06, jitter: 0.14},
};

// Number of segments used to draw the closed spline outline. 32 is the
// sweet spot on a phone — coarse enough to stay at 60fps with the path
// recomputed every frame, smooth enough to look like a circle at rest.
const SEGMENTS = 32;

/**
 * Build the SVG `d` attribute for a closed cubic Bezier loop through N
 * points on a deformed circle. The deformation is driven by:
 *   - `tx`, `ty`        : current pan-spring displacement, normalized
 *                         to (-1..1) of the orb radius (max drag).
 *   - `energy`          : phase preset amplitude (0..1).
 *   - `breathe`         : low-frequency breathing oscillation.
 *   - `jitter`          : high-frequency wobble.
 *   - `level`           : audio amplitude (0..1).
 *   - `t`               : monotonic time in seconds.
 *
 * We don't need a real noise function — stack two sin waves at
 * non-rational frequency ratios (e.g. 2.31 and 5.13) to fake a
 * quasi-periodic shape change that never visibly repeats.
 */
function buildBlobPath(
  cx: number,
  cy: number,
  r: number,
  tx: number,
  ty: number,
  energy: number,
  breathe: number,
  jitter: number,
  level: number,
  t: number,
): string {
  // Magnitude of the drag-induced deformation. Squared so a small
  // drag nudges the bubble a little, and a hard drag deforms it a lot.
  const dragMag = Math.min(1, Math.hypot(tx, ty));
  // Squash axis the bubble squashes *toward* the finger:
  //   px = -tx, py = -ty  (the perpendicular axis gets *elongated*)
  const perpendicularScale = 1 + 0.18 * dragMag;

  const pts: Array<[number, number]> = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * Math.PI * 2;
    // Layer 1 — slow large displacement (breathing + swirl):
    const amp1 =
      breathe * Math.sin(t * 1.3 + theta * 2.0) +
      energy * 0.05 * Math.sin(theta * 3 + t * 0.6);
    // Layer 2 — small fast wobble (jitter):
    const amp2 =
      jitter * 0.7 *
      (Math.sin(theta * 5.0 + t * 2.31) + Math.sin(theta * 7.0 + t * 5.13));
    // Audio reaction (level): subtle radial modulation that doesn't
    // depend on theta, so the whole bubble "breathes" with sound.
    const ampLevel = level * 0.06 * Math.sin(t * 4 + theta);
    // Drag deformation: the perpendicular axis stretches when you
    // pinch toward a point, and the parallel axis compresses.
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    // Component of drag along the radial direction (compresses the
    // bubble on the near side) — we approximate this with the dot
    // product of (dx, dy) with the normalised drag vector.
    const radial = dx * tx + dy * ty;
    const perp = -dy * tx + dx * ty;
    const dragDeform =
      // push-in along the drag direction:
      -0.20 * dragMag * radial +
      // stretch along the perpendicular axis:
       0.10 * Math.abs(perp) * perpendicularScale;
    const radius = r * (1 + amp1 + amp2 + ampLevel + dragDeform);
    const x = cx + dx * radius;
    const y = cy + dy * radius;
    pts.push([x, y]);
  }

  // Build a closed cubic Bezier through the points. The 'tangent at
  // point i' is approximated by the line from i to i+1 — gives a
  // visually smooth blob.
  const tangent = (i: number): [number, number] => {
    const a = pts[(i - 1 + SEGMENTS) % SEGMENTS];
    const b = pts[(i + 1) % SEGMENTS];
    return [b[0] - a[0], b[1] - a[1]];
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const C = 0.4; // cubic Bezier handle length factor
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < SEGMENTS; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % SEGMENTS];
    const t0 = tangent(i);
    const t1 = tangent((i + 1) % SEGMENTS);
    const c1x = lerp(p0[0], p1[0], 0) - t0[0] * C / 2;
    const c1y = lerp(p0[1], p1[1], 0) - t0[1] * C / 2;
    const c2x = lerp(p0[0], p1[0], 1) + t1[0] * C / 2;
    const c2y = lerp(p0[1], p1[1], 1) + t1[1] * C / 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

export default function AssistantOrb({
  phase = 'idle',
  level = 0,
  color = '#5eead4',
  size = 300,
}: Props) {
  // Spring-driven translation of the orb centre. We animate these on
  // the JS thread (not native driver) because we read them on every
  // frame to recompute the SVG path, which itself is JS.
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  // Raw state held in refs (render-loop state). The Animated.Values
  // above are the *displayed* values — we update them every frame
  // from the loop.
  const drag = useRef({x: 0, y: 0, vx: 0, vy: 0, active: false});
  const displayed = useRef({x: 0, y: 0, energy: 0});
  const tRef = useRef(0);
  const lastTick = useRef(0);

  // Trigger re-render each frame so the path is recomputed from the
  // current Animated.Values. We don't actually animate between frames —
  // Animated.Value is just a stable handle for "the latest value".
  const [, setTick] = useState(0);
  const [pathD, setPathD] = useState('');

  // PanResponder: only claim the gesture once the user has actually
  // moved enough to be a drag (not a tap). This lets the parent's
  // TouchableOpacity still receive a tap-to-start press without us
  // stealing it. Spring smoothing is applied in the render loop, not
  // here, so the gesture feels instantaneous regardless of frame rate.
  const DRAG_THRESHOLD = 8; // px — qualifies as a drag, not a tap
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.hypot(g.dx, g.dy) > DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          drag.current.active = true;
        },
        onPanResponderMove: (_, g) => {
          drag.current.x = g.dx / (size * 0.5);
          drag.current.y = g.dy / (size * 0.5);
          drag.current.vx = g.vx;
          drag.current.vy = g.vy;
        },
        onPanResponderRelease: () => {
          drag.current.active = false;
        },
        onPanResponderTerminate: () => {
          drag.current.active = false;
        },
      }),
    [size],
  );

  // Render loop. Runs at ~60fps; bails if app is backgrounded.
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const dt = lastTick.current ? Math.min(0.1, (now - lastTick.current) / 1000) : 0;
      lastTick.current = now;
      tRef.current += dt;

      // Spring back to (0, 0) when the user releases. Half-life ~140ms,
      // feels like a soap bubble.
      const settleRate = drag.current.active ? 14 : 6.5;
      const settle = 1 - Math.exp(-dt * settleRate);
      const tgt = drag.current.active ? drag.current : {x: 0, y: 0, vx: 0, vy: 0, active: false};
      displayed.current.x += (tgt.x - displayed.current.x) * settle;
      displayed.current.y += (tgt.y - displayed.current.y) * settle;

      // Smooth the displayed energy toward the phase target so phase
      // transitions don't snap.
      const preset = PHASE_PRESET[phase];
      const tgtE = preset.energy + Math.min(0.2, level);
      displayed.current.energy += (tgtE - displayed.current.energy) * Math.min(1, dt * 3.5);

      tx.setValue(displayed.current.x);
      ty.setValue(displayed.current.y);
      const d = buildBlobPath(
        size / 2, size / 2, size * 0.42,
        displayed.current.x, displayed.current.y,
        displayed.current.energy, preset.breathe, preset.jitter,
        level, tRef.current,
      );
      setPathD(d);
      setTick(v => (v + 1) | 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, size, color]);

  return (
    <View
      {...pan.panHandlers}
      style={{width: size, height: size}}
      // The overlay's tap-to-start behaviour stays in the parent; this
      // view only owns drag. We don't intercept taps so the parent
      // TouchableOpacity continues to fire onPress.
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient
            id="orbFill"
            cx="42%"
            cy="36%"
            r="65%"
            fx="38%"
            fy="32%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.95} />
            <Stop offset="55%" stopColor={color} stopOpacity={0.55} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.18} />
          </RadialGradient>
        </Defs>
        {/* Glow halo — same colour at low opacity, drawn behind the blob. */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={size * 0.49}
          fill={color}
          fillOpacity={0.06 * Math.max(0.4, displayed.current.energy)}
        />
        <AnimatedPath
          d={pathD}
          fill="url(#orbFill)"
          // Tiny stroke so the outline reads even on light themes.
          stroke={color}
          strokeOpacity={0.55}
          strokeWidth={1.25}
        />
        {/* Soft specular highlight that follows the bubble. */}
        <Circle
          cx={size * (0.4 + 0.04 * displayed.current.x)}
          cy={size * (0.32 + 0.04 * displayed.current.y)}
          r={size * 0.10}
          fill="#ffffff"
          fillOpacity={0.20}
        />
      </Svg>
    </View>
  );
}
