import type { DimensionScore } from "./types";

const MAX_DISTANCE_KM = 50;

/**
 * Scores geographic proximity using Haversine distance with linear decay.
 * max(0, 1 - distance/50km).
 */
export function scoreProximity(
  empLat: number | null,
  empLng: number | null,
  clientLat: number | null,
  clientLng: number | null
): DimensionScore {
  if (empLat == null || empLng == null || clientLat == null || clientLng == null) {
    return {
      score: 0.0,
      confidence: "low",
      reason: "Missing coordinates for proximity calculation",
    };
  }

  const distanceKm = haversine(empLat, empLng, clientLat, clientLng);
  const score = Math.max(0, 1 - distanceKm / MAX_DISTANCE_KM);

  return {
    score,
    confidence: "high",
    reason: `${distanceKm.toFixed(1)}km distance (max ${MAX_DISTANCE_KM}km)`,
  };
}

/** Haversine formula — returns distance in kilometres. */
function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
