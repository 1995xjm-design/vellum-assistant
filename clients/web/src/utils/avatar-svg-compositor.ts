import type {
  BodyShapeDefinition,
  CharacterComponents,
  ColorDefinition,
  EyeStyleDefinition,
} from "@/types/avatar";

export interface AvatarTransforms {
  bodyTransform: string;
  eyeTransform: string;
}

/**
 * Compute the body group's scale and translation for the target size. Shared by
 * {@link computeTransforms} (which layers the eye math on top) and the eyeless
 * body-only path so both derive the body matrix from one formula.
 */
function computeBodyPlacement(
  bodyShape: BodyShapeDefinition,
  size: number,
): { bodyScale: number; bodyTx: number; bodyTy: number } {
  const bodyVB = bodyShape.viewBox;
  const bodyScale = Math.min(size / bodyVB.width, size / bodyVB.height);
  const bodyTx = (size - bodyVB.width * bodyScale) / 2;
  const bodyTy = (size - bodyVB.height * bodyScale) / 2;
  return { bodyScale, bodyTx, bodyTy };
}

/**
 * Compute the SVG transform strings for body and eye groups.
 */
export function computeTransforms(
  bodyShape: BodyShapeDefinition,
  eyeStyle: EyeStyleDefinition,
  components: CharacterComponents,
  size: number,
): AvatarTransforms {
  const override = components.faceCenterOverrides.find(
    (o) => o.bodyShape === bodyShape.id && o.eyeStyle === eyeStyle.id,
  );
  const faceCenter = override ? override.faceCenter : bodyShape.faceCenter;

  const bodyVB = bodyShape.viewBox;
  const { bodyScale, bodyTx, bodyTy } = computeBodyPlacement(bodyShape, size);

  const eyeVB = eyeStyle.sourceViewBox;
  const remapScale = Math.min(
    bodyVB.width / eyeVB.width,
    bodyVB.height / eyeVB.height,
  );
  const remapTx = faceCenter.x - eyeStyle.eyeCenter.x * remapScale;
  const remapTy = faceCenter.y - eyeStyle.eyeCenter.y * remapScale;

  const composedScale = bodyScale * remapScale;
  const composedTx = bodyScale * remapTx + bodyTx;
  const composedTy = bodyScale * remapTy + bodyTy;

  return {
    bodyTransform: `matrix(${bodyScale},0,0,${bodyScale},${bodyTx},${bodyTy})`,
    eyeTransform: `matrix(${composedScale},0,0,${composedScale},${composedTx},${composedTy})`,
  };
}

export interface ResolvedAvatarDefinitions {
  bodyShape: BodyShapeDefinition;
  eyeStyle: EyeStyleDefinition | undefined;
  color: ColorDefinition;
}

export interface ResolvedEyedAvatarDefinitions {
  bodyShape: BodyShapeDefinition;
  eyeStyle: EyeStyleDefinition;
  color: ColorDefinition;
}

/**
 * Resolve the active definitions from components + trait IDs. Missing or
 * unknown ids return `null` so renderers can fall through rather than throw.
 * When `eyeStyleId` is absent (null/undefined) the eye style is left
 * unresolved (body-only avatars).
 */
export function resolveDefinitions(
  components: CharacterComponents,
  bodyShapeId: string,
  eyeStyleId: string,
  colorId: string,
): ResolvedEyedAvatarDefinitions | null;
export function resolveDefinitions(
  components: CharacterComponents,
  bodyShapeId: string,
  eyeStyleId: string | null | undefined,
  colorId: string,
): ResolvedAvatarDefinitions | null;
export function resolveDefinitions(
  components: CharacterComponents,
  bodyShapeId: string,
  eyeStyleId: string | null | undefined,
  colorId: string,
): ResolvedAvatarDefinitions | null {
  const bodyShape = components.bodyShapes.find((b) => b.id === bodyShapeId);
  if (!bodyShape) {
    return null;
  }
  let eyeStyle: EyeStyleDefinition | undefined;
  if (eyeStyleId != null) {
    eyeStyle = components.eyeStyles.find((e) => e.id === eyeStyleId);
    if (!eyeStyle) {
      return null;
    }
  }
  const color = components.colors.find((c) => c.id === colorId);
  if (!color) {
    return null;
  }
  return { bodyShape, eyeStyle, color };
}

/** True when every trait id resolves against `components`. */
export function canResolveDefinitions(
  components: CharacterComponents,
  bodyShapeId: string,
  eyeStyleId: string | null | undefined,
  colorId: string,
): boolean {
  return (
    resolveDefinitions(components, bodyShapeId, eyeStyleId, colorId) != null
  );
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function composeSvg(
  components: CharacterComponents,
  bodyShapeId: string,
  eyeStyleId: string | null | undefined,
  colorId: string,
  size: number = 512,
): string | null {
  const resolved = resolveDefinitions(
    components,
    bodyShapeId,
    eyeStyleId,
    colorId,
  );
  if (!resolved) {
    return null;
  }
  return composeSvgFromDefinitions(
    resolved.bodyShape,
    resolved.eyeStyle,
    resolved.color,
    components,
    size,
  );
}

export function composeSvgFromDefinitions(
  bodyShape: BodyShapeDefinition,
  eyeStyle: EyeStyleDefinition | null | undefined,
  color: ColorDefinition,
  components: CharacterComponents,
  size: number = 512,
): string {
  const backdrop = minionBackdropSvg(bodyShape, color, size);
  // Body-only (eyeless) avatar: skip the eye-transform math and emit no eye paths.
  if (!eyeStyle) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${backdrop}</svg>`;
  }

  const { eyeTransform } = computeTransforms(
    bodyShape,
    eyeStyle,
    components,
    size,
  );

  const eyePaths = eyeStyle.paths
    .map(
      (p) =>
        `<path d="${escapeAttr(p.svgPath)}" fill="${escapeAttr(p.color)}" transform="${eyeTransform}"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${backdrop}${eyePaths}</svg>`;
}

/**
 * Original yellow goggle-worker styling shared by every avatar trait
 * combination. The selected trait color tints the background disc, while the
 * face and overalls stay consistent so previously stored avatars also adopt
 * the new visual language.
 */
function minionBackdropSvg(
  bodyShape: BodyShapeDefinition,
  color: ColorDefinition,
  size: number,
): string {
  const viewBox = bodyShape.viewBox;
  const minSide = Math.min(viewBox.width, viewBox.height);
  const cx = bodyShape.faceCenter.x;
  const cy = bodyShape.faceCenter.y;
  const faceRadius = minSide * 0.34;
  const goggleWidth = faceRadius * 1.72;
  const goggleHeight = faceRadius * 0.82;
  const goggleX = cx - goggleWidth / 2;
  const goggleY = cy - goggleHeight / 2 - faceRadius * 0.06;
  const bodyTop = cy + faceRadius * 0.72;
  const bodyBottom = viewBox.height * 0.98;
  const backgroundRadius = minSide * 0.46;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${backgroundRadius}" fill="${escapeAttr(color.hex)}" opacity="0.22"/>` +
    `<path d="M ${cx - faceRadius * 0.78} ${bodyTop} ` +
    `Q ${cx} ${bodyTop - faceRadius * 0.24} ${cx + faceRadius * 0.78} ${bodyTop} ` +
    `L ${cx + faceRadius * 0.98} ${bodyBottom} H ${cx - faceRadius * 0.98} Z" fill="#2F5FB0"/>` +
    `<path d="M ${cx - faceRadius * 0.36} ${bodyTop + faceRadius * 0.02} ` +
    `L ${cx - faceRadius * 0.12} ${bodyBottom} M ${cx + faceRadius * 0.36} ${bodyTop + faceRadius * 0.02} ` +
    `L ${cx + faceRadius * 0.12} ${bodyBottom}" stroke="#F5F5F5" stroke-width="${faceRadius * 0.08}" stroke-linecap="round"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${faceRadius}" fill="#FFD83D"/>` +
    `<path d="M ${cx - faceRadius * 0.95} ${goggleY + goggleHeight * 0.42} H ${cx + faceRadius * 0.95}" ` +
    `stroke="#111111" stroke-width="${faceRadius * 0.13}" stroke-linecap="round"/>` +
    `<rect x="${goggleX}" y="${goggleY}" width="${goggleWidth}" height="${goggleHeight}" ` +
    `rx="${goggleHeight * 0.34}" fill="#171717"/>` +
    `<rect x="${goggleX}" y="${goggleY}" width="${goggleWidth}" height="${goggleHeight}" ` +
    `rx="${goggleHeight * 0.34}" fill="none" stroke="#D8D8D8" stroke-width="${faceRadius * 0.055}"/>` +
    `<path d="M ${cx - faceRadius * 0.22} ${cy + faceRadius * 0.5} ` +
    `Q ${cx} ${cy + faceRadius * 0.68} ${cx + faceRadius * 0.22} ${cy + faceRadius * 0.5}" ` +
    `fill="none" stroke="#111111" stroke-width="${faceRadius * 0.055}" stroke-linecap="round"/>`
  );
}
