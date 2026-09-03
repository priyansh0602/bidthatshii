'use client';

import React, { useRef, useState, useEffect, Suspense, Component } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RegionPin } from './RegionPin';
import { GlobeFallback } from './GlobeFallback';
import type { Spot } from '@/types/spot';

// ---------------------------------------------------------------------------
// WebGL support detection + renderer attribute selection
// ---------------------------------------------------------------------------

/**
 * STEP 1 — Detection: is WebGL available at all?
 *
 * Uses the absolute minimal check: plain getContext() with NO extra attributes.
 * This is the canonical detection pattern used by Modernizr, Three.js's own
 * WebGL detector, and get.webgl.org.
 *
 * Critically: we do NOT pass antialias / powerPreference / depth / stencil
 * here — those are renderer settings, not detection settings. Passing them
 * to getContext() during detection was the root cause of false negatives:
 * some drivers return null for the attributed variant even when a bare
 * getContext('webgl') would succeed just fine.
 */
function detectWebGLSupport(): boolean {
  if (typeof window === 'undefined') return true; // SSR — defer to client

  try {
    const canvas = document.createElement('canvas');
    // No attributes — purely checking API availability.
    const ctx =
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');

    if (!ctx) {
      console.warn('[Globe] detectWebGLSupport: getContext("webgl") returned null — WebGL unavailable.');
      return false;
    }

    // Release the test context immediately so GPU resources aren't held.
    const lose = (ctx as WebGLRenderingContext).getExtension('WEBGL_lose_context');
    lose?.loseContext();

    console.info('[Globe] detectWebGLSupport: WebGL confirmed available.');
    return true;
  } catch (err) {
    console.warn('[Globe] detectWebGLSupport: exception during detection:', err);
    return false;
  }
}

/**
 * STEP 2 — Renderer attrs: what settings to give to <Canvas gl={...}>?
 *
 * Deliberately uses powerPreference="default" (not "high-performance").
 * Three.js historically defaulted to "high-performance" which causes
 * context-creation failures on switchable-GPU laptops (Intel+Nvidia,
 * AMD+Nvidia) even when basic WebGL is fully available. "default" lets
 * the OS route to whichever GPU it prefers, which is always more compatible.
 *
 * antialias is still enabled here; if Canvas creation fails at runtime
 * the error boundary will catch it and show the fallback.
 */
const RELAXED_GL_ATTRS: WebGLContextAttributes = {
  antialias: true,
  powerPreference: 'default',
  alpha: true,
  depth: true,
  stencil: false,
};

// ---------------------------------------------------------------------------
// React Error Boundary — catches runtime errors thrown inside <Canvas>
// ---------------------------------------------------------------------------

interface ErrorBoundaryState { hasError: boolean }

class GlobeErrorBoundary extends Component<
  { children: React.ReactNode; onError: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('[Globe] Runtime error caught by boundary — falling back:', error.message, info.componentStack);
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Three.js scene internals
// ---------------------------------------------------------------------------

interface GlobeProps {
  spots: Spot[];
  onSelectSpot: (spot: Spot) => void;
}

function EarthMesh({
  spots,
  onSelectSpot,
  isDragging,
}: {
  spots: Spot[];
  onSelectSpot: (spot: Spot) => void;
  isDragging: boolean;
}) {
  const globeGroupRef = useRef<THREE.Group>(null);
  const texture = useTexture('/textures/earth-texture.jpg');
  const lastInteractionTime = useRef<number>(Date.now());

  useEffect(() => {
    if (isDragging) {
      lastInteractionTime.current = Date.now();
    }
  }, [isDragging]);

  useFrame((_, delta) => {
    if (!globeGroupRef.current) return;
    const timeSinceInteraction = Date.now() - lastInteractionTime.current;
    // Resume slow auto-rotation after 2 seconds of no dragging interaction
    if (!isDragging && timeSinceInteraction > 2000) {
      globeGroupRef.current.rotation.y += delta * 0.12;
    }
  });

  return (
    <group ref={globeGroupRef}>
      {/* Earth Sphere */}
      <mesh>
        <sphereGeometry args={[2, 64, 64]} />
        <meshStandardMaterial map={texture} roughness={0.6} metalness={0.1} />
      </mesh>

      {/* Render Region Pins attached to globe surface */}
      {spots.map((spot) => (
        <RegionPin key={spot.id} spot={spot} onSelectSpot={onSelectSpot} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Globe — public export
// ---------------------------------------------------------------------------

export const Globe: React.FC<GlobeProps> = ({ spots, onSelectSpot }) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);

  /**
   * null  → probe not yet run (SSR / before first effect)
   * false → probe ran, WebGL is available; glAttrs holds the attrs to use
   * true  → probe ran, WebGL definitively unavailable; show GlobeFallback
   */
  /**
   * null  → detection not yet run (before first useEffect on client)
   * false → detection passed; Canvas is safe to mount
   * true  → detection failed or runtime error; show GlobeFallback
   */
  const [webGLFailed, setWebGLFailed] = useState<boolean | null>(null);

  useEffect(() => {
    // detectWebGLSupport() uses a bare, no-attribute getContext() call —
    // the most permissive possible check, matching get.webgl.org's approach.
    if (!detectWebGLSupport()) {
      setWebGLFailed(true);
    } else {
      setWebGLFailed(false);
    }
  }, []);

  // While the probe hasn't run yet (first SSR→client paint), render nothing
  // in the globe slot — this prevents a flash of the Canvas before we know
  // whether WebGL will succeed.
  if (webGLFailed === null) {
    return (
      <div
        style={{
          width: '100%',
          maxWidth: '900px',
          height: 'clamp(440px, 68vh, 680px)',
          margin: '0 auto',
        }}
      />
    );
  }

  if (webGLFailed) {
    return <GlobeFallback />;
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '900px',
        height: 'clamp(440px, 68vh, 680px)',
        position: 'relative',
        userSelect: 'none',
        margin: '0 auto',
      }}
    >
      {/* Error boundary catches any runtime Three.js / WebGL crash post-init */}
      <GlobeErrorBoundary onError={() => setWebGLFailed(true)}>
        <Canvas
          camera={{ position: [0, 0, 6.2], fov: 45 }}
          style={{ background: 'transparent', width: '100%', height: '100%' }}
          /**
           * RELAXED_GL_ATTRS uses powerPreference="default" (not the
           * "high-performance" Three.js used to default to) to prevent
           * context-creation failures on switchable-GPU laptops.
           * If Canvas creation fails despite this, the error boundary above
           * will catch it and trigger the fallback UI.
           */
          gl={RELAXED_GL_ATTRS}
          onCreated={({ gl }) => {
            const ctx = gl.getContext();
            if (!ctx) {
              console.error('[Globe] onCreated: gl.getContext() returned null — triggering fallback.');
              setWebGLFailed(true);
              return;
            }
            // Log context attributes actually granted by the driver so we can
            // see in the console whether antialias / powerPreference were honoured.
            const granted = ctx.getContextAttributes?.();
            console.info('[Globe] WebGL context created successfully.', {
              rendererInfo: gl.info?.render,
              contextAttrsGranted: granted,
              isWebGL2: ctx instanceof WebGL2RenderingContext,
            });

            // Listen for context loss at the DOM level — handles GPU driver
            // crashes or tab backgrounding on mobile that kills the context.
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault(); // prevent Three.js from throwing
              console.warn('[Globe] WebGL context lost — falling back to static UI.');
              setWebGLFailed(true);
            });
          }}
        >
          <ambientLight intensity={1.3} />
          <directionalLight position={[5, 3, 5]} intensity={1.8} />
          <directionalLight position={[-5, -3, -5]} intensity={0.4} />

          <Suspense fallback={null}>
            <EarthMesh spots={spots} onSelectSpot={onSelectSpot} isDragging={isDragging} />
          </Suspense>

          <OrbitControls
            enablePan={false}
            enableZoom={true}
            minDistance={2.8}
            maxDistance={10.0}
            rotateSpeed={0.6}
            onStart={() => setIsDragging(true)}
            onEnd={() => setIsDragging(false)}
          />
        </Canvas>
      </GlobeErrorBoundary>
    </div>
  );
};
