'use client';

import React, { useRef, useState, useEffect, Suspense, Component } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RegionPin } from './RegionPin';
import { GlobeFallback } from './GlobeFallback';
import type { Spot } from '@/types/spot';

// ---------------------------------------------------------------------------
// WebGL capability pre-check
// ---------------------------------------------------------------------------

/**
 * Returns true if the browser can create a WebGL (or WebGL2) context.
 * Called once on the client before ever mounting the Canvas, so we never
 * attempt to render Three.js in an environment that would silently fail or
 * show a broken blank area.
 *
 * Returns true by default in SSR / non-browser environments so the check
 * is always safe to call.
 */
function isWebGLSupported(): boolean {
  if (typeof window === 'undefined') return true; // SSR — assume supported
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// React Error Boundary — catches runtime errors inside <Canvas>
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  hasError: boolean;
}

class GlobeErrorBoundary extends Component<
  { children: React.ReactNode; onError: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('[Globe] WebGL/Three.js error caught by boundary:', error, info);
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

  // Track whether WebGL failed (either pre-check or runtime error boundary).
  // Initialise lazily on the client so SSR renders the Canvas path (which
  // Next.js will hydrate correctly once JS loads and the real check runs).
  const [webGLFailed, setWebGLFailed] = useState<boolean>(false);

  useEffect(() => {
    // Run the capability check once on mount (client-only).
    if (!isWebGLSupported()) {
      console.warn('[Globe] WebGL not supported — showing fallback UI.');
      setWebGLFailed(true);
    }
  }, []);

  // Show fallback if WebGL is unavailable (pre-check) or failed at runtime.
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
      {/* Error boundary catches any runtime Three.js / WebGL crash */}
      <GlobeErrorBoundary onError={() => setWebGLFailed(true)}>
        <Canvas
          camera={{ position: [0, 0, 6.2], fov: 45 }}
          style={{ background: 'transparent', width: '100%', height: '100%' }}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            // Double-check: if the renderer context is somehow null, bail out.
            if (!gl.getContext()) {
              console.warn('[Globe] Canvas created but gl context is null — showing fallback.');
              setWebGLFailed(true);
            }
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
