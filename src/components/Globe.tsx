'use client';

import React, { useRef, useState, useEffect, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RegionPin } from './RegionPin';
import type { Spot } from '@/types/spot';

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

export const Globe: React.FC<GlobeProps> = ({ spots, onSelectSpot }) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);

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
      <Canvas
        camera={{ position: [0, 0, 6.2], fov: 45 }}
        style={{ background: 'transparent', width: '100%', height: '100%' }}
        gl={{ antialias: true }}
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
    </div>
  );
};
