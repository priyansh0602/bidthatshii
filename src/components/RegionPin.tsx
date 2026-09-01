'use client';

import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { latLngToVector3 } from '@/lib/latLngToVector3';
import { trackClick } from '@/lib/supabase';
import type { Spot } from '@/types/spot';

interface RegionPinProps {
  spot: Spot;
  onSelectSpot: (spot: Spot) => void;
}

export const RegionPin: React.FC<RegionPinProps> = ({ spot, onSelectSpot }) => {
  const groupRef = useRef<THREE.Group>(null);
  const [isVisible, setIsVisible] = useState<boolean>(true);
  const [logoHovered, setLogoHovered] = useState<boolean>(false);
  const [outbidHovered, setOutbidHovered] = useState<boolean>(false);

  // Position pin slightly above globe surface (radius 2.04) to prevent z-fighting
  const position = latLngToVector3(spot.latitude ?? 0, spot.longitude ?? 0, 2.04);

  useFrame(({ camera }) => {
    if (!groupRef.current) return;
    const pinWorldPos = new THREE.Vector3();
    groupRef.current.getWorldPosition(pinWorldPos);

    // Vector from globe center (0,0,0) to pin
    const normal = pinWorldPos.clone().normalize();
    // Vector from globe center (0,0,0) to camera
    const cameraDir = camera.position.clone().normalize();

    // Dot product > 0.15 means pin is on the camera-facing side of globe
    const dot = normal.dot(cameraDir);
    const visible = dot > 0.15;
    if (visible !== isVisible) {
      setIsVisible(visible);
    }
  });

  const isClaimed = Boolean(spot.current_winner_url || spot.current_winner_id_url);
  const currentPrice = spot.current_highest_total > 0 ? spot.current_highest_total : 0;
  const nextPrice =
    spot.current_highest_total > 0
      ? spot.current_highest_total + (spot.min_increment ?? 1)
      : (spot.starting_price ?? 5);

  // Handler 1: Redirect to advertiser URL on logo / name click
  const handleRedirect = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!spot.current_winner_url) return;

    const advertiserId = spot.current_winner_id_url || spot.current_winner_url;
    trackClick(spot.id, advertiserId);

    let targetUrl = spot.current_winner_url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  // Handler 2: Open BidModal without triggering redirect
  const handleOpenModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectSpot(spot);
  };

  return (
    <group ref={groupRef} position={position}>
      {isVisible && (
        <Html
          center
          distanceFactor={7}
          style={{
            pointerEvents: 'auto',
            userSelect: 'none',
            transition: 'opacity 0.2s, transform 0.2s',
            opacity: isVisible ? 1 : 0,
          }}
        >
          {isClaimed ? (
            /* CLAIMED PIN: Split badge with completely independent click targets */
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                backgroundColor: '#0f172a',
                borderRadius: '20px',
                border: '1.5px solid #334155',
                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
                overflow: 'hidden',
                fontSize: '11px',
                fontWeight: 600,
                color: '#ffffff',
                whiteSpace: 'nowrap',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Target A: Advertiser Logo & Region Name -> Redirects to website */}
              <div
                onClick={handleRedirect}
                onMouseEnter={() => setLogoHovered(true)}
                onMouseLeave={() => setLogoHovered(false)}
                title={`Visit ${spot.current_winner_url}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px 4px 6px',
                  cursor: 'pointer',
                  backgroundColor: logoHovered ? '#1e293b' : 'transparent',
                  transition: 'background-color 0.15s',
                }}
              >
                {spot.current_winner_logo_url ? (
                  <img
                    src={spot.current_winner_logo_url}
                    alt={spot.display_name}
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#10b981',
                    }}
                  />
                )}
                <span>{spot.display_name}</span>
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>${currentPrice}</span>
              </div>

              {/* Divider */}
              <div style={{ width: '1px', height: '18px', backgroundColor: '#334155' }} />

              {/* Target B: Dedicated Outbid Button -> Opens BidModal only */}
              <button
                type="button"
                onClick={handleOpenModal}
                onMouseEnter={() => setOutbidHovered(true)}
                onMouseLeave={() => setOutbidHovered(false)}
                title={`Outbid ${spot.display_name} for $${nextPrice}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  padding: '4px 8px',
                  backgroundColor: outbidHovered ? '#be123c' : '#e11d48',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                  lineHeight: 1,
                }}
              >
                <span>Outbid</span>
                <span style={{ opacity: 0.9 }}>${nextPrice}</span>
              </button>
            </div>
          ) : (
            /* UNCLAIMED PIN: Single click target opening BidModal */
            <div
              onClick={handleOpenModal}
              onMouseEnter={() => setOutbidHovered(true)}
              onMouseLeave={() => setOutbidHovered(false)}
              title={`Claim ${spot.display_name} for $${nextPrice}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '20px',
                backgroundColor: outbidHovered ? '#e11d48' : '#ffffff',
                color: outbidHovered ? '#ffffff' : '#0f172a',
                border: outbidHovered ? '2px solid #e11d48' : '2px solid #cbd5e1',
                boxShadow: outbidHovered
                  ? '0 6px 16px rgba(225, 29, 72, 0.3)'
                  : '0 4px 10px rgba(0, 0, 0, 0.12)',
                cursor: 'pointer',
                transform: outbidHovered ? 'scale(1.1)' : 'scale(1)',
                transition: 'all 0.15s ease',
                fontSize: '11px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#e11d48',
                  boxShadow: '0 0 6px #e11d48',
                }}
              />
              <span>{spot.display_name}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, opacity: 0.85 }}>
                ${nextPrice}
              </span>
            </div>
          )}
        </Html>
      )}
    </group>
  );
};
