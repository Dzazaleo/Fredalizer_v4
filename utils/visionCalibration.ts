// Access global OpenCV instance
declare var cv: any;

export interface VisionProfile {
  // Pre-calculated HSV bounds for the Triad Check
  bounds: {
    dark: { lower: number[]; upper: number[] };
    light: { lower: number[]; upper: number[] };
    white: { lower: number[]; upper: number[] };
  };
  // Spatial Template for Position Locking (Normalized 0.0 - 1.0)
  spatial: {
    normalizedBox: { x: number; y: number; w: number; h: number };
    aspectRatio: number;
  };
}

// Hardcoded Robust Colors (RGB) - PRESERVED FOR DETECTION
const TARGET_COLORS = {
  MENU_DARK: [14, 4, 49],   // Deep Purple Background
  MENU_LIGHT: [50, 4, 139], // Lighter Purple Selection Bar
  TEXT_WHITE: [255, 255, 255]
};

interface HSVRange {
  lower: number[];
  upper: number[];
}

/**
 * Helper to convert RGB to OpenCV HSV (H: 0-180, S: 0-255, V: 0-255)
 */
function getHsvRange(rgb: number[], tolerance = { h: 10, s: 40, v: 40 }): HSVRange {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta === 0) h = 0;
  else if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * (((b - r) / delta) + 2);
  else if (max === b) h = 60 * (((r - g) / delta) + 4);

  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  // Convert to OpenCV scale
  const cvH = h / 2;       // 0-180
  const cvS = s * 255;     // 0-255
  const cvV = v * 255;     // 0-255

  // Apply tolerance
  const lower = [
    Math.max(0, cvH - tolerance.h),
    Math.max(0, cvS - tolerance.s),
    Math.max(0, cvV - tolerance.v),
    0
  ];

  const upper = [
    Math.min(180, cvH + tolerance.h),
    Math.min(255, cvS + tolerance.s),
    Math.min(255, cvV + tolerance.v),
    255
  ];

  return { lower, upper };
}

/**
 * NEW LOGIC: Mask-Based Calibration
 * 1. Derives SPATIAL data from the White region of the input mask.
 * 2. Derives COLOR data from hardcoded constants (ignoring the image colors).
 */
export function calibrateReference(image: HTMLImageElement): VisionProfile {
  if (typeof cv === 'undefined') {
    throw new Error("OpenCV is not loaded yet.");
  }

  // --- Part A: Prepare Static Color Bounds (The Constants) ---
  // We no longer look at the image for this. We trust the constants.
  
  const darkBounds = getHsvRange(TARGET_COLORS.MENU_DARK, { h: 20, s: 50, v: 50 });
  const lightBounds = getHsvRange(TARGET_COLORS.MENU_LIGHT, { h: 15, s: 50, v: 50 });
  
  // White: Low Saturation, High Value
  const whiteBounds = {
    lower: [0, 0, 200, 0],
    upper: [180, 30, 255, 255]
  };

  // --- Part B: Analyze Mask for Spatial Lock ---
  const src = cv.imread(image);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  let spatial = {
    normalizedBox: { x: 0, y: 0, w: 0, h: 0 },
    aspectRatio: 0
  };

  try {
    // 1. Convert to Binary Mask (White vs Black)
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    
    // Threshold: Anything brighter than 200 becomes 255 (White), else 0 (Black)
    cv.threshold(gray, binary, 200, 255, cv.THRESH_BINARY);

    // 2. Find Contours of the White Area
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let bestRect = null;

    for (let i = 0; i < contours.size(); ++i) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > maxArea) {
        maxArea = area;
        bestRect = cv.boundingRect(cnt);
      }
    }

    const totalPixels = src.cols * src.rows;
    
    // Threshold: 0.1% area (Relaxed, since mask is explicit)
    if (bestRect && maxArea > (totalPixels * 0.001)) {
      
      console.log(`[Calibration] Mask Target Found: x=${bestRect.x}, y=${bestRect.y}, w=${bestRect.width}, h=${bestRect.height}`);

      // 3. Normalize
      spatial = {
        normalizedBox: {
          x: bestRect.x / src.cols,
          y: bestRect.y / src.rows,
          w: bestRect.width / src.cols,
          h: bestRect.height / src.rows
        },
        aspectRatio: bestRect.width / bestRect.height
      };

      console.log(`[Calibration] Normalized Profile: ${JSON.stringify(spatial.normalizedBox)}`);

    } else {
      throw new Error("Calibration failed: No white target mask found in the uploaded image.");
    }

  } catch (e) {
    console.error("Calibration Error:", e);
    throw e;
  } finally {
    // Clean up all Mats
    src.delete();
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }

  return {
    bounds: {
      dark: darkBounds,
      light: lightBounds,
      white: whiteBounds
    },
    spatial
  };
}