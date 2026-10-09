import sharp from "sharp";
import type { MeasuredFrame } from "./frame-assets";

// Pixels at or below this alpha count as the see-through screen.
const CLEAR_ALPHA = 24;

/**
 * Finds a bezel PNG's screen: the transparent region connected to the image
 * centre. Its bounding box is the screen rect; how far the cutout's corner sits
 * in along the diagonal gives the corner radius. Dynamic Island and camera
 * cut-ins are opaque islands inside that region, so they don't move the box.
 */
export async function measureFrame(bytes: Buffer, src: string): Promise<MeasuredFrame> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const clear = (x: number, y: number) => data[(y * width + x) * channels + 3] <= CLEAR_ALPHA;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  if (!clear(cx, cy)) {
    throw new Error("the centre of the image is not transparent; export the bezel with an empty screen");
  }

  const seen = new Uint8Array(width * height);
  const stack = [cy * width + cx];
  seen[stack[0]] = 1;
  let minX = cx, maxX = cx, minY = cy, maxY = cy;
  while (stack.length) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (seen[next] || !clear(nx, ny)) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  if (minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1) {
    throw new Error("the transparent screen reaches the image edge, so no bezel surrounds it");
  }
  const screen = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  if (screen.w < width * 0.5 || screen.h < height * 0.5) {
    throw new Error("the transparent area at the centre is too small to be the screen");
  }

  // A circular corner of radius r leaves r·(1 − 1/√2) of bezel along the
  // diagonal. Corners can differ (the iPhone Duo's outer display is square on
  // its hinge side), so each is measured on its own.
  const limit = Math.min(screen.w, screen.h) / 2;
  const cornerRadius = (x0: number, y0: number, dx: number, dy: number) => {
    let inset = 0;
    while (inset < limit && !seen[(y0 + dy * inset) * width + x0 + dx * inset]) inset++;
    return Math.round(inset / (1 - Math.SQRT1_2));
  };
  const radii: MeasuredFrame["radii"] = [
    cornerRadius(minX, minY, 1, 1),
    cornerRadius(maxX, minY, -1, 1),
    cornerRadius(maxX, maxY, -1, -1),
    cornerRadius(minX, maxY, 1, -1),
  ];

  return { src, width, height, screen, radius: Math.max(...radii), radii };
}
