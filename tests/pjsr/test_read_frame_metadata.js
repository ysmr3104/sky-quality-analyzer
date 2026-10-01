#engine v8
// test_read_frame_metadata.js
// PJSR test: readFrameMetadata() — EXPTIME, isColor, WCS loading from XISF files
//
// Run:
//   bash tests/pjsr/run_pjsr_tests.sh tests/pjsr/test_read_frame_metadata.js

var __SQA_LIBRARY_MODE = true;
#include "../../javascript/SkyQualityAnalyzer.js"
#include "pjsr_test_framework.js"

var PROJECT_ROOT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__) + "/../../";
var FIXTURE_DIR  = PROJECT_ROOT + "tests/fixtures/xisf/";
var RESULT_PATH  = PROJECT_ROOT + "tests/pjsr/results/test_read_frame_metadata_result.json";

// Expected values derived from the Kochab test frames (ASI294MC Pro, debayered)
var FIXTURES = [
    { file: "Light_Kochab_1.0s_Bin1_294MC_IRUV_gain120_20260327-000325_356deg_-10.0C_0005_c_d.xisf",  exptime: 1.0  },
    { file: "Light_Kochab_2.0s_Bin1_294MC_IRUV_gain120_20260327-000418_356deg_-10.0C_0005_c_d.xisf",  exptime: 2.0  },
    { file: "Light_Kochab_4.0s_Bin1_294MC_IRUV_gain120_20260327-000520_356deg_-10.0C_0005_c_d.xisf",  exptime: 4.0  },
    { file: "Light_Kochab_6.0s_Bin1_294MC_IRUV_gain120_20260327-000631_356deg_-10.0C_0005_c_d.xisf",  exptime: 6.0  },
    { file: "Light_Kochab_8.0s_Bin1_294MC_IRUV_gain120_20260327-000808_356deg_-10.0C_0005_c_d.xisf",  exptime: 8.0  },
    { file: "Light_Kochab_10.0s_Bin1_294MC_IRUV_gain120_20260327-001000_359deg_-10.0C_0005_c_d.xisf", exptime: 10.0 }
];

// ============================================================
// readFrameMetadata: exptime
// ============================================================
for (var i = 0; i < FIXTURES.length; i++) {
    (function(fx) {
        test("readFrameMetadata: exptime=" + fx.exptime + "s", function() {
            var meta = readFrameMetadata(FIXTURE_DIR + fx.file);
            assertTrue(meta !== null, "readFrameMetadata returned null");
            assertEqual(meta.exptime, fx.exptime, "exptime", 0.001);
        });
    })(FIXTURES[i]);
}

// ============================================================
// readFrameMetadata: isColor (debayered RGB = true)
// ============================================================
test("readFrameMetadata: isColor=true for debayered XISF", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertTrue(meta.isColor, "debayered XISF should be isColor=true");
});

// ============================================================
// readFrameMetadata: hasWcs — native astrometric solution flag
// ============================================================
test("readFrameMetadata: hasWcs=true for plate-solved XISF", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertEqual(meta.hasWcs, true, "hasWcs should be true for a plate-solved WBPP frame");
});

// ============================================================
// readFrameMetadata: isReal / isCfa
// ============================================================
test("readFrameMetadata: isCfa=false for debayered 3-channel XISF (BAYERPAT may remain)", function() {
    // Record whether the fixture really carries BAYERPAT, so this test shows
    // whether it exercised the channel-count branch or just a missing keyword.
    var wins = ImageWindow.open(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    var bayer = null;
    try {
        bayer = getFITSKeyword(wins[0].keywords, "BAYERPAT");
    } finally {
        wins[0].forceClose();
    }
    log("  fixture BAYERPAT raw value = " + (bayer === null ? "(absent)" : bayer));

    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertEqual(meta.isCfa, false, "debayered 3-channel frame must not be flagged as CFA");
});

// A real CFA path through readFrameMetadata(): write a 1-channel image with a
// quoted BAYERPAT (as capture software writes it) to a temporary XISF, read it
// back, and expect isCfa = true. Also check the 1-channel image without the
// keyword stays a normal (mono) frame.
function writeTempFrame(path, withBayer) {
    var w = new ImageWindow(64, 48, 1, 32, true, false, "sqa_cfa_probe");
    try {
        var kws = [ new FITSKeyword("EXPTIME", "2.0", "Exposure time [s]") ];
        if (withBayer) kws.push(new FITSKeyword("BAYERPAT", "'RGGB'", "Bayer pattern"));
        w.keywords = kws;
        assertTrue(w.saveAs(path, false, false, false, false), "saveAs failed: " + path);
    } finally {
        w.forceClose();
    }
}

test("readFrameMetadata: isCfa=true for a 1-channel frame with BAYERPAT='RGGB'", function() {
    var path = File.systemTempDirectory + "/sqa_cfa_probe.xisf";
    writeTempFrame(path, true);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  1-channel + BAYERPAT: isCfa=" + meta.isCfa);
        assertEqual(meta.isCfa, true, "1-channel frame with BAYERPAT must be flagged as CFA");
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

test("readFrameMetadata: isCfa=false for a 1-channel frame without BAYERPAT (mono)", function() {
    var path = File.systemTempDirectory + "/sqa_mono_probe.xisf";
    writeTempFrame(path, false);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  1-channel, no BAYERPAT: isCfa=" + meta.isCfa + "  exptime=" + meta.exptime);
        assertEqual(meta.isCfa, false, "mono frame must not be flagged as CFA");
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

test("readFrameMetadata: isReal=true for the floating-point Kochab frames", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    log("  isReal=" + meta.isReal + "  bitsPerSample=" + meta.bitsPerSample);
    assertEqual(meta.isReal, true, "isReal should be true");
});

// ============================================================
// readFrameMetadata: wcsPixelScale / headerPixelScale (issue #14)
// ============================================================
test("readFrameMetadata: wcsPixelScale is about 3.82 arcsec/px for the Kochab frames", function() {
    // Nominal: ASI294MC 4.63 um + RedCat 51 250 mm = 3.82 arcsec/px
    for (var i = 0; i < FIXTURES.length; i++) {
        var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[i].file);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  " + FIXTURES[i].exptime + "s: wcsPixelScale=" + meta.wcsPixelScale
            + "  headerPixelScale=" + meta.headerPixelScale);
        assertTrue(isFinite(meta.wcsPixelScale), "wcsPixelScale must be finite");
        assertEqual(meta.wcsPixelScale, 3.82, "wcsPixelScale", 3.82 * 0.03);
    }
});

test("readFrameMetadata: wcsPixelScale and headerPixelScale agree (3.82 +-3%, mutual difference <= 2%) on all Kochab frames", function() {
    // The fixtures carry XPIXSZ and FOCALLEN, so a header scale of 0 is a failure.
    for (var i = 0; i < FIXTURES.length; i++) {
        var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[i].file);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        assertTrue(meta.headerPixelScale > 0, FIXTURES[i].file + ": headerPixelScale is 0 (XPIXSZ / FOCALLEN not read)");
        assertTrue(meta.wcsPixelScale > 0, FIXTURES[i].file + ": wcsPixelScale is 0");
        var rel = Math.abs(meta.headerPixelScale - meta.wcsPixelScale) / meta.wcsPixelScale;
        log("  " + FIXTURES[i].exptime + "s: header=" + meta.headerPixelScale + "  wcs=" + meta.wcsPixelScale + "  relative difference=" + rel);
        assertEqual(meta.wcsPixelScale, 3.82, "wcsPixelScale", 3.82 * 0.03);
        assertEqual(meta.headerPixelScale, 3.82, "headerPixelScale", 3.82 * 0.03);
        assertTrue(rel <= 0.02, FIXTURES[i].file + ": header and WCS pixel scales differ by more than 2%");
    }
});

// XPIXSZ=2.0 um, FOCALLEN=150 mm, XBINNING=2, no astrometric solution:
// 2.0 / 150 * 206.265 = 2.750 arcsec/px. XBINNING must NOT be multiplied in
// (XPIXSZ already includes it), so 5.500 would be wrong.
test("readFrameMetadata: headerPixelScale ignores XBINNING; wcsPixelScale is 0 without a solution", function() {
    var path = File.systemTempDirectory + "/sqa_header_scale_probe.xisf";
    var w = new ImageWindow(64, 48, 1, 32, true, false, "sqa_header_scale_probe");
    try {
        w.keywords = [
            new FITSKeyword("EXPTIME", "2.0", "Exposure time [s]"),
            new FITSKeyword("XPIXSZ", "2.0", "Pixel size [um], binning included"),
            new FITSKeyword("FOCALLEN", "150", "Focal length [mm]"),
            new FITSKeyword("XBINNING", "2", "Binning")
        ];
        assertTrue(w.saveAs(path, false, false, false, false), "saveAs failed: " + path);
    } finally {
        w.forceClose();
    }
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  headerPixelScale=" + meta.headerPixelScale + "  wcsPixelScale=" + meta.wcsPixelScale + "  hasWcs=" + meta.hasWcs);
        assertEqual(meta.headerPixelScale, 2.750, "headerPixelScale", 0.001);
        assertEqual(meta.wcsPixelScale, 0, "wcsPixelScale without a solution", 0);
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

// ============================================================
// readFrameMetadata: time of exposure and observing site (issue #12)
// The fixtures carry the real observing site and date of the photographer.
// This test never writes those values to the log: only the source of each
// value and whether it passed a range check.
// ============================================================
var KOCHAB_RA  = 222.676357;
var KOCHAB_DEC = 74.155505;

// Write a 1-channel temporary XISF with the given FITS keywords.
function writeTempFrameWithKeywords(path, keywords) {
    var w = new ImageWindow(64, 48, 1, 32, true, false, "sqa_extinction_probe");
    try {
        w.keywords = keywords;
        assertTrue(w.saveAs(path, false, false, false, false), "saveAs failed: " + path);
    } finally {
        w.forceClose();
    }
}

// Keyword of a fixture, read with the same helper readFrameMetadata() uses.
function fixtureKeywordValue(file, name) {
    var wins = ImageWindow.open(FIXTURE_DIR + file);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    try {
        return getFITSKeyword(wins[0].keywords, name);
    } finally {
        wins[0].forceClose();
    }
}

test("readFrameMetadata: middle of the exposure equals DATE-OBS + EXPTIME/2 (0.01 s) on all Kochab frames", function() {
    for (var i = 0; i < FIXTURES.length; i++) {
        var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[i].file);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        assertTrue(isFinite(meta.midTimeMs), FIXTURES[i].exptime + "s: no middle time was found");
        var obs = parseFitsDateTime(fixtureKeywordValue(FIXTURES[i].file, "DATE-OBS"),
                                    fixtureKeywordValue(FIXTURES[i].file, "TIME-OBS"));
        assertTrue(isFinite(obs), FIXTURES[i].exptime + "s: DATE-OBS of the fixture is not readable");
        var diffS = Math.abs(meta.midTimeMs - (obs + FIXTURES[i].exptime * 500)) / 1000;
        log("  " + FIXTURES[i].exptime + "s: time source=" + meta.timeSource + "  |mid - (DATE-OBS + EXPTIME/2)|=" + diffS.toFixed(4) + " s");
        assertTrue(diffS <= 0.01, FIXTURES[i].exptime + "s: middle time differs from DATE-OBS + EXPTIME/2 by " + diffS + " s");
    }
});

test("readFrameMetadata: observing site is a finite value in range, taken from OBSGEO, on all Kochab frames", function() {
    for (var i = 0; i < FIXTURES.length; i++) {
        var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[i].file);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        assertTrue(meta.site !== null, FIXTURES[i].exptime + "s: no observing site was found");
        var ok = isFinite(meta.site.lat) && isFinite(meta.site.lon)
            && meta.site.lat >= -90 && meta.site.lat <= 90
            && meta.site.lon >= -180 && meta.site.lon <= 180;
        log("  " + FIXTURES[i].exptime + "s: site source=" + meta.site.source + "  finite and in range=" + ok);
        assertTrue(ok, FIXTURES[i].exptime + "s: site is not a finite value in range");
        assertTrue(meta.site.source.indexOf("OBSGEO") >= 0, "site source is not OBSGEO: " + meta.site.source);
    }
});

test("readFrameMetadata: Kochab air mass is between 1.0 and 3.5 in every Kochab frame", function() {
    var xs = [];
    for (var i = 0; i < FIXTURES.length; i++) {
        var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[i].file);
        assertTrue(meta !== null && meta.site !== null && isFinite(meta.midTimeMs), "frame lacks site or time");
        var fa = frameAirmass(KOCHAB_RA, KOCHAB_DEC, meta.site, meta.midTimeMs);
        assertTrue(isFinite(fa.airmass), FIXTURES[i].exptime + "s: air mass is not finite");
        assertTrue(fa.airmass >= 1.0 && fa.airmass <= 3.5, FIXTURES[i].exptime + "s: air mass out of range");
        xs.push(fa.airmass);
    }
    var sm = summarizeAirmass(xs);
    log("  Kochab air mass over " + sm.count + " frames: mean=" + sm.mean.toFixed(4)
        + "  min=" + sm.min.toFixed(4) + "  max=" + sm.max.toFixed(4));
    var k = EXTINCTION_K_DEFAULT;
    log("  correction with k=" + k + ": +" + extinctionCorrectionMag(k, sm.mean).toFixed(4) + " mag");
});

// DWARF type: DATE-OBS is the END of the exposure (its comment says so) and
// there is no observing site. 10 s exposure ending at 04:05:16 -> middle 04:05:11.
test("readFrameMetadata: DWARF-style frame (DATE-OBS comment 'Time end of exposure', no site)", function() {
    var path = File.systemTempDirectory + "/sqa_dwarf_probe.xisf";
    writeTempFrameWithKeywords(path, [
        new FITSKeyword("EXPTIME", "10.0", "Exposure time [s]"),
        new FITSKeyword("DATE-OBS", "'2001-02-03T04:05:16.000'", "Time end of exposure")
    ]);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  DWARF-style: time source=" + meta.timeSource + "  site=" + (meta.site === null ? "none" : meta.site.source));
        assertEqual(meta.midTimeMs, Date.UTC(2001, 1, 3, 4, 5, 11), "middle of the exposure", 1);
        assertTrue(meta.timeSource.indexOf("end of exposure") >= 0, "time source: " + meta.timeSource);
        assertTrue(meta.site === null, "a DWARF-style frame has no site");
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

// The same keyword with a start-of-exposure comment must be treated as the start.
test("readFrameMetadata: DATE-OBS without 'end' in its comment is the start of the exposure", function() {
    var path = File.systemTempDirectory + "/sqa_start_probe.xisf";
    writeTempFrameWithKeywords(path, [
        new FITSKeyword("EXPTIME", "10.0", "Exposure time [s]"),
        new FITSKeyword("DATE-OBS", "'2001-02-03T04:05:06.000'", "UTC date at start of observation")
    ]);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  start-style: time source=" + meta.timeSource);
        assertEqual(meta.midTimeMs, Date.UTC(2001, 1, 3, 4, 5, 11), "middle of the exposure", 1);
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

// N.I.N.A. type: SITELAT / SITELONG as sexagesimal strings, DATE-OBS the start.
// Site: 38 55 17 N, 77 03 56 W (the public Meeus example).
test("readFrameMetadata: N.I.N.A.-style frame (SITELAT/SITELONG as sexagesimal strings)", function() {
    var path = File.systemTempDirectory + "/sqa_nina_probe.xisf";
    writeTempFrameWithKeywords(path, [
        new FITSKeyword("EXPTIME", "20.0", "Exposure time [s]"),
        new FITSKeyword("DATE-OBS", "'2001-02-03T04:05:06.000'", "Time of observation"),
        new FITSKeyword("SITELAT", "'+38 55 17.0'", "Observation site latitude"),
        new FITSKeyword("SITELONG", "'-77 03 56.0'", "Observation site longitude")
    ]);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        assertTrue(meta.site !== null, "site was not read");
        log("  N.I.N.A.-style: site source=" + meta.site.source + "  time source=" + meta.timeSource);
        assertEqual(meta.site.lat, 38 + 55 / 60 + 17 / 3600, "latitude", 1e-6);
        assertEqual(meta.site.lon, -(77 + 3 / 60 + 56 / 3600), "longitude (east positive)", 1e-6);
        assertTrue(meta.site.source.indexOf("SITELAT") >= 0, "site source: " + meta.site.source);
        assertEqual(meta.midTimeMs, Date.UTC(2001, 1, 3, 4, 5, 16), "middle of the exposure", 1);
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

// DATE-OBS (date only) + TIME-OBS, with decimal OBSGEO and DATE-AVG absent.
test("readFrameMetadata: DATE-OBS (date only) + TIME-OBS and decimal OBSGEO-B/OBSGEO-L", function() {
    var path = File.systemTempDirectory + "/sqa_split_probe.xisf";
    writeTempFrameWithKeywords(path, [
        new FITSKeyword("EXPTIME", "10.0", "Exposure time [s]"),
        new FITSKeyword("DATE-OBS", "'2001-02-03'", "Date of observation"),
        new FITSKeyword("TIME-OBS", "'04:05:06'", "Start time of observation"),
        new FITSKeyword("OBSGEO-B", "38.921389", "Latitude [deg]"),
        new FITSKeyword("OBSGEO-L", "-77.065556", "Longitude [deg]")
    ]);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        assertTrue(meta.site !== null, "site was not read");
        log("  split-style: site source=" + meta.site.source + "  time source=" + meta.timeSource);
        assertEqual(meta.midTimeMs, Date.UTC(2001, 1, 3, 4, 5, 11), "middle of the exposure", 1);
        assertEqual(meta.site.lat, 38.921389, "latitude", 1e-6);
        assertEqual(meta.site.lon, -77.065556, "longitude", 1e-6);
        assertTrue(meta.site.source.indexOf("OBSGEO") >= 0, "site source: " + meta.site.source);
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

// No date at all: the frame is still read, with no middle time.
test("readFrameMetadata: no date keywords gives midTimeMs = NaN and site = null (frame still read)", function() {
    var path = File.systemTempDirectory + "/sqa_nodate_probe.xisf";
    writeTempFrameWithKeywords(path, [ new FITSKeyword("EXPTIME", "10.0", "Exposure time [s]") ]);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        assertTrue(isNaN(meta.midTimeMs), "midTimeMs should be NaN");
        assertTrue(meta.timeSource === null && meta.site === null, "no source expected");
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

runAllTests(RESULT_PATH);
