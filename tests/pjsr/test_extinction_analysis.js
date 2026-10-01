#engine v8
// test_extinction_analysis.js
// PJSR test: the atmospheric extinction correction (issue #12) through
// runAnalysis() and exportCSV(), on the Kochab frames.
// The frames carry the real observing site and date of the photographer: the
// test never writes those values to the log, only counts, sources and air masses.
//
// Run:
//   bash tests/pjsr/run_pjsr_tests.sh tests/pjsr/test_extinction_analysis.js

var __SQA_LIBRARY_MODE = true;
#include "../../javascript/SkyQualityAnalyzer.js"
#include "pjsr_test_framework.js"

var PROJECT_ROOT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__) + "/../../";
var FIXTURE_DIR  = PROJECT_ROOT + "tests/fixtures/xisf/";
var RESULT_PATH  = PROJECT_ROOT + "tests/pjsr/results/test_extinction_analysis_result.json";

// HD 136919 (V=6.68), J2000, the same star as in test_aperture_photometry.js.
// Kochab itself saturates in all six frames, so none would be used for the
// star fit and there would be no air mass to average.
var STAR_RA  = 229.34424277666997;
var STAR_DEC = 74.04514025971;
var APERTURE   = 15;
var STAR_V   = 6.68;

// The Kochab frames, found by name pattern (file names carry the date of the session).
var FRAME_PATHS = File.searchDirectory(FIXTURE_DIR + "Light_Kochab_*_c_d.xisf");
FRAME_PATHS.sort();

var CAMERA = { name: "test", sqm_channel: "G" };
var PIXEL_INFO = { scale: 3.82, source: "wcs", dbScale: 0, dbMismatch: NaN, spread: 0 };

function loadFrames() {
    var frames = [];
    assertTrue(FRAME_PATHS.length === 6, "expected 6 Kochab fixture frames, found " + FRAME_PATHS.length);
    for (var i = 0; i < FRAME_PATHS.length; i++) {
        var meta = readFrameMetadata(FRAME_PATHS[i]);
        assertTrue(meta !== null, "readFrameMetadata returned null: " + FRAME_PATHS[i]);
        frames.push(meta);
    }
    return frames;
}

// Pixel position of the star (by the plate solution of the first frame) and a background position.
function positions() {
    var wins = ImageWindow.open(FRAME_PATHS[0]);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    try {
        var pt = wins[0].celestialToImage(STAR_RA, STAR_DEC);
        var w = wins[0].mainView.image.width, h = wins[0].mainView.image.height;
        return { starX: pt.x, starY: pt.y, bgX: Math.round(w * 0.8), bgY: Math.round(h * 0.8) };
    } finally {
        wins[0].forceClose();
    }
}

function runWith(frames, pos, ext) {
    return runAnalysis(frames, pos.bgX, pos.bgY, pos.starX, pos.starY, APERTURE, STAR_V,
        CAMERA, PIXEL_INFO, { ra: STAR_RA, dec: STAR_DEC }, ext);
}

var EXT_ON = { enabled: true, k: 0.20, star: { ra: STAR_RA, dec: STAR_DEC }, manualSite: null };

test("runAnalysis: SQM = SQM_raw + k * mean air mass, with the air mass of the frames used for the star", function() {
    var frames = loadFrames();
    var pos = positions();
    var r = runWith(frames, pos, EXT_ON);
    assertTrue(r !== null, "runAnalysis returned null");
    var e = r.extinction;
    log("  corrected=" + e.corrected + "  reason=" + e.reason);
    log("  frames measured=" + r.n_frames + "  excluded (saturated)=" + r.excluded_frames);
    log("  time sources: " + e.timeSources.join("; ") + "   site sources: " + e.siteSources.join("; "));
    log("  sqm_uncorrected finite=" + isFinite(r.sqm_uncorrected));
    assertTrue(e.corrected, "should be corrected: " + e.reason);

    // Independent mean: recompute X for each used frame from its own header values.
    var xs = [];
    for (var i = 0; i < r.frameData.length; i++) {
        var fd = r.frameData[i];
        var m = null;
        for (var j = 0; j < frames.length; j++) if (frames[j].filename === fd.filename) m = frames[j];
        var fa = frameAirmass(STAR_RA, STAR_DEC, m.site, m.midTimeMs);
        assertEqual(fd.airmass, fa.airmass, "frameData airmass of " + fd.filename, 1e-12);
        if (fd.used) xs.push(fa.airmass);
    }
    var sm = summarizeAirmass(xs);
    log("  air mass of the used frames (" + sm.count + "): mean=" + sm.mean.toFixed(4)
        + " min=" + sm.min.toFixed(4) + " max=" + sm.max.toFixed(4));
    assertEqual(e.airmass.mean, sm.mean, "mean air mass", 1e-12);
    assertEqual(e.airmass.min, sm.min, "min air mass", 1e-12);
    assertEqual(e.airmass.max, sm.max, "max air mass", 1e-12);
    assertEqual(e.correction, 0.20 * sm.mean, "correction = k * mean X", 1e-12);
    assertTrue(e.siteSources.length === 1 && e.siteSources[0].indexOf("OBSGEO") >= 0, "site source should be OBSGEO");
    if (isFinite(r.sqm_uncorrected)) {
        assertEqual(r.sqm, r.sqm_uncorrected + 0.20 * sm.mean, "SQM = raw + k X", 1e-9);
        assertTrue(r.sqm > r.sqm_uncorrected, "corrected SQM must be larger than the raw one");
        log("  correction applied: +" + (r.sqm - r.sqm_uncorrected).toFixed(4) + " mag");
    }
});

test("runAnalysis: correction turned off -> SQM equals the raw value, reason given", function() {
    var frames = loadFrames();
    var pos = positions();
    var r = runWith(frames, pos, { enabled: false, k: 0.20, star: EXT_ON.star, manualSite: null });
    assertTrue(r !== null, "runAnalysis returned null");
    assertFalse(r.extinction.corrected, "must not be corrected");
    assertTrue(/turned off/.test(r.extinction.reason), "reason: " + r.extinction.reason);
    if (isFinite(r.sqm_uncorrected)) assertEqual(r.sqm, r.sqm_uncorrected, "SQM", 0);
});

test("runAnalysis: no star position -> not corrected, analysis still runs", function() {
    var frames = loadFrames();
    var pos = positions();
    var r = runWith(frames, pos, { enabled: true, k: 0.20, star: null, manualSite: null });
    assertTrue(r !== null, "runAnalysis returned null");
    assertFalse(r.extinction.corrected, "must not be corrected");
    assertTrue(/star/.test(r.extinction.reason), "reason: " + r.extinction.reason);
});

test("runAnalysis: frames without a header site use the manual site (same air mass as with the header site)", function() {
    var frames = loadFrames();
    var pos = positions();
    var withHeader = runWith(frames, pos, EXT_ON);
    // Take the header site of the first frame as the "manual" entry, then strip it from every frame.
    var manual = { lat: frames[0].site.lat, lon: frames[0].site.lon };
    for (var i = 0; i < frames.length; i++) frames[i].site = null;
    var noManual = runWith(frames, pos, EXT_ON);
    assertFalse(noManual.extinction.corrected, "without any site it must not be corrected");
    assertTrue(/observing site/.test(noManual.extinction.reason), "reason: " + noManual.extinction.reason);
    var withManual = runWith(frames, pos, { enabled: true, k: 0.20, star: EXT_ON.star, manualSite: manual });
    assertTrue(withManual.extinction.corrected, "manual site should enable the correction");
    log("  site sources with the manual entry: " + withManual.extinction.siteSources.join("; "));
    assertTrue(withManual.extinction.siteSources.length === 1 && withManual.extinction.siteSources[0] === "manual entry",
        "source should be the manual entry");
    assertEqual(withManual.extinction.airmass.mean, withHeader.extinction.airmass.mean, "mean air mass", 1e-9);
});

test("runAnalysis: frames without a time of exposure -> not corrected, with the reason", function() {
    var frames = loadFrames();
    var pos = positions();
    for (var i = 0; i < frames.length; i++) { frames[i].midTimeMs = NaN; frames[i].timeSource = null; }
    var r = runWith(frames, pos, EXT_ON);
    assertTrue(r !== null, "runAnalysis returned null");
    assertFalse(r.extinction.corrected, "must not be corrected");
    assertTrue(/time of exposure/.test(r.extinction.reason), "reason: " + r.extinction.reason);
});

// exportCSV(): the keys are present for a corrected and an uncorrected result.
// The values (they include the observing site) are not logged.
function csvKeys(result, name) {
    var path = File.systemTempDirectory + "/" + name;
    exportCSV(result, path);
    try {
        var text = File.readTextFile(path);
        var keys = [];
        var lines = text.split("\n");
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].charAt(0) === "#" || lines[i].indexOf(",") < 0) continue;
            keys.push(lines[i].substring(0, lines[i].indexOf(",")));
        }
        return { keys: keys, text: text };
    } finally {
        if (File.exists(path)) File.remove(path);
    }
}

test("exportCSV: extinction rows for a corrected result and a not-corrected result", function() {
    var frames = loadFrames();
    var pos = positions();
    var wanted = ["SQM_uncorrected", "ExtinctionCorrected", "ExtinctionK", "ExtinctionCorrection", "Airmass",
        "AirmassMin", "AirmassMax", "ObservingSite", "ObservingSiteSource", "ExposureTimeSource"];

    var on = runWith(frames, pos, EXT_ON);
    if (!isFinite(on.sqm)) { log("  SQM is not finite for these frames; CSV is only written for a finite SQM: skipped"); return; }
    var a = csvKeys(on, "sqa_ext_on.csv");
    for (var i = 0; i < wanted.length; i++) assertTrue(a.keys.indexOf(wanted[i]) >= 0, "missing CSV row: " + wanted[i]);
    assertTrue(a.text.indexOf("ExtinctionCorrected,\"yes\"") >= 0, "ExtinctionCorrected should be yes");
    assertTrue(a.text.indexOf("not corrected for atmospheric extinction") < 0, "no note expected when corrected");

    var off = runWith(frames, pos, { enabled: false, k: 0.20, star: EXT_ON.star, manualSite: null });
    var b = csvKeys(off, "sqa_ext_off.csv");
    assertTrue(b.text.indexOf("ExtinctionCorrected,\"no\"") >= 0, "ExtinctionCorrected should be no");
    assertTrue(b.text.indexOf("ExtinctionNotCorrectedReason") >= 0, "reason row expected");
    assertTrue(b.text.indexOf("SQM,\"") >= 0 && b.text.indexOf("(not corrected for atmospheric extinction)") >= 0,
        "SQM row must carry the note when not corrected");
    log("  CSV rows present for both cases");
});

runAllTests(RESULT_PATH);
