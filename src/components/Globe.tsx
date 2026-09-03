'use client';

import React, { useRef, useState, useEffect, Suspense, Component } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RegionPin } from './RegionPin';
import { GlobeFallback } from './GlobeFallback';
import type { Spot } from '@/types/spot';

// ---------------------------------------------------------------------------
// WebGL context probe — attempts creation with increasingly relaxed settings
// ---------------------------------------------------------------------------

interface ContextProbeResult {
  /** Whether any WebGL context could be created. */
  supported: boolean;
  /**
   * The most permissive set of WebGLContextAttributes that succeeded.
   * undefined when supported === false.
   */
  attrs?: WebGLContextAttributes;
  /** Human-readable explanation for logging. */
  reason: string;
}

/**
 * Probes WebGL context creation with three progressively relaxed attribute
 * sets, mirroring what production Three.js sites do when strict settings fail
 * on hybrid-GPU / low-power hardware.
 *
 * Attempt order:
 *   1. antialias ON  + powerPreference "default"   (good quality, compatible)
 *   2. antialias OFF + powerPreference "default"   (no MSAA — most permissive)
 *   3. antialias OFF + powerPreference "low-power"  (final safety net)
 *
 * Note: we deliberately avoid "high-performance" — Three.js used to default
 * to that, which caused context-creation failures on switchable-GPU laptops
 * even when basic WebGL was fully available.
 */
function probeWebGLContext(): ContextProbeResult {
  if (typeof window === 'undefined') {
    // SSR — cannot probe, assume supported so Canvas renders after hydration.
    return { supported: true, reason: 'SSR environment — deferred to client' };
  }

  const candidates: Array<{ attrs: WebGLContextAttributes; label: string }> = [
    {
      attrs: { antialias: true,  powerPreference: 'default', alpha: true, depth: true, stencil: false },
      label: 'antialias=true, powerPreference=default',
    },
    {
      attrs: { antialias: false, powerPreference: 'default', alpha: true, depth: true, stencil: false },
      label: 'antialias=false, powerPreference=default',
    },
    {
      attrs: { antialias: false, powerPreference: 'low-power', alpha: true, depth: true, stencil: false },
      label: 'antialias=false, powerPreference=low-power',
    },
  ];

  for (const { attrs, label } of candidates) {
    try {
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 1;
      testCanvas.height = 1;

      // Try WebGL2 first, fall back to WebGL1.
      const ctx =
        (testCanvas.getContext('webgl2', attrs) as WebGLRenderingContext | null) ||
        (testCanvas.getContext('webgl',  attrs) as WebGLRenderingContext | null) ||
        (testCanvas.getContext('experimental-webgl', attrs) as WebGLRenderingContext | null);

      if (ctx) {
        // Immediately lose the test context so we don't hold GPU resources.
        const loseExt = ctx.getExtension('WEBGL_lose_context');
        loseExt?.loseContext();

        console.info(`[Globe] WebGL probe succeeded with: ${label}`);
        return { supported: true, attrs, reason: label };
      } else {
        console.warn(`[Globe] WebGL probe: getContext returned null for ${label}`);
      }
    } catch (err) {
      console.warn(`[Globe] WebGL probe: exception for ${label}:`, err);
    }
  }

  return {
    supported: false,
    reason: 'All WebGL context creation attempts failed (antialias on/off, all powerPreference values)',
  };
}

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
  const [webGLFailed, setWebGLFailed] = useState<boolean | null>(null);
  const [glAttrs, setGlAttrs] = useState<WebGLContextAttributes>({
    antialias: true,
    powerPreference: 'default',
    alpha: true,
    depth: true,
    stencil: false,
  });

  useEffect(() => {
    const result = probeWebGLContext();

    if (!result.supported) {
      console.warn('[Globe] WebGL unavailable — reason:', result.reason);
      setWebGLFailed(true);
      return;
    }

    // Use the exact attrs that succeeded in the probe so Canvas creation
    // is guaranteed to use a compatible configuration.
    if (result.attrs) {
      setGlAttrs(result.attrs);
    }
    setWebGLFailed(false);
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
           * Use the attrs confirmed to work by probeWebGLContext().
           * Critically: powerPreference is "default" (not "high-performance"),
           * which fixes context-creation failures on switchable-GPU laptops
           * where basic WebGL works fine but the high-perf GPU request fails.
           */
          gl={glAttrs}
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
