// sqm_math.js - Sky Quality Analyzer math library
// Compatible with PixInsight PJSR and Node.js
// ES5 style: var, function declarations only (no let/const/arrow functions)

// ============================================================
// Sigma-clipping statistics
// ============================================================

/**
 * Compute sigma-clipped median, mean and standard deviation of an array.
 * @param {number[]} values - Input array of pixel values
 * @param {number} sigma    - Clipping threshold in units of std dev (default 3.0)
 * @param {number} maxIter  - Maximum iterations (default 10)
 * @returns {{median: number, mean: number, std: number, count: number}}
 */
function sigmaClippingStats(values, sigma, maxIter) {
    if (sigma === undefined) sigma = 3.0;
    if (maxIter === undefined) maxIter = 10;

    var data = values.slice(); // copy

    for (var iter = 0; iter < maxIter; iter++) {
        var med = median(data);
        var std = standardDeviation(data, med);
        if (std === 0) break;

        var clipped = [];
        var lo = med - sigma * std;
        var hi = med + sigma * std;
        for (var i = 0; i < data.length; i++) {
            if (data[i] >= lo && data[i] <= hi) {
                clipped.push(data[i]);
            }
        }
        if (clipped.length === data.length) break; // converged
        data = clipped;
    }

    var finalMed = median(data);
    var finalStd = standardDeviation(data, finalMed);
    var sum = 0;
    for (var i = 0; i < data.length; i++) { sum += data[i]; }
    var finalMean = (data.length > 0) ? sum / data.length : finalMed;
    return { median: finalMed, mean: finalMean, std: finalStd, count: data.length };
}

/**
 * Compute median of an array.
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
    if (values.length === 0) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

/**
 * Compute standard deviation of an array given its mean/median.
 * @param {number[]} values
 * @param {number} center - Mean or median
 * @returns {number}
 */
function standardDeviation(values, center) {
    if (values.length < 2) return 0;
    var sumSq = 0;
    for (var i = 0; i < values.length; i++) {
        var d = values[i] - center;
        sumSq += d * d;
    }
    return Math.sqrt(sumSq / (values.length - 1));
}

// ============================================================
// Linear least-squares fit
// ============================================================

/**
 * Compute linear least-squares fit: y = slope * x + intercept.
 * @param {number[]} xValues
 * @param {number[]} yValues
 * @returns {{slope: number, intercept: number, r2: number}}
 */
function linearFit(xValues, yValues) {
    var n = xValues.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
        sumX  += xValues[i];
        sumY  += yValues[i];
        sumXY += xValues[i] * yValues[i];
        sumX2 += xValues[i] * xValues[i];
    }

    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: 0, r2: 0 };

    var slope     = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;

    // R-squared
    var meanY = sumY / n;
    var ssTot = 0, ssRes = 0;
    for (var j = 0; j < n; j++) {
        var predicted = slope * xValues[j] + intercept;
        ssRes += (yValues[j] - predicted) * (yValues[j] - predicted);
        ssTot += (yValues[j] - meanY) * (yValues[j] - meanY);
    }
    var r2 = (ssTot === 0) ? 1.0 : (1.0 - ssRes / ssTot);

    return { slope: slope, intercept: intercept, r2: r2 };
}

// ============================================================
// SQM core calculations
// ============================================================

/**
 * Maximum allowed saturated_fraction for a frame to be used in the L_star fit.
 * A frame is excluded when saturated_fraction > MAX_SAT_FRACTION.
 * Set to 0: since aperturePhotometry() no longer scales the flux to make up for
 * saturated pixels (area-based fill-in always underestimates the true flux —
 * the saturated pixels are the star's brightest, so no area scaling can recover
 * them), any frame with even one saturated pixel in the aperture is excluded
 * from the fit. This is the single source of truth for the threshold; both
 * computeLStar() below and SkyQualityAnalyzer.js's runAnalysis() reference it.
 * See GitHub issue #13.
 */
var MAX_SAT_FRACTION = 0;

/**
 * Compute L_sky (background flux per pixel per second) from multi-exposure frames.
 * Each frame must have {exptime, adu_sky} where adu_sky is the
 * sigma-clipped median ADU of a star-free background region.
 * @param {{exptime: number, adu_sky: number}[]} frames
 * @returns {{L_sky: number, r2: number}}
 */
function computeLSky(frames) {
    var tValues = [];
    var adValues = [];
    for (var i = 0; i < frames.length; i++) {
        tValues.push(frames[i].exptime);
        adValues.push(frames[i].adu_sky);
    }
    var fit = linearFit(tValues, adValues);
    return { L_sky: fit.slope, r2: fit.r2 };
}

/**
 * Compute L_star (reference star flux per second) from multi-exposure frames.
 * Each frame must have {exptime, adu_star} where adu_star is the
 * aperture-photometry net count for the reference star.
 * Frames with saturated_fraction > satThreshold are excluded from the fit.
 * @param {{exptime: number, adu_star: number, saturated_fraction?: number}[]} frames
 * @param {number} [satThreshold=MAX_SAT_FRACTION] - Frames with saturation above this fraction are excluded
 * @returns {{L_star: number, r2: number, excluded_frames: number}}
 */
function computeLStar(frames, satThreshold) {
    if (satThreshold === undefined) satThreshold = MAX_SAT_FRACTION;
    var tValues = [];
    var adValues = [];
    var excluded = 0;
    for (var i = 0; i < frames.length; i++) {
        var sat = frames[i].saturated_fraction;
        if (sat !== undefined && sat > satThreshold) {
            excluded++;
            continue;
        }
        tValues.push(frames[i].exptime);
        adValues.push(frames[i].adu_star);
    }
    if (tValues.length < 2) {
        return { L_star: NaN, r2: NaN, excluded_frames: excluded };
    }
    var fit = linearFit(tValues, adValues);
    return { L_star: fit.slope, r2: fit.r2, excluded_frames: excluded };
}

/**
 * Convert L_sky [counts/s/px] to L'_sky [counts/s/arcsec²].
 * @param {number} L_sky        - Background flux per pixel per second
 * @param {number} pixel_scale  - Pixel scale [arcsec/px]
 * @returns {number} L'_sky
 */
function computeLPrimeSky(L_sky, pixel_scale) {
    return L_sky / (pixel_scale * pixel_scale);
}

/**
 * Compute SQM value using the reference star method.
 *
 * SQM = 2.5 * log10(L_star / L'_sky) + m0
 *
 * @param {number} L_star      - Reference star flux [counts/s]
 * @param {number} L_prime_sky - Sky background surface brightness [counts/s/arcsec²]
 * @param {number} m0          - Reference star catalog magnitude
 * @returns {number} SQM value [mag/arcsec²]
 */
function computeSQM(L_star, L_prime_sky, m0) {
    if (L_star <= 0 || L_prime_sky <= 0) return NaN;
    return 2.5 * Math.log10(L_star / L_prime_sky) + m0;
}

/**
 * Compute pixel scale from camera and telescope parameters.
 * @param {number} pixel_pitch_um  - Pixel size [μm]
 * @param {number} focal_length_mm - Focal length [mm]
 * @param {number} binning         - Binning factor (1, 2, ...)
 * @returns {number} Pixel scale [arcsec/px]
 */
function computePixelScale(pixel_pitch_um, focal_length_mm, binning) {
    if (binning === undefined) binning = 1;
    return (pixel_pitch_um * binning / focal_length_mm) * 206.265;
}

/**
 * Relative difference above which two pixel scales are reported as disagreeing
 * (selected equipment vs. image, or frames among themselves). SQM goes with
 * 5*log10(scale), so 2% is about 0.04 mag.
 */
var PIXEL_SCALE_WARN_FRAC = 0.02;

/**
 * Pick the session pixel scale from the per-frame values.
 * Priority: plate solution (wcs) > FITS header (header) > equipment database (db).
 * A source is used as soon as one frame has a valid (finite, > 0) value; the
 * scale is the median of that group.
 * wcsScales[i] and headerScales[i] must belong to the same frame (same order).
 * @param {number[]} wcsScales    - per-frame scale from the plate solution [arcsec/px] (0 = none)
 * @param {number[]} headerScales - per-frame scale from XPIXSZ/FOCALLEN [arcsec/px] (0 = none)
 * @param {number}   dbScale      - scale from the selected camera and telescope (0 = unknown)
 * @returns {{scale: number, source: string, dbScale: number, dbMismatch: number, spread: number}}
 *   source: "wcs" | "header" | "db" | "none".
 *   dbMismatch: |scale - dbScale| / dbScale, NaN if dbScale is unknown or source is "db"/"none".
 *   spread: (max - min) / scale over each frame's best value (its plate-solution
 *           value if valid, else its header value; frames with neither are left out),
 *           so frames with and without a solution are compared with each other.
 *           0 for "db"/"none".
 */
function choosePixelScale(wcsScales, headerScales, dbScale) {
    function valid(list) {
        var out = [];
        if (!list) return out;
        for (var i = 0; i < list.length; i++) {
            var v = list[i];
            if (typeof v === "number" && isFinite(v) && v > 0) out.push(v);
        }
        return out;
    }
    var db = (typeof dbScale === "number" && isFinite(dbScale) && dbScale > 0) ? dbScale : 0;
    var group = valid(wcsScales);
    var source = "wcs";
    if (group.length === 0) { group = valid(headerScales); source = "header"; }

    var scale = 0, spread = 0;
    if (group.length > 0) {
        scale = median(group);
        var best = [];
        var n = Math.max(wcsScales ? wcsScales.length : 0, headerScales ? headerScales.length : 0);
        for (var k = 0; k < n; k++) {
            var w = wcsScales ? wcsScales[k] : 0;
            var h = headerScales ? headerScales[k] : 0;
            if (typeof w === "number" && isFinite(w) && w > 0) best.push(w);
            else if (typeof h === "number" && isFinite(h) && h > 0) best.push(h);
        }
        spread = (Math.max.apply(null, best) - Math.min.apply(null, best)) / scale;
    } else if (db > 0) {
        scale = db;
        source = "db";
    } else {
        source = "none";
    }
    var dbMismatch = NaN;
    if (db > 0 && (source === "wcs" || source === "header")) {
        dbMismatch = Math.abs(scale - db) / db;
    }
    return { scale: scale, source: source, dbScale: db, dbMismatch: dbMismatch, spread: spread };
}

/**
 * Return a descriptive sky condition label for a given SQM value.
 * Returns null when sqm is not a finite number: with no value there must be
 * no label (a label would make a missing value look like a measurement).
 * @param {number} sqm
 * @returns {string|null}
 */
function skyConditionLabel(sqm) {
    if (typeof sqm !== "number" || !isFinite(sqm)) return null;
    if (sqm >= 22.0) return "Pristine Dark Sky";
    if (sqm >= 21.5) return "Truly Dark Sky";
    if (sqm >= 21.0) return "Rural Sky";
    if (sqm >= 20.0) return "Rural/Suburban Transition";
    if (sqm >= 19.0) return "Suburban Sky";
    if (sqm >= 18.0) return "Bright Suburban Sky";
    return "Urban Sky";
}

/**
 * Maximum ADU value used to convert PixInsight normalized samples [0, 1] to ADU.
 * Floating-point images have no native ADU scale, so they are taken as 16-bit
 * equivalent (65535). Only 32-bit integer images use the 32-bit range.
 * This is the only place the 32-bit range appears.
 * @param {boolean} isReal        - true for floating-point images (image.isReal)
 * @param {number} bitsPerSample  - image.bitsPerSample
 * @returns {number}
 */
function maxADUFor(isReal, bitsPerSample) {
    if (isReal) return 65535;
    if (bitsPerSample === 32) return 4294967295;
    return 65535;
}

/**
 * Convert PixInsight normalized pixel value (0-1) to ADU.
 * @param {number} normalized     - PixInsight sample value [0, 1]
 * @param {boolean} isReal        - true for floating-point images
 * @param {number} bitsPerSample  - Bit depth
 * @returns {number} ADU value
 */
function normalizedToADU(normalized, isReal, bitsPerSample) {
    return normalized * maxADUFor(isReal, bitsPerSample);
}

/**
 * Count distinct exposure times. Values closer than 1 ms are the same exposure.
 * @param {number[]} exptimes
 * @returns {number}
 */
function countDistinctExposures(exptimes) {
    var sorted = [];
    for (var i = 0; i < exptimes.length; i++) {
        if (typeof exptimes[i] === "number" && isFinite(exptimes[i])) sorted.push(exptimes[i]);
    }
    sorted.sort(function(a, b) { return a - b; });
    var count = 0;
    var groupStart = 0;
    for (var j = 0; j < sorted.length; j++) {
        // Compare with the first value of the group so the chain cannot drift.
        if (j === 0 || sorted[j] - groupStart >= 0.001 - 1e-9) {
            count++;
            groupStart = sorted[j];
        }
    }
    return count;
}

/**
 * Great-circle distance between two sky positions (haversine), in arcseconds.
 * @param {number} ra1  - RA [deg]
 * @param {number} dec1 - Dec [deg]
 * @param {number} ra2  - RA [deg]
 * @param {number} dec2 - Dec [deg]
 * @returns {number} separation [arcsec]
 */
function angularSeparationArcsec(ra1, dec1, ra2, dec2) {
    var d2r = Math.PI / 180;
    var dDec = (dec2 - dec1) * d2r;
    var dRa  = (ra2 - ra1) * d2r;
    var h = Math.sin(dDec / 2) * Math.sin(dDec / 2)
          + Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.sin(dRa / 2) * Math.sin(dRa / 2);
    if (h > 1) h = 1;
    return 2 * Math.asin(Math.sqrt(h)) / d2r * 3600;
}

/**
 * True when a frame is a raw CFA (not yet debayered) image: a single channel
 * carrying a Bayer pattern keyword. Debayered 3-channel images can keep the
 * keyword, so the channel count is part of the test.
 * @param {number} numberOfChannels
 * @param {string} bayerPattern - value of BAYERPAT / BAYERPATTERN ("" if absent)
 * @returns {boolean}
 */
function isCfaFrame(numberOfChannels, bayerPattern) {
    if (numberOfChannels !== 1) return false;
    if (typeof bayerPattern !== "string") return false;
    return bayerPattern.trim().length > 0;
}

/**
 * Explain why no SQM value could be computed. Returns null when nothing is
 * wrong. Messages are for the operator, so they name what to change and use no
 * internal variable names.
 * @param {{nUsedStarFrames: number, L_star: number, L_sky: number,
 *          L_prime_sky: number, distinctExposures: number}} info
 *   nUsedStarFrames   - frames that went into the star fit (saturated ones excluded)
 *   distinctExposures - distinct exposure times among those frames
 * @returns {string|null}
 */
function sqmFailureReason(info) {
    if (info.nUsedStarFrames < 2) {
        return "Fewer than 2 usable frames (frames with saturated star pixels are excluded)"
            + " \u2014 use shorter exposures or defocus the star more.";
    }
    if (info.distinctExposures < 2) {
        return "The usable frames all have the same exposure time \u2014"
            + " at least 2 different exposure times are needed.";
    }
    if (!(info.L_star > 0)) {
        return "The star's brightness does not increase with exposure time \u2014"
            + " check the star position (it may be off the star) or whether the star is too faint.";
    }
    if (!(info.L_sky > 0) || !(info.L_prime_sky > 0)) {
        return "The background brightness does not increase with exposure time \u2014"
            + " check the background region.";
    }
    return null;
}

// ============================================================
// Star centroid refinement (issue #22)
// ============================================================
// Thresholds. The detection gate (10 sigma, 5 pixels) is the same as the one in
// tests/pjsr/test_wcs_transform.js (MIN_DETECTION_SIGMA / MIN_SIGNIFICANT_PIXELS),
// where the reasoning is written down: a real star clears both by a wide margin,
// noise and hot pixels do not.
var CENTROID_PIXEL_SIGMA    = 3.0;  // a pixel counts as "star" above mean + 3 std of the local sky
var CENTROID_MIN_SIGMA      = 10;   // the peak must stand out at least this much (sigma)
var CENTROID_MIN_PIXELS     = 5;    // ...and at least this many pixels must be significant
var CENTROID_CONVERGE_PX    = 0.1;  // stop iterating when the center moves less than this
var CENTROID_MAX_ITER       = 3;    // hard limit on re-centering passes
var CENTROID_MAX_SHIFT_FRAC = 0.5;  // give up if the center moved more than aperture * this (probably another star)
var CENTROID_WARN_SHIFT_PX  = 3;    // frames corrected by more than this are reported to the user

/**
 * Intensity-weighted centroid of the significant pixels inside the aperture.
 * Pure function: no image access, so it can be tested in Node.
 * @param {{x:number,y:number,v:number}[]} pixels - aperture pixels (x, y = pixel CENTER coordinates)
 * @param {number} mean - local sky mean
 * @param {number} std  - local sky standard deviation
 * @returns {{ok:boolean, x:number, y:number, sigma:number, nSig:number, reason:(string|null)}}
 */
function significantPixelCentroid(pixels, mean, std) {
    var fail = function(reason, sigma, nSig) {
        return { ok: false, x: NaN, y: NaN, sigma: sigma, nSig: nSig, reason: reason };
    };
    if (!(std > 0) || pixels.length === 0) {
        return fail("The sky around the selected position could not be measured.", 0, 0);
    }
    var peak = -Infinity;
    var sw = 0, sx = 0, sy = 0, nSig = 0;
    for (var i = 0; i < pixels.length; i++) {
        var d = pixels[i].v - mean;
        if (pixels[i].v > peak) peak = pixels[i].v;
        if (d > CENTROID_PIXEL_SIGMA * std) {
            nSig++;
            sw += d;
            sx += d * pixels[i].x;
            sy += d * pixels[i].y;
        }
    }
    var sigma = (peak - mean) / std;
    if (!(sigma >= CENTROID_MIN_SIGMA)) {
        return fail("No star found near the selected position (brightest pixel is only "
            + sigma.toFixed(1) + " sigma above the sky).", sigma, nSig);
    }
    if (nSig < CENTROID_MIN_PIXELS) {
        return fail("No star found near the selected position (only " + nSig
            + " bright pixels).", sigma, nSig);
    }
    return { ok: true, x: sx / sw, y: sy / sw, sigma: sigma, nSig: nSig, reason: null };
}

// ============================================================
// Atmospheric extinction (issue #12)
// ============================================================
// The reference star is measured through the atmosphere, but its catalog V
// magnitude is the value outside it. The star looks fainter by k * X, so
// SQM_raw comes out k * X too bright (too small a number). The corrected value
// is the sky brightness as seen from the ground: SQM = SQM_raw + k * X.

var EXTINCTION_K_DEFAULT = 0.20;  // mag/airmass
var MIN_ALTITUDE_DEG     = 10;    // lower than this, the airmass formula is not trusted
var HIGH_AIRMASS_WARN    = 2.0;   // about 30 degrees of altitude

/**
 * Parse an angle given as a decimal number or as a sexagesimal string
 * ("+38 55 17.0", "38:55:17", "-12 30"). Returns degrees, or NaN.
 * @param {string|number} str
 * @returns {number}
 */
function parseSexagesimal(str) {
    if (typeof str === "number") return isFinite(str) ? str : NaN;
    if (typeof str !== "string") return NaN;
    var s = str.trim().replace(/^'|'$/g, "").trim();
    if (s === "") return NaN;
    // Plain number (FITS also allows a D exponent)
    var single = s.replace(/[dD]/, "e");
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(single)) return parseFloat(single);
    var negative = (s.charAt(0) === "-");
    var body = s.replace(/^[+-]/, "").trim();
    var parts = body.split(/[\s:]+/);
    if (parts.length < 2 || parts.length > 3) return NaN;
    var nums = [];
    for (var i = 0; i < parts.length; i++) {
        var isLast = (i === parts.length - 1);
        var re = isLast ? /^(\d+\.?\d*|\.\d+)$/ : /^\d+$/;
        if (!re.test(parts[i])) return NaN;
        nums.push(parseFloat(parts[i]));
    }
    if (nums[1] >= 60) return NaN;
    if (nums.length === 3 && nums[2] >= 60) return NaN;
    var v = nums[0] + nums[1] / 60 + (nums.length === 3 ? nums[2] / 3600 : 0);
    return negative ? -v : v;
}

/**
 * Parse a FITS date-time as UTC. Accepts "YYYY-MM-DDThh:mm:ss[.fff][Z]" (a space
 * may replace the T). A date without a time is accepted only when timeStr
 * ("hh:mm:ss[.fff]", the TIME-OBS keyword) supplies one: midnight would be a
 * wrong time of exposure, so a bare date gives NaN.
 * @param {string} dateStr
 * @param {string} [timeStr]
 * @returns {number} milliseconds since 1970-01-01T00:00:00 UTC, or NaN
 */
function parseFitsDateTime(dateStr, timeStr) {
    if (typeof dateStr !== "string") return NaN;
    var s = dateStr.trim().replace(/^'|'$/g, "").trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}(?:\.\d*)?|\.\d+))?\s*Z?$/i.exec(s);
    if (!m) return NaN;
    var hh = m[4], mi = m[5], ss = m[6];
    if (hh === undefined) {
        if (typeof timeStr !== "string") return NaN;
        var t = timeStr.trim().replace(/^'|'$/g, "").trim();
        var tm = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)\s*Z?$/i.exec(t);
        if (!tm) return NaN;
        hh = tm[1]; mi = tm[2]; ss = tm[3];
    }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    var h = parseInt(hh, 10), mn = parseInt(mi, 10), sec = parseFloat(ss);
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mn > 59 || !(sec < 61)) return NaN;
    var dayMs = Date.UTC(y, mo - 1, d);
    if (new Date(dayMs).getUTCDate() !== d) return NaN;  // 02-30 and the like
    return dayMs + h * 3600000 + mn * 60000 + sec * 1000;
}

/**
 * Middle of the exposure of one frame, from FITS keyword strings.
 * Order: DATE-AVG; the midpoint of DATE-OBS and DATE-END; DATE-OBS with EXPTIME.
 * In the last case DATE-OBS is the start of the exposure (FITS standard), unless
 * its comment contains "end" (DWARF writes "Time end of exposure"): then it is
 * the end, and half of EXPTIME is subtracted.
 * @param {{dateAvg:?string, dateObs:?string, timeObs:?string, dateObsComment:?string,
 *          dateEnd:?string, exptime:number}} k
 * @returns {{ms:number, source:string}|null}
 */
function frameMidTime(k) {
    var avg = parseFitsDateTime(k.dateAvg);
    if (isFinite(avg)) return { ms: avg, source: "DATE-AVG" };

    var start = parseFitsDateTime(k.dateObs, k.timeObs);
    var end   = parseFitsDateTime(k.dateEnd);
    if (isFinite(start) && isFinite(end) && end >= start) {
        return { ms: (start + end) / 2, source: "midpoint of DATE-OBS and DATE-END" };
    }
    if (isFinite(start) && typeof k.exptime === "number" && k.exptime > 0) {
        var comment = (typeof k.dateObsComment === "string") ? k.dateObsComment : "";
        if (/end/i.test(comment)) {
            return { ms: start - k.exptime * 500, source: "DATE-OBS (end of exposure) minus half of EXPTIME" };
        }
        return { ms: start + k.exptime * 500, source: "DATE-OBS plus half of EXPTIME" };
    }
    return null;
}

/**
 * Observing site from FITS keyword strings (degrees, east longitude positive).
 * Order: SITELAT/SITELONG, then OBSGEO-B/OBSGEO-L. A pair is used only when
 * both values are valid. Longitude is folded into [-180, 180].
 * @param {{sitelat:?string, sitelong:?string, obsgeoB:?string, obsgeoL:?string}} k
 * @returns {{lat:number, lon:number, source:string}|null}
 */
function siteFromKeywords(k) {
    var pairs = [
        { a: k.sitelat, b: k.sitelong, source: "SITELAT/SITELONG" },
        { a: k.obsgeoB, b: k.obsgeoL,  source: "OBSGEO-B/OBSGEO-L" }
    ];
    for (var i = 0; i < pairs.length; i++) {
        var lat = parseSexagesimal(pairs[i].a);
        var lon = parseSexagesimal(pairs[i].b);
        if (!isFinite(lat) || !isFinite(lon)) continue;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 360) continue;
        if (lon > 180) lon -= 360;
        return { lat: lat, lon: lon, source: pairs[i].source };
    }
    return null;
}

/**
 * Site to use for a frame: the one from its header, else the manual entry.
 * @param {{lat:number, lon:number, source:string}|null} headerSite
 * @param {{lat:number, lon:number}|null} manualSite
 * @returns {{lat:number, lon:number, source:string}|null}
 */
function chooseSite(headerSite, manualSite) {
    if (headerSite) return headerSite;
    if (manualSite && isFinite(manualSite.lat) && isFinite(manualSite.lon)
        && manualSite.lat >= -90 && manualSite.lat <= 90
        && manualSite.lon >= -180 && manualSite.lon <= 360) {
        var lon = manualSite.lon > 180 ? manualSite.lon - 360 : manualSite.lon;
        return { lat: manualSite.lat, lon: lon, source: "manual entry" };
    }
    return null;
}

/**
 * Julian Date from milliseconds since the Unix epoch (UTC).
 * @param {number} ms
 * @returns {number}
 */
function julianDateFromMs(ms) {
    return ms / 86400000 + 2440587.5;
}

/**
 * Mean Greenwich sidereal time [degrees, 0..360) at a Julian Date
 * (Meeus, Astronomical Algorithms, formula 12.4).
 * @param {number} jd
 * @returns {number}
 */
function gmstDegrees(jd) {
    var T = (jd - 2451545.0) / 36525;
    var th = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * T * T - T * T * T / 38710000;
    th = th % 360;
    return th < 0 ? th + 360 : th;
}

/**
 * Altitude [degrees] of a point on the sky (no refraction).
 * @param {number} raDeg   - right ascension [deg]
 * @param {number} decDeg  - declination [deg]
 * @param {number} latDeg  - site latitude [deg, north positive]
 * @param {number} lonDeg  - site longitude [deg, EAST positive]
 * @param {number} jd      - Julian Date (UT)
 * @returns {number}
 */
function altitudeDeg(raDeg, decDeg, latDeg, lonDeg, jd) {
    var D = Math.PI / 180;
    var lst = gmstDegrees(jd) + lonDeg;     // local sidereal time
    var H = (lst - raDeg) * D;              // hour angle
    var sinH = Math.sin(latDeg * D) * Math.sin(decDeg * D)
        + Math.cos(latDeg * D) * Math.cos(decDeg * D) * Math.cos(H);
    sinH = Math.max(-1, Math.min(1, sinH));
    return Math.asin(sinH) / D;
}

/**
 * Relative air mass, Kasten & Young (1989):
 *   X = 1 / (sin h + 0.50572 (h + 6.07995)^-1.6364), h in degrees.
 * Returns NaN below MIN_ALTITUDE_DEG or when h is not a finite number.
 * @param {number} hDeg
 * @returns {number}
 */
function airmassKastenYoung(hDeg) {
    if (typeof hDeg !== "number" || !isFinite(hDeg) || hDeg < MIN_ALTITUDE_DEG) return NaN;
    var s = Math.sin(hDeg * Math.PI / 180);
    return 1 / (s + 0.50572 * Math.pow(hDeg + 6.07995, -1.6364));
}

/**
 * Altitude and air mass of the star in one frame.
 * Coordinates are used as given (J2000, no precession: about 22 arcmin in 2026,
 * well under 0.01 mag in the correction).
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {{lat:number, lon:number}|null} site
 * @param {number} ms - middle of the exposure, ms since the Unix epoch (UTC)
 * @returns {{altitude:number, airmass:number}}
 */
function frameAirmass(raDeg, decDeg, site, ms) {
    if (!site || !isFinite(ms) || !isFinite(raDeg) || !isFinite(decDeg)) {
        return { altitude: NaN, airmass: NaN };
    }
    var alt = altitudeDeg(raDeg, decDeg, site.lat, site.lon, julianDateFromMs(ms));
    return { altitude: alt, airmass: airmassKastenYoung(alt) };
}

/**
 * Correction [mag] to add to SQM_raw.
 * @param {number} k - extinction coefficient [mag/airmass]
 * @param {number} X - air mass
 * @returns {number}
 */
function extinctionCorrectionMag(k, X) {
    return k * X;
}

/**
 * Mean, minimum and maximum of the finite values.
 * @param {number[]} values
 * @returns {{count:number, mean:number, min:number, max:number}}
 */
function summarizeAirmass(values) {
    var n = 0, sum = 0, lo = Infinity, hi = -Infinity;
    for (var i = 0; i < values.length; i++) {
        var v = values[i];
        if (typeof v !== "number" || !isFinite(v)) continue;
        n++; sum += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    if (n === 0) return { count: 0, mean: NaN, min: NaN, max: NaN };
    return { count: n, mean: sum / n, min: lo, max: hi };
}

/**
 * Decide whether the extinction correction can be applied, and by how much.
 * Messages are for the operator: they say what to do and use no internal names.
 * @param {{enabled:boolean, k:number, hasStar:boolean, airmasses:number[],
 *          nWithTime:number, nWithSite:number}} info
 *   airmasses - air mass of each frame that went into the star fit (NaN when unknown)
 *   nWithTime - how many of those frames have a usable time of exposure
 *   nWithSite - how many of those frames have an observing site
 * @returns {{corrected:boolean, reason:(string|null), k:number, correction:number,
 *            airmass:{count:number, mean:number, min:number, max:number},
 *            warnings:string[]}}
 */
function decideExtinction(info) {
    var stats = summarizeAirmass(info.airmasses);
    var out = { corrected: false, reason: null, k: info.k, correction: 0, airmass: stats, warnings: [] };
    if (!info.enabled) {
        out.reason = "Correction is turned off.";
    } else if (!(typeof info.k === "number" && isFinite(info.k) && info.k >= 0)) {
        out.reason = "The extinction coefficient is not a valid number.";
    } else if (!info.hasStar) {
        out.reason = "The sky position of the reference star is unknown"
            + " — pick the star from the catalog list in a plate-solved frame, or search it by name.";
    } else if (info.airmasses.length === 0) {
        out.reason = "No frame was usable for the star measurement, so there is no air mass to correct for.";
    } else if (info.nWithTime === 0) {
        out.reason = "No time of exposure in the frame headers"
            + " (DATE-AVG, DATE-OBS with DATE-END, or DATE-OBS with EXPTIME).";
    } else if (info.nWithSite === 0) {
        out.reason = "No observing site: the frame headers have none and no latitude/longitude was entered.";
    } else if (stats.count === 0) {
        out.reason = "The star was lower than " + MIN_ALTITUDE_DEG + " degrees above the horizon in every frame.";
    }
    if (out.reason !== null) return out;

    out.corrected = true;
    out.correction = extinctionCorrectionMag(info.k, stats.mean);
    if (stats.max > HIGH_AIRMASS_WARN) {
        out.warnings.push("The star was low in the sky (air mass up to " + stats.max.toFixed(2)
            + ", altitude below about 30 degrees): the extinction correction is large and uncertain.");
    }
    if (stats.count < info.airmasses.length) {
        out.warnings.push("The air mass is known for only " + stats.count + " of "
            + info.airmasses.length + " frames used for the star; the correction uses their mean.");
    }
    return out;
}

// ============================================================
// Node.js export
// ============================================================

if (typeof module !== "undefined") {
    module.exports = {
        MAX_SAT_FRACTION:    MAX_SAT_FRACTION,
        sigmaClippingStats:  sigmaClippingStats,
        median:              median,
        standardDeviation:   standardDeviation,
        linearFit:           linearFit,
        computeLSky:         computeLSky,
        computeLStar:        computeLStar,
        computeLPrimeSky:    computeLPrimeSky,
        computeSQM:          computeSQM,
        computePixelScale:   computePixelScale,
        choosePixelScale:    choosePixelScale,
        PIXEL_SCALE_WARN_FRAC: PIXEL_SCALE_WARN_FRAC,
        skyConditionLabel:   skyConditionLabel,
        normalizedToADU:     normalizedToADU,
        maxADUFor:           maxADUFor,
        countDistinctExposures: countDistinctExposures,
        angularSeparationArcsec: angularSeparationArcsec,
        isCfaFrame:          isCfaFrame,
        sqmFailureReason:    sqmFailureReason,
        significantPixelCentroid: significantPixelCentroid,
        CENTROID_WARN_SHIFT_PX:   CENTROID_WARN_SHIFT_PX,
        CENTROID_MIN_SIGMA:       CENTROID_MIN_SIGMA,
        CENTROID_MIN_PIXELS:      CENTROID_MIN_PIXELS,
        EXTINCTION_K_DEFAULT:     EXTINCTION_K_DEFAULT,
        MIN_ALTITUDE_DEG:         MIN_ALTITUDE_DEG,
        HIGH_AIRMASS_WARN:        HIGH_AIRMASS_WARN,
        parseSexagesimal:         parseSexagesimal,
        parseFitsDateTime:        parseFitsDateTime,
        frameMidTime:             frameMidTime,
        siteFromKeywords:         siteFromKeywords,
        chooseSite:               chooseSite,
        julianDateFromMs:         julianDateFromMs,
        gmstDegrees:              gmstDegrees,
        altitudeDeg:              altitudeDeg,
        airmassKastenYoung:       airmassKastenYoung,
        frameAirmass:             frameAirmass,
        extinctionCorrectionMag:  extinctionCorrectionMag,
        summarizeAirmass:         summarizeAirmass,
        decideExtinction:         decideExtinction
    };
}
