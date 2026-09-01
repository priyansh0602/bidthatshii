import * as THREE from 'three';

/**
 * Converts spherical coordinates (latitude, longitude, radius) to a Three.js Vector3 position.
 * @param latitude Latitude in degrees (-90 to 90)
 * @param longitude Longitude in degrees (-180 to 180)
 * @param radius Sphere radius (default 2)
 */
export function latLngToVector3(
  latitude: number,
  longitude: number,
  radius: number = 2
): THREE.Vector3 {
  const phi = (90 - latitude) * (Math.PI / 180);
  const theta = (longitude + 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}
