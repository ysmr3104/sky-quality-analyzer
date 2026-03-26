// sqm_math.js - Sky Quality Analyzer math library
// Compatible with PixInsight PJSR and Node.js
// ES5 style: var, function declarations only (no let/const/arrow functions)

// ============================================================
// Sigma-clipping statistics
// ============================================================

/**
 * Compute sigma-clipped median and standard deviation of an array.
 * @param {number[]} values - Input array of pixel values
 * @param {number} sigma    - Clipping threshold in units of std dev (default 3.0)
 * @param {number} maxIter  - Maximum iterations (default 5)
 * @returns {{median: number, std: number, count: number}}
 */
function sigmaClippingStats(values, sigma, maxIter) {
    if (sigma === undefined) sigma = 3.0;
    if (maxIter === undefined) maxIter = 5;

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
    return { median: finalMed, std: finalStd, count: data.length };
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
 * @param {{exptime: number, adu_star: number}[]} frames
 * @returns {{L_star: number, r2: number}}
 */
function computeLStar(frames) {
    var tValues = [];
    var adValues = [];
    for (var i = 0; i < frames.length; i++) {
        tValues.push(frames[i].exptime);
        adValues.push(frames[i].adu_star);
    }
    var fit = linearFit(tValues, adValues);
    return { L_star: fit.slope, r2: fit.r2 };
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
 * Return a descriptive sky condition label for a given SQM value.
 * @param {number} sqm
 * @returns {string}
 */
function skyConditionLabel(sqm) {
    if (sqm >= 22.0) return "完璧な暗黒空";
    if (sqm >= 21.5) return "真の暗黒空";
    if (sqm >= 21.0) return "優良（農村の空）";
    if (sqm >= 20.0) return "良好（郊外の空）";
    if (sqm >= 19.0) return "普通";
    if (sqm >= 18.0) return "光害あり（明るい郊外）";
    return "都市部";
}

/**
 * Convert PixInsight normalized pixel value (0-1) to ADU.
 * @param {number} normalized   - PixInsight sample value [0, 1]
 * @param {number} bitsPerSample - Bit depth (16 or 32)
 * @returns {number} ADU value
 */
function normalizedToADU(normalized, bitsPerSample) {
    var maxADU = (bitsPerSample === 32) ? 4294967295 : 65535;
    return normalized * maxADU;
}

// ============================================================
// Node.js export
// ============================================================

if (typeof module !== "undefined") {
    module.exports = {
        sigmaClippingStats:  sigmaClippingStats,
        median:              median,
        standardDeviation:   standardDeviation,
        linearFit:           linearFit,
        computeLSky:         computeLSky,
        computeLStar:        computeLStar,
        computeLPrimeSky:    computeLPrimeSky,
        computeSQM:          computeSQM,
        computePixelScale:   computePixelScale,
        skyConditionLabel:   skyConditionLabel,
        normalizedToADU:     normalizedToADU
    };
}
