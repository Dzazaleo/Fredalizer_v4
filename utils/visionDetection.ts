import { VisionProfile } from './visionCalibration';

// Access global OpenCV instance
declare var cv: any;

/**
 * Scans a frame using "Strict ROI Verification" strategy.
 * 
 * Logic:
 * 1. ROI Extraction: Directly crop the expected area defined by the calibration profile.
 * 2. Color Analysis: Check pixel density of Background (Dark Purple) and Text (White) within that ROI.
 * 3. Thresholds: Requires >30% background coverage and >0.5% text coverage.
 * 
 * This approach replaces global contour search to handle cases where the menu 
 * background color blends with the game background (e.g. blue on blue).
 */
export function scanFrame(srcFrame: any, profile: VisionProfile, debugMode: boolean = false): boolean {
  if (typeof cv === 'undefined') return false;

  let detected = false;

  // --- Mats to cleanup ---
  let roiMat: any = null;
  let hsvRoi: any = null;
  let maskDark: any = null;
  let maskWhite: any = null;
  
  // Scalars/Arrays for bounds
  let lowP: any = null;
  let highP: any = null;
  let lowW: any = null;
  let highW: any = null;

  try {
    const fw = srcFrame.cols;
    const fh = srcFrame.rows;
    const nb = profile.spatial.normalizedBox;

    // --- Step 1: Calculate ROI with Padding ---
    // Add 5% padding to account for compression artifacts or slight shifts
    const padW = nb.w * 0.05;
    const padH = nb.h * 0.05;

    let x = Math.floor((nb.x - (padW / 2)) * fw);
    let y = Math.floor((nb.y - (padH / 2)) * fh);
    let w = Math.floor((nb.w + padW) * fw);
    let h = Math.floor((nb.h + padH) * fh);

    // Boundary checks (Clamp to frame dimensions)
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > fw) w = fw - x;
    if (y + h > fh) h = fh - y;

    // Sanity check
    if (w <= 0 || h <= 0) return false;

    const rect = new cv.Rect(x, y, w, h);
    const area = w * h;

    // --- Step 2: Extract ROI ---
    // roiMat shares memory with srcFrame (it's a view), but we treat it as a separate handle to delete
    roiMat = srcFrame.roi(rect);

    // --- Step 3: Convert to HSV ---
    hsvRoi = new cv.Mat();
    // Assuming Input is RGBA (from Canvas)
    cv.cvtColor(roiMat, hsvRoi, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsvRoi, hsvRoi, cv.COLOR_RGB2HSV);

    // --- Step 4: Check A (Background - Dark Purple) ---
    lowP = new cv.Mat(hsvRoi.rows, hsvRoi.cols, hsvRoi.type(), profile.bounds.dark.lower);
    highP = new cv.Mat(hsvRoi.rows, hsvRoi.cols, hsvRoi.type(), profile.bounds.dark.upper);
    maskDark = new cv.Mat();
    
    cv.inRange(hsvRoi, lowP, highP, maskDark);
    
    const darkPixels = cv.countNonZero(maskDark);
    const darkRatio = darkPixels / area;

    // --- Step 5: Check B (Text - White) ---
    lowW = new cv.Mat(hsvRoi.rows, hsvRoi.cols, hsvRoi.type(), profile.bounds.white.lower);
    highW = new cv.Mat(hsvRoi.rows, hsvRoi.cols, hsvRoi.type(), profile.bounds.white.upper);
    maskWhite = new cv.Mat();
    
    cv.inRange(hsvRoi, lowW, highW, maskWhite);
    
    const whitePixels = cv.countNonZero(maskWhite);
    const whiteRatio = whitePixels / area;

    if (debugMode) {
      console.log(`[ROI Scan] Area: ${area}px | Dark: ${(darkRatio * 100).toFixed(1)}% | White: ${(whiteRatio * 100).toFixed(2)}%`);
    }

    // --- Step 6: Threshold Decision ---
    // > 30% Dark Background AND > 0.5% White Text
    if (darkRatio > 0.30 && whiteRatio > 0.005) {
      detected = true;
    }

  } catch (err) {
    console.error("scanFrame ROI Error", err);
  } finally {
    // --- Explicit Cleanup ---
    // Essential for WASM memory management
    if (roiMat) roiMat.delete();
    if (hsvRoi) hsvRoi.delete();
    if (maskDark) maskDark.delete();
    if (maskWhite) maskWhite.delete();
    
    // Clean scalar mats
    if (lowP) lowP.delete();
    if (highP) highP.delete();
    if (lowW) lowW.delete();
    if (highW) highW.delete();
  }

  return detected;
}