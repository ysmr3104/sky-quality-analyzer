#engine v8

#feature-id    SkyQualityAnalyzer : Utility > SkyQualityAnalyzer
#feature-info  Compute Sky Quality Meter (SQM) values from calibrated astronomical \
   FITS images using the reference star method with multi-exposure frames.

//----------------------------------------------------------------------------
// SkyQualityAnalyzer.js - PixInsight JavaScript Runtime (PJSR) Script
//
// Compute Sky Quality Meter (SQM) values from calibrated/debayered
// astronomical FITS images using the reference star method.
//
// Usage: Script > Utility > SkyQualityAnalyzer
//
// Copyright (c) 2026 Sky Quality Analyzer Project
//----------------------------------------------------------------------------

#define VERSION "0.0.1"

#include "sqm_math.js"

#define TITLE        "Sky Quality Analyzer"
#define MAX_BMP_EDGE 1200
#define BG_HALF      32    // Background ROI: 64x64 px (half = 32)
#define SAT_THRESHOLD 0.97 // Pixel saturation threshold (fraction of maxADU)
#define RATE_DEV_WARN 0.05 // Warn (but do not exclude) when |rate/median - 1| exceeds this.
                           // adu_star/exptime should be constant across frames; a large
                           // deviation flags non-linearity. Kept as a warning-only threshold
                           // for now (not an exclusion) because faint stars can exceed 5% from
                           // noise alone — see issue #19 for tightening this once measured.

CoreApplication.ensureMinimumVersion(1, 9, 4);

// ─── Debug mode ──────────────────────────────────────────────────────────────
// Set true during development to enable verbose console output.
// Set false before distributing.
var DEBUG = true;
function dbg(msg) { if (DEBUG) console.writeln("[DBG] " + msg); }
// ─────────────────────────────────────────────────────────────────────────────

// Script directory (used to locate equipment.json at runtime)
var SCRIPT_PATH = #__FILE__;
var SCRIPT_DIR  = File.extractDrive(SCRIPT_PATH) + File.extractDirectory(SCRIPT_PATH);

//============================================================================
// Equipment database
//============================================================================

var gEquipment = { cameras: [], telescopes: [] };

function loadEquipmentDatabase() {
   var jsonPath = SCRIPT_DIR + "/equipment.json";
   if (!File.exists(jsonPath)) {
      console.warningln("equipment.json not found: " + jsonPath);
      return false;
   }
   try {
      var text = File.readTextFile(jsonPath);
      gEquipment = JSON.parse(text);
      console.writeln("Equipment DB: " + gEquipment.cameras.length
         + " cameras, " + gEquipment.telescopes.length + " telescopes.");
      return true;
   } catch (e) {
      console.warningln("Failed to parse equipment.json: " + e);
      return false;
   }
}

// Find a camera entry by INSTRUME header value (case-insensitive substring match)
function findCameraByInstrume(instrume) {
   if (!instrume) return null;
   var s = instrume.toLowerCase().trim();
   for (var i = 0; i < gEquipment.cameras.length; i++) {
      var c = gEquipment.cameras[i];
      if (c.instrume && c.instrume.toLowerCase() === s) return c;
   }
   // Partial match fallback
   for (var i = 0; i < gEquipment.cameras.length; i++) {
      var c = gEquipment.cameras[i];
      if (c.instrume && s.indexOf(c.instrume.toLowerCase()) >= 0) return c;
   }
   return null;
}

//============================================================================
// FITS utilities
//============================================================================

// Look up a FITS keyword value string in a keywords array
function getFITSKeyword(keywords, name) {
   for (var i = 0; i < keywords.length; i++) {
      if (keywords[i].name === name) return keywords[i].value.trim();
   }
   return null;
}

// Read frame metadata from a FITS file without keeping it open.
// Returns { filepath, exptime, instrume, gain, isColor, bitsPerSample, hasWcs }
// or null on error.
function readFrameMetadata(filepath) {
   var wins = ImageWindow.open(filepath);
   if (!wins || wins.length === 0) return null;
   var win   = wins[0];
   var image = win.mainView.image;
   var kws   = win.keywords;

   var expStr  = getFITSKeyword(kws, "EXPTIME");
   if (!expStr) expStr = getFITSKeyword(kws, "EXPOSURE");
   var exptime = expStr ? parseFloat(expStr) : NaN;

   var instrume = getFITSKeyword(kws, "INSTRUME") || "";
   var gainStr  = getFITSKeyword(kws, "GAIN");
   var gain     = gainStr ? parseInt(gainStr) : NaN;

   var isColor       = (image.numberOfChannels >= 3);
   var bitsPerSample = image.bitsPerSample;

   // Native astrometric solution check (WBPP attaches one to solved frames).
   var hasWcs = (win.hasAstrometricSolution === true);

   win.close();

   if (hasWcs) {
      console.writeln("  Astrometric solution: present");
   }

   if (isNaN(exptime) || exptime <= 0) {
      console.warningln("EXPTIME missing or invalid in: " + File.extractName(filepath));
      return null;
   }

   return {
      filepath:      filepath,
      filename:      File.extractName(filepath),
      exptime:       exptime,
      instrume:      instrume,
      gain:          gain,
      isColor:       isColor,
      bitsPerSample: bitsPerSample,
      hasWcs:        hasWcs
   };
}

//============================================================================
// WCS safe wrappers
// win.imageToCelestial()/celestialToImage() can throw, or return components
// that are NaN/non-finite; celestialToImage() can also project outside the
// image bounds. These wrappers turn all of that into a null return instead of
// letting an exception propagate, modeled on imageToCelestialSafe()/
// celestialToImageSafe() in the bundled NBExtractPI.js (signing machine,
// /Applications/PixInsight/src/scripts/NBExtractPI.js, ~line 590).
//============================================================================

// win: ImageWindow. x, y: pixel coordinates. Returns a Point (x=RA deg,
// y=Dec deg) or null.
function safeImageToCelestial(win, x, y) {
   var q = null;
   try {
      q = win.imageToCelestial(x, y);
   } catch (e) {
      try {
         q = win.imageToCelestial(new Point(x, y));
      } catch (e2) {
         q = null;
      }
   }
   if (q && typeof q.x === "number" && isFinite(q.x) && isFinite(q.y)) return q;
   return null;
}

// win: ImageWindow. ra, dec: degrees. Returns a Point (image pixel
// coordinates) if finite and within the image bounds, or null.
function safeCelestialToImage(win, ra, dec) {
   var q = null;
   try {
      q = win.celestialToImage(ra, dec);
   } catch (e) {
      try {
         q = win.celestialToImage(new Point(ra, dec));
      } catch (e2) {
         q = null;
      }
   }
   if (!q || typeof q.x !== "number" || !isFinite(q.x) || !isFinite(q.y)) return null;
   var image = win.mainView.image;
   if (q.x < 0 || q.x >= image.width || q.y < 0 || q.y >= image.height) return null;
   return q;
}

//============================================================================
// Sesame search (ExternalProcess + curl) — with V magnitude
//============================================================================

function searchStarInfo(objectName) {
   var encoded = objectName.replace(/ /g, "+");
   var url     = "http://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?" + encoded;
   var tmpFile = File.systemTempDirectory + "/sqm_sesame.txt";

   var P = new ExternalProcess;
   P.start("curl", ["-s", "-o", tmpFile, "-m", "10", url]);
   if (!P.waitForFinished(15000)) {
      P.kill();
      return null;
   }
   if (P.exitCode !== 0) return null;
   if (!File.exists(tmpFile)) return null;

   var content = "";
   try {
      content = File.readTextFile(tmpFile);
      File.remove(tmpFile);
   } catch (e) {
      return null;
   }

   var result = { ra: null, dec: null, vmag: null };
   var lines  = content.split("\n");

   for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();

      // J2000 coordinates: %J ra dec ...
      if (line.indexOf("%J") === 0 && result.ra === null) {
         var coords = line.substring(2).trim();
         var eqIdx = coords.indexOf("=");
         if (eqIdx > 0) coords = coords.substring(0, eqIdx).trim();
         var parts = coords.split(/\s+/);
         if (parts.length >= 2) {
            var ra  = parseFloat(parts[0]);
            var dec = parseFloat(parts[1]);
            if (!isNaN(ra) && !isNaN(dec)) {
               result.ra  = ra;
               result.dec = dec;
            }
         }
      }

      // V magnitude: %V mag
      if (line.indexOf("%V") === 0 && result.vmag === null) {
         var magStr = line.substring(2).trim().split(/\s+/)[0];
         var v = parseFloat(magStr);
         if (!isNaN(v)) result.vmag = v;
      }
   }

   if (result.ra === null) return null;
   return result;
}

//============================================================================
// SIMBAD catalog query by position
//============================================================================

// Query SIMBAD TAP service for stars with V magnitude near (ra, dec).
// Uses ADQL via the TAP sync endpoint — more reliable than the script interface.
// Returns array of { id, ra, dec, vmag } sorted by V magnitude, or null on error.
function querySIMBADNearby(ra, dec, radiusArcmin) {
   var radiusDeg = radiusArcmin / 60.0;
   // Filter V < 9 to prioritize bright stars suitable for SQM (need high SNR).
   // If no results found, caller can retry with a wider/fainter query.
   var adql = "SELECT TOP 30 main_id, ra, dec, V "
            + "FROM basic JOIN allfluxes ON oid = oidref "
            + "WHERE CONTAINS(POINT('ICRS',ra,dec),"
            +   "CIRCLE('ICRS'," + ra.toFixed(6) + "," + dec.toFixed(6) + "," + radiusDeg.toFixed(6) + "))=1 "
            + "AND V IS NOT NULL "
            + "AND V < 9.0 "
            + "ORDER BY V";

   var outFile = File.systemTempDirectory + "/sqm_simbad_out.txt";
   var url = "http://simbad.u-strasbg.fr/simbad/sim-tap/sync"
           + "?REQUEST=doQuery&LANG=ADQL&FORMAT=text&QUERY="
           + encodeURIComponent(adql);
   dbg("SIMBAD TAP URL: " + url);

   var P = new ExternalProcess;
   P.start("curl", ["-s", "-o", outFile, "-m", "30", url]);
   if (!P.waitForFinished(35000)) { P.kill(); return null; }
   if (!File.exists(outFile)) return null;

   var content = "";
   try { content = File.readTextFile(outFile); File.remove(outFile); } catch (e) {}

   dbg("SIMBAD response (" + content.length + " chars):\n" + content.substring(0, 800));
   return parseSIMBADResponse(content);
}

// Parse SIMBAD TAP text/plain response (pipe-separated) into array of { id, ra, dec, vmag }.
function parseSIMBADResponse(content) {
   var stars = [];
   var lines = content.split("\n");
   for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.length === 0) continue;
      if (line.charAt(0) === "-" || line.indexOf("main_id") >= 0) continue; // header/separator
      var parts = line.split("|");
      if (parts.length < 4) continue;
      var id   = parts[0].trim().replace(/^"|"$/g, "");
      var sra  = parseFloat(parts[1]);
      var sdec = parseFloat(parts[2]);
      var vmag = parseFloat(parts[3]);
      if (id.length > 0 && !isNaN(sra) && !isNaN(sdec) && !isNaN(vmag)) {
         stars.push({ id: id, ra: sra, dec: sdec, vmag: vmag });
      }
   }
   dbg("SIMBAD: " + stars.length + " stars with Vmag");
   stars.sort(function(a, b) { return a.vmag - b.vmag; });
   return stars;
}

//============================================================================
// starSuitabilityLabel — compute suitability label for a reference star
// aperture: px radius; pixelScale: arcsec/px (0 = unknown)
//============================================================================

function starSuitabilityLabel(vmag, aperture, pixelScale) {
   // Saturation risk: very bright stars may saturate even in shortest exposures.
   if (vmag < 2.0) return "Saturation risk";

   if (pixelScale > 0) {
      // Compute sky-noise-relative SNR proxy.
      // Assumes suburban/urban sky SQM = 16 mag/arcsec^2 (conservative estimate).
      // SNR_proxy = star_flux / sky_flux_in_aperture
      //           = 10^(0.4*(16-V)) / (pi * r_arcsec^2)
      var r_arcsec = aperture * pixelScale;
      var area = Math.PI * r_arcsec * r_arcsec;
      var snrProxy = Math.pow(10, 0.4 * (16.0 - vmag)) / area;
      if (snrProxy >= 20) return "Ideal";
      if (snrProxy >= 5)  return "Good";
      if (snrProxy >= 1)  return "Marginal";
      return "Too faint";
   } else {
      // Fallback: vmag-only thresholds.
      if (vmag <= 7.0)  return "Ideal";
      if (vmag <= 9.0)  return "Good";
      if (vmag <= 10.0) return "Marginal";
      return "Too faint";
   }
}

//============================================================================
// NearbyStarDialog — show SIMBAD results, user picks a star
//============================================================================

var NearbyStarDialog = class extends Dialog {
constructor(stars, aperture, pixelScale) {
      super();

   var self = this;
   this.selectedStar = null;
   this.windowTitle  = "Nearby Stars — SIMBAD";
   this.minWidth     = 520;

   var infoLabel = new Label(this);
   infoLabel.text = "Stars near the clicked position (sorted by V magnitude):";
   infoLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   var ap = (aperture > 0) ? aperture : 15;
   var ps = (pixelScale > 0) ? pixelScale : 0;

   this.starTree = new TreeBox(this);
   this.starTree.headerVisible   = true;
   this.starTree.numberOfColumns = 4;
   this.starTree.setColumnWidth(0, 220);
   this.starTree.setColumnWidth(1, 65);
   this.starTree.setColumnWidth(2, 90);
   this.starTree.setColumnWidth(3, 120);
   this.starTree.setHeaderText(0, "Identifier");
   this.starTree.setHeaderText(1, "V mag");
   this.starTree.setHeaderText(2, "RA (deg)");
   this.starTree.setHeaderText(3, "Suitability");
   this.starTree.minHeight = 220;

   for (var i = 0; i < stars.length; i++) {
      var s    = stars[i];
      var node = new TreeBoxNode(this.starTree);
      node.setText(0, s.id);
      node.setText(1, s.vmag.toFixed(3));
      node.setText(2, s.ra.toFixed(4));
      node.setText(3, starSuitabilityLabel(s.vmag, ap, ps));
   }

   // Compose hint showing aperture and pixel scale used for suitability evaluation.
   var hintLabel = new Label(this);
   if (ps > 0) {
      var rArcsec = (ap * ps).toFixed(1);
      hintLabel.text = "Suitability based on aperture r=" + rArcsec + "\" (r=" + ap
         + "px, scale=" + ps.toFixed(2) + "\"/px, assumes SQM=16). Ideal: V<3, Good: V<4.";
   } else {
      hintLabel.text = "Suitability based on V magnitude only (select camera/telescope for aperture-based estimate).";
   }
   hintLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   this.selectBtn = new PushButton(this);
   this.selectBtn.text = "Use This Star";
   this.selectBtn.icon = this.scaledResource(":/icons/ok.png");
   this.selectBtn.onClick = function() {
      var sel = self.starTree.selectedNodes;
      if (sel.length === 0) {
         var mb = new MessageBox("Please select a star from the list.",
            TITLE, StdIcon.Warning, StdButton.Ok);
         mb.execute();
         return;
      }
      var idx = self.starTree.childIndex(sel[0]);
      if (idx >= 0 && idx < stars.length) {
         self.selectedStar = stars[idx];
         self.ok();
      }
   };

   this.cancelButton = new PushButton(this);
   this.cancelButton.text = "Cancel";
   this.cancelButton.icon = this.scaledResource(":/icons/cancel.png");
   this.cancelButton.onClick = function() { self.cancel(); };

   var btnSizer = new HorizontalSizer;
   btnSizer.spacing = 8;
   btnSizer.addStretch();
   btnSizer.add(this.selectBtn);
   btnSizer.add(this.cancelButton);

   this.sizer = new VerticalSizer;
   this.sizer.margin  = 8;
   this.sizer.spacing = 8;
   this.sizer.add(infoLabel);
   this.sizer.add(this.starTree, 100);
   this.sizer.add(hintLabel);
   this.sizer.add(btnSizer);

   this.adjustToContents();
   }
};

//============================================================================
// Auto-stretch (MTF-based) — for image preview
//============================================================================

function computeAutoSTF(image, channel) {
   if (typeof channel === "undefined") channel = 0;
   var savedCh = image.selectedChannel;
   image.selectedChannel = channel;
   var med = image.median();
   var mad;
   try { mad = image.MAD(); } catch (e) { mad = image.avgDev() * 1.4826; }
   image.selectedChannel = savedCh;

   if (mad === 0 || mad < 1e-15) return { shadowClip: 0.0, midtone: 0.5 };

   var targetMedian = 0.25;
   var shadow = med + (-2.8) * mad;
   if (shadow < 0) shadow = 0;

   var nm = (med - shadow) / (1.0 - shadow);
   if (nm <= 0) nm = 1e-6;
   if (nm >= 1) nm = 1 - 1e-6;

   var m = (targetMedian - 1.0) * nm / ((2.0 * targetMedian - 1.0) * nm - targetMedian);
   if (m < 0) m = 0;
   if (m > 1) m = 1;

   return { shadowClip: shadow, midtone: m };
}

function mtf(m, x) {
   if (x <= 0) return 0;
   if (x >= 1) return 1;
   if (m === 0.5) return x;
   return ((m - 1.0) * x) / ((2.0 * m - 1.0) * x - m);
}

function createStretchedBitmap(image, maxEdge) {
   var w = image.width;
   var h = image.height;
   var scale = 1.0;
   if (maxEdge > 0 && Math.max(w, h) > maxEdge)
      scale = maxEdge / Math.max(w, h);

   var bmpW = Math.round(w * scale);
   var bmpH = Math.round(h * scale);
   var isColor = (image.numberOfChannels >= 3);

   var stf = computeAutoSTF(image, 0);
   var stfG = isColor ? computeAutoSTF(image, 1) : stf;
   var stfB = isColor ? computeAutoSTF(image, 2) : stf;

   var bmp = new Bitmap(bmpW, bmpH);
   for (var by = 0; by < bmpH; by++) {
      for (var bx = 0; bx < bmpW; bx++) {
         var ix = Math.min(Math.floor(bx / scale), w - 1);
         var iy = Math.min(Math.floor(by / scale), h - 1);
         var r, g, b;
         if (isColor) {
            r = image.sample(ix, iy, 0);
            g = image.sample(ix, iy, 1);
            b = image.sample(ix, iy, 2);
         } else {
            r = g = b = image.sample(ix, iy, 0);
         }
         r = mtf(stf.midtone,  Math.max(0, (r - stf.shadowClip)  / (1 - stf.shadowClip)));
         g = mtf(stfG.midtone, Math.max(0, (g - stfG.shadowClip) / (1 - stfG.shadowClip)));
         b = mtf(stfB.midtone, Math.max(0, (b - stfB.shadowClip) / (1 - stfB.shadowClip)));
         var ri = Math.round(r * 255);
         var gi = Math.round(g * 255);
         var bi = Math.round(b * 255);
         bmp.setPixel(bx, by, 0xFF000000 | (ri << 16) | (gi << 8) | bi);
      }
   }
   return { bitmap: bmp, scale: scale, width: bmpW, height: bmpH };
}

//============================================================================
// PointPreviewControl — zoom/pan ScrollBox + click callback
// mode: "background" draws a 64x64 box; "star" draws an aperture circle
//============================================================================

var PointPreviewControl = class extends ScrollBox {
constructor(parent, mode) {
      super(parent);

   this.bitmapResult = null;
   this.zoomLevel    = 1.0;
   this.scrollX      = 0;
   this.scrollY      = 0;
   this.maxScrollX   = 0;
   this.maxScrollY   = 0;
   this.markerImgX   = -1;
   this.markerImgY   = -1;
   this.mode         = mode || "background";
   this.aperture     = 15; // px for "star" mode
   this.onImageClick = null;

   this.isDragging  = false;
   this.hasMoved    = false;
   this.dragStartX  = 0;
   this.dragStartY  = 0;
   this.panScrollX  = 0;
   this.panScrollY  = 0;

   this.zoomLevels = [0.0625, 0.125, 0.25, 0.5, 0.6667, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
   this.zoomIndex  = 6; // 1.0
   this.autoScrolls = false;

   var self = this;
   this.viewport.cursor = new Cursor(StdCursor.Arrow);

   this.onHorizontalScrollPosUpdated = function(pos) { self.scrollX = pos; self.viewport.update(); };
   this.onVerticalScrollPosUpdated   = function(pos) { self.scrollY = pos; self.viewport.update(); };

   this.viewport.onPaint = function() {
      var g = new Graphics(this);
      g.fillRect(this.boundsRect, new Brush(0xFF202020));

      if (self.bitmapResult) {
         var bmp    = self.bitmapResult.bitmap;
         var dispW  = Math.round(bmp.width  * self.zoomLevel);
         var dispH  = Math.round(bmp.height * self.zoomLevel);
         g.drawScaledBitmap(
            new Rect(-self.scrollX, -self.scrollY, dispW - self.scrollX, dispH - self.scrollY),
            bmp);

         if (self.markerImgX >= 0) {
            var scale = self.bitmapResult.scale;
            var bx = self.markerImgX * scale * self.zoomLevel - self.scrollX;
            var by = self.markerImgY * scale * self.zoomLevel - self.scrollY;

            if (self.mode === "background") {
               // Draw 64x64 rectangle
               var half = BG_HALF * scale * self.zoomLevel;
               g.pen = new Pen(0xFF00FFFF, 1.5);
               g.drawRect(new Rect(Math.round(bx - half), Math.round(by - half),
                                   Math.round(bx + half), Math.round(by + half)));
            } else {
               // Draw aperture circle + sky annulus
               var r  = self.aperture * scale * self.zoomLevel;
               var ri = (self.aperture + 5)  * scale * self.zoomLevel;
               var ro = (self.aperture + 25) * scale * self.zoomLevel;
               g.pen = new Pen(0xFF00FF00, 1.5);
               g.drawCircle(bx, by, r);
               g.pen = new Pen(0xFF00FFFF, 1.0);
               g.drawCircle(bx, by, ri);
               g.drawCircle(bx, by, ro);
            }
            // Crosshair
            g.pen = new Pen(0xCCFF4444, 1.5);
            g.drawLine(bx - 10, by, bx + 10, by);
            g.drawLine(bx, by - 10, bx, by + 10);
         }
      }
      g.end();
   };

   this.viewport.onMousePress = function(x, y, button, buttonState, modifiers) {
      if (!self.bitmapResult) return;
      if (button === 1 || button === 4) {
         self.isDragging = true;
         self.hasMoved   = false;
         self.dragStartX = x;
         self.dragStartY = y;
         self.panScrollX = self.scrollX;
         self.panScrollY = self.scrollY;
      }
   };

   this.viewport.onMouseMove = function(x, y, buttonState, modifiers) {
      if (!self.isDragging) return;
      var dx = x - self.dragStartX;
      var dy = y - self.dragStartY;
      if (!self.hasMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
         self.hasMoved = true;
         self.viewport.cursor = new Cursor(StdCursor.ClosedHand);
      }
      if (self.hasMoved) self.setScroll(self.panScrollX - dx, self.panScrollY - dy);
   };

   this.viewport.onMouseRelease = function(x, y, button, buttonState, modifiers) {
      if (!self.isDragging) return;
      if (!self.hasMoved && button === 1) {
         var scale = self.bitmapResult ? self.bitmapResult.scale : 1.0;
         var imgX  = (x + self.scrollX) / self.zoomLevel / scale;
         var imgY  = (y + self.scrollY) / self.zoomLevel / scale;
         self.markerImgX = imgX;
         self.markerImgY = imgY;
         self.viewport.update();
         if (self.onImageClick) self.onImageClick(imgX, imgY);
      }
      self.isDragging = false;
      self.hasMoved   = false;
      self.viewport.cursor = new Cursor(StdCursor.Arrow);
   };

   this.viewport.onMouseWheel = function(x, y, delta, buttonState, modifiers) {
      if (!self.bitmapResult) return;
      var oldZoom = self.zoomLevel;
      if (delta > 0) {
         for (var i = 0; i < self.zoomLevels.length; i++) {
            if (self.zoomLevels[i] > oldZoom + 1e-6) { self.zoomIndex = i; break; }
         }
      } else {
         for (var i = self.zoomLevels.length - 1; i >= 0; i--) {
            if (self.zoomLevels[i] < oldZoom - 1e-6) { self.zoomIndex = i; break; }
         }
      }
      var newZoom = self.zoomLevels[self.zoomIndex];
      var factor  = newZoom / oldZoom;
      self.scrollX = Math.round((self.scrollX + x) * factor - x);
      self.scrollY = Math.round((self.scrollY + y) * factor - y);
      self.zoomLevel = newZoom;
      self.updateViewport();
   };
   }

   setBitmap(bitmapResult) {
      this.bitmapResult = bitmapResult;
      this.scrollX = 0;
      this.scrollY = 0;
      this.fitToWindow();
   }

   setScroll(x, y) {
      this.scrollX = Math.max(0, Math.min(this.maxScrollX, Math.round(x)));
      this.scrollY = Math.max(0, Math.min(this.maxScrollY, Math.round(y)));
      this.horizontalScrollPosition = this.scrollX;
      this.verticalScrollPosition   = this.scrollY;
      this.viewport.update();
   }

   updateViewport() {
      var bmp = this.bitmapResult ? this.bitmapResult.bitmap : null;
      if (!bmp) return;
      var dispW = Math.round(bmp.width  * this.zoomLevel);
      var dispH = Math.round(bmp.height * this.zoomLevel);
      var viewW = Math.max(1, this.viewport.width  || this.width);
      var viewH = Math.max(1, this.viewport.height || this.height);

      this.maxScrollX = Math.max(0, dispW - viewW);
      this.maxScrollY = Math.max(0, dispH - viewH);
      this.scrollX = Math.max(0, Math.min(this.maxScrollX, this.scrollX));
      this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY));

      this.setHorizontalScrollRange(0, this.maxScrollX);
      this.setVerticalScrollRange(0, this.maxScrollY);
      this.horizontalScrollPosition = this.scrollX;
      this.verticalScrollPosition   = this.scrollY;
      this.viewport.update();
   }

   fitToWindow() {
      var bmp = this.bitmapResult ? this.bitmapResult.bitmap : null;
      if (!bmp) return;
      var viewW = Math.max(1, this.viewport.width  || this.width);
      var viewH = Math.max(1, this.viewport.height || this.height);
      var fitZoom = Math.min(viewW / bmp.width, viewH / bmp.height);
      // Snap to nearest zoom level
      var best = 0, bestDiff = 1e9;
      for (var i = 0; i < this.zoomLevels.length; i++) {
         var d = Math.abs(this.zoomLevels[i] - fitZoom);
         if (d < bestDiff) { bestDiff = d; best = i; }
      }
      this.zoomIndex = best;
      this.zoomLevel = this.zoomLevels[best];
      this.scrollX = 0;
      this.scrollY = 0;
      this.updateViewport();
   }
};

//============================================================================
// PointSelectionDialog — show a frame preview and let user click a position
//============================================================================

var PointSelectionDialog = class extends Dialog {
constructor(parent, title, filepath, mode, aperture, pixelScale) {
      super();

   var self = this;
   this.selectedX     = -1;
   this.selectedY     = -1;
   this.selectedStar  = null;   // filled when catalog star is chosen
   this.selectedRaDec = null;   // { ra, dec } once a position is tied to sky coordinates
   this.hasWcs        = false;  // set once the retained window is opened below
   this.win           = null;   // retained ImageWindow — kept open for celestialToImage/imageToCelestial;
                                 // caller MUST call releaseImage() after execute()
   this.pixelScale    = (pixelScale > 0) ? pixelScale : 0;
   this.filepath      = filepath;
   this.mode          = mode;

   this.windowTitle = title;
   this.minWidth    = 720;
   this.minHeight   = 560;

   var instructLabel = new Label(this);
   instructLabel.wordWrapping = true;
   if (mode === "background") {
      instructLabel.text = "Click on a star-free sky background region. "
         + "A 64×64 px region (cyan box) will be used for background measurement.";
   } else {
      instructLabel.text = "Click on the center of the reference star. "
         + "The green circle shows the aperture; cyan circles show the sky annulus.";
   }
   instructLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   this.preview = new PointPreviewControl(this, mode);
   this.preview.aperture = aperture || 15;

   this.coordLabel = new Label(this);
   this.coordLabel.text = "Position: (not selected)";
   this.coordLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   // "Find in Catalog" button — only shown in star mode
   this.catalogBtn = null;
   if (mode === "star") {
      this.catalogBtn = new PushButton(this);
      this.catalogBtn.text    = "Find in Catalog...";
      this.catalogBtn.toolTip = "Query SIMBAD for stars near the clicked position";
      this.catalogBtn.enabled = false;
      this.catalogBtn.onClick = function() {
         if (!self.hasWcs || !self.win) {
            var mb = new MessageBox(
               "No astrometric solution found in this frame.\n"
               + "Please plate-solve the images first, or enter the star name manually.",
               TITLE, StdIcon.Warning, StdButton.Ok);
            mb.execute();
            return;
         }
         var pos = safeImageToCelestial(self.win, self.selectedX, self.selectedY);
         if (!pos) {
            var mb = new MessageBox(
               "The clicked position falls outside the astrometric solution.\n"
               + "Please click closer to the center of the image.",
               TITLE, StdIcon.Warning, StdButton.Ok);
            mb.execute();
            return;
         }
         // Search 120' (2°) radius for V < 9 to find bright reference stars across the whole image.
         // Fall back to V < 11 if nothing bright is found.
         console.writeln("SIMBAD query: RA=" + pos.x.toFixed(4)
            + " Dec=" + pos.y.toFixed(4) + " radius=120' V<9");
         console.flush();
         var stars = querySIMBADNearby(pos.x, pos.y, 120);
         if (!stars || stars.length === 0) {
            // Retry with fainter limit
            console.writeln("  No V<9 stars found, retrying V<11...");
            var adqlFaint = "SELECT TOP 30 main_id, ra, dec, V "
               + "FROM basic JOIN allfluxes ON oid = oidref "
               + "WHERE CONTAINS(POINT('ICRS',ra,dec),"
               +   "CIRCLE('ICRS'," + pos.x.toFixed(6) + "," + pos.y.toFixed(6) + ",2.0))=1 "
               + "AND V IS NOT NULL AND V < 11.0 ORDER BY V";
            var outFile2 = File.systemTempDirectory + "/sqm_simbad_faint.txt";
            var url2 = "http://simbad.u-strasbg.fr/simbad/sim-tap/sync"
               + "?REQUEST=doQuery&LANG=ADQL&FORMAT=text&QUERY=" + encodeURIComponent(adqlFaint);
            var P2 = new ExternalProcess;
            P2.start("curl", ["-s", "-o", outFile2, "-m", "30", url2]);
            if (P2.waitForFinished(35000) && File.exists(outFile2)) {
               var content2 = File.readTextFile(outFile2);
               File.remove(outFile2);
               stars = parseSIMBADResponse(content2);
            }
         }
         if (!stars || stars.length === 0) {
            var mb = new MessageBox(
               "No stars with V < 11 found within 2° of the clicked position.\n"
               + "This field may not contain a bright enough reference star.\n"
               + "Try entering star name and V magnitude manually, or\n"
               + "capture frames covering a brighter star (V < 8 recommended).",
               TITLE, StdIcon.Warning, StdButton.Ok);
            mb.execute();
            return;
         }
         // Filter to stars that project within the image bounds.
         // safeCelestialToImage() already returns null for out-of-bounds projections.
         var inFrame = [];
         for (var si = 0; si < stars.length; si++) {
            var pt = safeCelestialToImage(self.win, stars[si].ra, stars[si].dec);
            if (!pt) continue;
            stars[si].px = pt.x;
            stars[si].py = pt.y;
            inFrame.push(stars[si]);
         }
         if (inFrame.length === 0) {
            var mb = new MessageBox(
               "No suitable stars found within the image frame.\n"
               + "The bright stars in this field may all lie outside the image bounds.\n"
               + "Try entering the star name and V magnitude manually.",
               TITLE, StdIcon.Warning, StdButton.Ok);
            mb.execute();
            return;
         }
         var catalogDlg = new NearbyStarDialog(inFrame, self.preview.aperture, self.pixelScale);
         if (catalogDlg.execute() === 1 && catalogDlg.selectedStar) {
            self.selectedStar  = catalogDlg.selectedStar;
            self.selectedRaDec = { ra: self.selectedStar.ra, dec: self.selectedStar.dec };
            // Update pixel position to the actual projected position of the catalog star
            console.writeln("  Star RA=" + self.selectedStar.ra.toFixed(4)
               + " Dec=" + self.selectedStar.dec.toFixed(4));
            // Keep the fractional projected position (no rounding): aperturePhotometry
            // accepts a fractional center, and rounding here would throw away precision
            // the native solution actually gives us.
            var imgPt = safeCelestialToImage(self.win, self.selectedStar.ra, self.selectedStar.dec);
            if (imgPt) {
               self.selectedX = imgPt.x;
               self.selectedY = imgPt.y;
               console.writeln("  Catalog star projected to pixel: ("
                  + self.selectedX.toFixed(2) + "," + self.selectedY.toFixed(2) + ")");
            } else {
               console.writeln("  [WARN] celestialToImage returned null (outside solution range?)");
            }
            self.coordLabel.text = "Position: X=" + self.selectedX.toFixed(2) + "  Y=" + self.selectedY.toFixed(2)
               + "   →  " + self.selectedStar.id + "  V=" + self.selectedStar.vmag.toFixed(3);
         }
      };
   }

   this.preview.onImageClick = function(imgX, imgY) {
      // Background mode feeds measureBackground(), which loops over integer pixel
      // indices, so keep it rounded. Star mode keeps the fractional click position
      // (aperturePhotometry accepts a fractional center); only the label rounds it
      // for display.
      if (self.mode === "background") {
         self.selectedX = Math.round(imgX);
         self.selectedY = Math.round(imgY);
      } else {
         self.selectedX = imgX;
         self.selectedY = imgY;
      }
      self.selectedStar  = null;
      self.selectedRaDec = null;
      if (self.hasWcs && self.win) {
         var celestial = safeImageToCelestial(self.win, self.selectedX, self.selectedY);
         if (celestial) self.selectedRaDec = { ra: celestial.x, dec: celestial.y };
      }
      self.coordLabel.text = (self.mode === "background")
         ? ("Position: X=" + self.selectedX + "  Y=" + self.selectedY)
         : ("Position: X=" + self.selectedX.toFixed(2) + "  Y=" + self.selectedY.toFixed(2));
      if (self.catalogBtn) self.catalogBtn.enabled = true;
   };

   this.okButton = new PushButton(this);
   this.okButton.text = "OK";
   this.okButton.icon = this.scaledResource(":/icons/ok.png");
   this.okButton.onClick = function() {
      if (self.selectedX < 0) {
         var mb = new MessageBox("Please click to select a position.", TITLE, StdIcon.Warning, StdButton.Ok);
         mb.execute();
         return;
      }
      self.ok();
   };

   this.cancelButton = new PushButton(this);
   this.cancelButton.text = "Cancel";
   this.cancelButton.icon = this.scaledResource(":/icons/cancel.png");
   this.cancelButton.onClick = function() { self.cancel(); };

   var btnSizer = new HorizontalSizer;
   btnSizer.spacing = 8;
   btnSizer.add(this.coordLabel, 100);
   if (this.catalogBtn) btnSizer.add(this.catalogBtn);
   btnSizer.addStretch();
   btnSizer.add(this.okButton);
   btnSizer.add(this.cancelButton);

   this.sizer = new VerticalSizer;
   this.sizer.margin  = 8;
   this.sizer.spacing = 8;
   this.sizer.add(instructLabel);
   this.sizer.add(this.preview, 100);
   this.sizer.add(btnSizer);

   // Load preview bitmap. The window is kept open (not closed here) so that
   // celestialToImage()/imageToCelestial() remain usable for the dialog's lifetime;
   // the caller must call releaseImage() after execute() returns.
   var wins = ImageWindow.open(filepath);
   if (wins && wins.length > 0) {
      var win = wins[0];
      this.win = win; // retained from here on; released via releaseImage()
      try {
         var image = win.mainView.image;
         this.imgWidth  = image.width;   // used for out-of-frame check in catalog lookup
         this.imgHeight = image.height;
         this.hasWcs    = (win.hasAstrometricSolution === true);
         console.writeln("Generating preview for: " + File.extractName(filepath));
         console.flush();
         var bmpResult = createStretchedBitmap(image, MAX_BMP_EDGE);
         this.preview.setBitmap(bmpResult);

         if (mode === "star") {
            if (this.hasWcs) {
               console.writeln("  Astrometric solution available — catalog lookup enabled.");
            } else {
               console.writeln("  No astrometric solution — catalog lookup unavailable.");
            }
         }
      } catch (e) {
         // Don't leak the window if bitmap generation or anything else here throws.
         win.forceClose();
         this.win = null;
         throw e;
      }
   } else {
      var mb = new MessageBox("Cannot open file:\n" + filepath, TITLE, StdIcon.Error, StdButton.Ok);
      mb.execute();
   }
   }

   // Close the retained preview window. Must be called by the caller after execute()
   // (typically in a try/finally), since the constructor keeps it open for
   // celestialToImage()/imageToCelestial() calls made from onClick handlers.
   releaseImage() {
      if (this.win) {
         this.win.forceClose();
         this.win = null;
      }
   }
};

//============================================================================
// Background measurement
// Opens the file, extracts the ROI, returns { adu_sky, count }
//============================================================================

function measureBackground(filepath, bgX, bgY, bitsPerSample, sqmChannel) {
   var wins = ImageWindow.open(filepath);
   if (!wins || wins.length === 0) return null;
   var win   = wins[0];
   var image = win.mainView.image;

   var isColor = (image.numberOfChannels >= 3);
   var ch      = (isColor && sqmChannel === "G") ? 1 : 0;
   var maxADU  = (bitsPerSample === 32) ? 4294967295 : 65535;

   var x0 = Math.max(0, bgX - BG_HALF);
   var y0 = Math.max(0, bgY - BG_HALF);
   var x1 = Math.min(image.width  - 1, bgX + BG_HALF - 1);
   var y1 = Math.min(image.height - 1, bgY + BG_HALF - 1);

   var pixels = [];
   for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
         pixels.push(image.sample(x, y, ch) * maxADU);
      }
   }

   win.close();

   var stats = sigmaClippingStats(pixels, 3.0, 10);
   // SExtractor-style mode: more robust against faint stars in the ROI
   var skyBg = 2.5 * stats.median - 1.5 * stats.mean;
   if (skyBg <= 0) skyBg = stats.median;  // fallback
   return { adu_sky: skyBg, count: stats.count };
}

//============================================================================
// Aperture photometry
// Returns { adu_star, saturated_fraction, saturated_pixels, starX, starY, skyBg }
// - adu_star: net star flux (full aperture sum minus sky background), i.e.
//   aperSum_all - skyBg * apCount. Saturated pixels are NOT excluded/scaled:
//   they sit at the star's brightest peak, so filling them in from the
//   surrounding (dimmer) average always underestimates the true flux. Frames
//   with any saturated pixel in the aperture are instead excluded from the
//   L_star fit entirely (see MAX_SAT_FRACTION in sqm_math.js, issue #13).
// - saturated_fraction: fraction of aperture pixels at or above SAT_THRESHOLD.
// - saturated_pixels: absolute count of aperture pixels at or above SAT_THRESHOLD.
// - skyBg: the sky background estimate (SExtractor mode) used for the subtraction,
//   returned so callers/tests can verify adu_star independently without
//   recomputing the annulus statistics.
// - starX/starY: the fractional center actually used for this frame — the
//   WCS-projected position (via celestialToImage) when starRaDec is given and
//   this frame has an astrometric solution, otherwise the starX/starY passed in.
//
// Center/distance convention: pixel (ix, iy) is treated as covering
// [ix, ix+1) x [iy, iy+1), i.e. its center is (ix+0.5, iy+0.5) (assumed PCL
// convention — the 0.5 px offset is negligible against a 15 px aperture).
//============================================================================

function aperturePhotometry(filepath, starX, starY, aperture, bitsPerSample, sqmChannel, starRaDec) {
   var wins = ImageWindow.open(filepath);
   if (!wins || wins.length === 0) return null;
   var win = wins[0];
   try {
      var image = win.mainView.image;

      // Per-frame star center: prefer the WCS-projected position for this specific
      // frame's solution over the fixed pixel coordinates passed in.
      var cx = starX;
      var cy = starY;
      if (starRaDec && win.hasAstrometricSolution === true) {
         var projected = safeCelestialToImage(win, starRaDec.ra, starRaDec.dec);
         if (projected) {
            cx = projected.x;
            cy = projected.y;
         } else {
            console.warningln("  [WARN] Could not project star position onto "
               + File.extractName(filepath) + " — using fixed star coords");
         }
      }

      var isColor  = (image.numberOfChannels >= 3);
      var ch       = (isColor && sqmChannel === "G") ? 1 : 0;
      var maxADU   = (bitsPerSample === 32) ? 4294967295 : 65535;
      var satLimit = SAT_THRESHOLD * maxADU;

      var r_ap  = aperture;
      var r_in  = aperture + 5;
      var r_out = aperture + 25;  // widened for more stable background estimate

      // Sky annulus — sigma-clipped, SExtractor-style mode estimate
      var skyPixels = [];
      var skyYLo = Math.floor(cy - r_out) - 1;
      var skyYHi = Math.ceil(cy + r_out) + 1;
      var skyXLo = Math.floor(cx - r_out) - 1;
      var skyXHi = Math.ceil(cx + r_out) + 1;
      for (var y = skyYLo; y <= skyYHi; y++) {
         if (y < 0 || y >= image.height) continue;
         var skyPy = y + 0.5;
         for (var x = skyXLo; x <= skyXHi; x++) {
            if (x < 0 || x >= image.width) continue;
            var skyPx = x + 0.5;
            var dx = skyPx - cx;
            var dy = skyPy - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= r_in && dist <= r_out) {
               skyPixels.push(image.sample(x, y, ch) * maxADU);
            }
         }
      }

      var skyStats = sigmaClippingStats(skyPixels, 3.0, 10);
      // SExtractor mode: more robust when faint stars contaminate the annulus
      var skyBg = 2.5 * skyStats.median - 1.5 * skyStats.mean;
      if (skyBg <= 0) skyBg = skyStats.median;  // fallback for pathological cases

      // Aperture sum — ALL pixels included (no saturation fill-in; see header comment above)
      var aperSum  = 0;
      var apCount  = 0;
      var satCount = 0;
      var apYLo = Math.floor(cy - r_ap) - 1;
      var apYHi = Math.ceil(cy + r_ap) + 1;
      var apXLo = Math.floor(cx - r_ap) - 1;
      var apXHi = Math.ceil(cx + r_ap) + 1;
      for (var y = apYLo; y <= apYHi; y++) {
         if (y < 0 || y >= image.height) continue;
         var apPy = y + 0.5;
         for (var x = apXLo; x <= apXHi; x++) {
            if (x < 0 || x >= image.width) continue;
            var apPx = x + 0.5;
            var dx = apPx - cx;
            var dy = apPy - cy;
            if (dx * dx + dy * dy <= r_ap * r_ap) {
               apCount++;
               var pixADU = image.sample(x, y, ch) * maxADU;
               if (pixADU >= satLimit) satCount++;
               aperSum += pixADU;
            }
         }
      }

      var netFlux = (apCount > 0) ? (aperSum - skyBg * apCount) : NaN;
      var saturated_fraction = (apCount > 0) ? (satCount / apCount) : 0;
      return {
         adu_star:            netFlux,
         saturated_fraction:  saturated_fraction,
         saturated_pixels:    satCount,
         starX:               cx,
         starY:               cy,
         skyBg:               skyBg
      };
   } finally {
      // Always release the window, even if projection or sampling throws.
      win.close();
   }
}

//============================================================================
// Main analysis: iterate over all frames, collect data, compute SQM
//============================================================================

function runAnalysis(frames, bgX, bgY, starX, starY, aperture, vmag, cameraEntry, telescopeEntry, starRaDec) {
   if (!cameraEntry || !telescopeEntry) return null;

   var pixelScale    = computePixelScale(cameraEntry.pixel_pitch, telescopeEntry.focal_length, 1);
   var sqmChannel    = cameraEntry.sqm_channel || "G";
   var bitsPerSample = frames[0].bitsPerSample;

   var skyFrameData  = [];
   var starFrameData = [];
   var frameResults  = [];  // per-frame data for UI display

   for (var i = 0; i < frames.length; i++) {
      var f  = frames[i];

      if (starRaDec && !f.hasWcs) {
         console.writeln("  [WARN] No astrometric solution for " + f.filename + " — using fixed star coords");
      }

      var bg = measureBackground(f.filepath, bgX, bgY, bitsPerSample, sqmChannel);
      // aperturePhotometry projects starRaDec onto this frame via its own WCS
      // when available, falling back to (starX, starY) otherwise.
      var ap = aperturePhotometry(f.filepath, starX, starY, aperture, bitsPerSample, sqmChannel, starRaDec);

      if (!bg || !ap) {
         console.warningln("Skipping frame (measurement failed): " + f.filename);
         continue;
      }

      var satPct = Math.round((ap.saturated_fraction || 0) * 100);
      console.writeln(format("  %-40s  t=%5.1fs  bg=%8.1f ADU  star=%11.0f ADU  sat=%2d%% (%d px)  starXY=(%.1f,%.1f)",
         f.filename, f.exptime, bg.adu_sky, ap.adu_star, satPct, ap.saturated_pixels || 0, ap.starX, ap.starY));

      skyFrameData.push({ exptime: f.exptime, adu_sky: bg.adu_sky });
      starFrameData.push({
         exptime:             f.exptime,
         adu_star:            ap.adu_star,
         saturated_fraction:  ap.saturated_fraction || 0
      });
      frameResults.push({
         filename:            f.filename,
         exptime:             f.exptime,
         adu_star:            ap.adu_star,
         saturated_fraction:  ap.saturated_fraction || 0,
         saturated_pixels:    ap.saturated_pixels || 0
      });
   }

   if (skyFrameData.length < 2) return null;

   var lSkyResult  = computeLSky(skyFrameData);
   var lStarResult = computeLStar(starFrameData);
   var lPrimeSky   = computeLPrimeSky(lSkyResult.L_sky, pixelScale);
   var sqm         = computeSQM(lStarResult.L_star, lPrimeSky, vmag);
   var label       = skyConditionLabel(sqm);

   // Tag each frame as used (no saturated pixels in the aperture) or excluded.
   // Uses the same threshold as computeLStar()'s own exclusion criterion
   // (MAX_SAT_FRACTION, defined in sqm_math.js) so the two never disagree.
   for (var k = 0; k < frameResults.length; k++) {
      frameResults[k].used = (frameResults[k].saturated_fraction <= MAX_SAT_FRACTION);
   }

   // Linearity check (warning only, not an exclusion — see RATE_DEV_WARN comment above):
   // for frames used in the L_star fit, adu_star/exptime should be a constant rate.
   // Flag frames whose rate deviates from the median rate by more than RATE_DEV_WARN.
   var usedRates = [];
   for (var k = 0; k < frameResults.length; k++) {
      if (frameResults[k].used) {
         usedRates.push(frameResults[k].adu_star / frameResults[k].exptime);
      }
   }
   var rateMedian = (usedRates.length > 0) ? median(usedRates) : NaN;
   var nonlinearFrames = [];
   for (var k = 0; k < frameResults.length; k++) {
      if (!frameResults[k].used || usedRates.length === 0 || rateMedian === 0) {
         frameResults[k].rate_deviation = null;
         frameResults[k].nonlinear = false;
         continue;
      }
      var rate = frameResults[k].adu_star / frameResults[k].exptime;
      var dev  = rate / rateMedian - 1;
      frameResults[k].rate_deviation = dev;
      frameResults[k].nonlinear = (Math.abs(dev) > RATE_DEV_WARN);
      if (frameResults[k].nonlinear) {
         nonlinearFrames.push(frameResults[k].filename + " (" + (dev * 100).toFixed(1) + "%)");
      }
   }

   return {
      L_sky:            lSkyResult.L_sky,
      r2_sky:           lSkyResult.r2,
      L_star:           lStarResult.L_star,
      r2_star:          lStarResult.r2,
      L_prime_sky:      lPrimeSky,
      pixel_scale:      pixelScale,
      sqm:              sqm,
      label:            label,
      n_frames:         skyFrameData.length,
      excluded_frames:  lStarResult.excluded_frames || 0,
      nonlinear_frames: nonlinearFrames,
      frameData:        frameResults,
      sqmChannel:       sqmChannel,
      bgX:              bgX,
      bgY:              bgY,
      starX:            starX,
      starY:            starY,
      aperture:         aperture,
      vmag:             vmag
   };
}

//============================================================================
// CSV export
//============================================================================

function exportCSV(result, frames, outputPath) {
   var lines = [];
   lines.push("# Sky Quality Analyzer v" + VERSION);
   lines.push("# Generated: " + (new Date()).toISOString());
   lines.push("");
   lines.push("# Results");
   lines.push("SQM,\"" + result.sqm.toFixed(3) + " mag/arcsec²\"");
   lines.push("SkyCondition,\"" + result.label + "\"");
   lines.push("L_sky,\"" + result.L_sky.toFixed(4) + " counts/s/px\"");
   lines.push("R2_sky,\"" + result.r2_sky.toFixed(5) + "\"");
   lines.push("L_star,\"" + result.L_star.toFixed(1) + " counts/s\"");
   lines.push("R2_star,\"" + result.r2_star.toFixed(5) + "\"");
   lines.push("L_prime_sky,\"" + result.L_prime_sky.toFixed(6) + " counts/s/arcsec²\"");
   lines.push("PixelScale,\"" + result.pixel_scale.toFixed(3) + " arcsec/px\"");
   lines.push("VMag,\"" + result.vmag.toFixed(3) + "\"");
   lines.push("Channel,\"" + result.sqmChannel + "\"");
   lines.push("BackgroundROI,\"(" + result.bgX + "," + result.bgY + ") 64×64 px\"");
   lines.push("StarPosition,\"(" + result.starX.toFixed(2) + "," + result.starY.toFixed(2) + ")\"");
   lines.push("Aperture,\"" + result.aperture + " px\"");
   lines.push("NFrames,\"" + result.n_frames + "\"");
   lines.push("");
   lines.push("# Frames");
   lines.push("filename,exptime_s");
   for (var i = 0; i < frames.length; i++) {
      lines.push("\"" + frames[i].filename + "\"," + frames[i].exptime.toFixed(3));
   }

   File.writeTextFile(outputPath, lines.join("\n") + "\n");
}

//============================================================================
// Main Dialog
//============================================================================

var SkyQualityAnalyzerDialog = class extends Dialog {
constructor() {
      super();

   var self = this;

   // State
   this.frames    = [];           // Array of frame metadata objects
   this.bgX       = -1;           // Background ROI center X
   this.bgY       = -1;           // Background ROI center Y
   this.starX     = -1;           // Reference star X
   this.starY     = -1;           // Reference star Y
   this.starRaDec = null;         // { ra, dec } of the reference star, if tied to sky coordinates
   this.vmag      = NaN;          // V magnitude
   this.sqmResult = null;         // Last analysis result

   this.windowTitle = TITLE + " v" + VERSION;
   this.minWidth    = 720;

   // =====================================================
   // Title
   // =====================================================
   var titleLabel = new Label(this);
   titleLabel.text = TITLE + "  —  Reference Star Method";
   titleLabel.textAlignment = TextAlignment.Center | TextAlignment.VertCenter;

   // =====================================================
   // Section 1: Frames
   // =====================================================
   this.framesGroupBox = new GroupBox(this);
   var framesGroupBox = this.framesGroupBox;
   framesGroupBox.title = "1. Frames (WBPP calibrated/debayered)";
   framesGroupBox.sizer = new VerticalSizer;
   framesGroupBox.sizer.margin  = 8;
   framesGroupBox.sizer.spacing = 6;

   this.frameTree = new TreeBox(framesGroupBox);
   this.frameTree.headerVisible  = true;
   this.frameTree.numberOfColumns = 7;
   this.frameTree.setColumnWidth(0, 280);
   this.frameTree.setColumnWidth(1, 70);
   this.frameTree.setColumnWidth(2, 70);
   this.frameTree.setColumnWidth(3, 45);
   this.frameTree.setColumnWidth(4, 90);
   this.frameTree.setColumnWidth(5, 90);
   this.frameTree.setColumnWidth(6, 80);
   this.frameTree.setHeaderText(0, "Filename");
   this.frameTree.setHeaderText(1, "Exp (s)");
   this.frameTree.setHeaderText(2, "Color");
   this.frameTree.setHeaderText(3, "WCS");
   this.frameTree.setHeaderText(4, "Flux (ADU)");
   this.frameTree.setHeaderText(5, "Sat%");
   this.frameTree.setHeaderText(6, "Status");
   this.frameTree.setMinHeight(120);
   this.frameTree.toolTip = "List of FITS frames to analyze. Flux, Sat% and Status are filled after analysis.";

   var addFramesBtn = new PushButton(framesGroupBox);
   addFramesBtn.text    = "Add Frames...";
   addFramesBtn.toolTip = "Add calibrated FITS frames";
   addFramesBtn.onClick = function() {
      var od = new OpenFileDialog;
      od.caption      = "Select Calibrated Frames (FITS / XISF)";
      od.multipleSelections = true;
      od.filters = [
         ["All Supported Files", "*.xisf", "*.fit", "*.fits", "*.fts"],
         ["XISF Files", "*.xisf"],
         ["FITS Files", "*.fit", "*.fits", "*.fts"]
      ];
      if (!od.execute()) return;

      var added = 0;
      for (var i = 0; i < od.filePaths.length; i++) {
         var fp = od.filePaths[i];
         // Skip duplicates
         var dup = false;
         for (var j = 0; j < self.frames.length; j++) {
            if (self.frames[j].filepath === fp) { dup = true; break; }
         }
         if (dup) continue;

         console.writeln("Reading: " + File.extractName(fp));
         console.flush();
         var meta = readFrameMetadata(fp);
         if (meta) {
            self.frames.push(meta);
            added++;
         } else {
            console.warningln("  → Skipped (EXPTIME missing or file error)");
         }
      }

      self.refreshFrameTree();

      // Auto-detect camera from first frame's INSTRUME header
      if (added > 0 && self.frames.length > 0) {
         var instrume = self.frames[0].instrume;
         if (instrume) {
            for (var ci = 0; ci < gEquipment.cameras.length; ci++) {
               if (gEquipment.cameras[ci].instrume &&
                   gEquipment.cameras[ci].instrume.toLowerCase() === instrume.toLowerCase()) {
                  self.cameraCombo.currentItem = ci;
                  break;
               }
            }
         }
      }
   };

   var removeFrameBtn = new PushButton(framesGroupBox);
   removeFrameBtn.text    = "Remove Selected";
   removeFrameBtn.toolTip = "Remove selected frame from the list";
   removeFrameBtn.onClick = function() {
      var sel = self.frameTree.selectedNodes;
      if (sel.length === 0) return;
      var indices = [];
      for (var i = 0; i < sel.length; i++) {
         var idx = self.frameTree.childIndex(sel[i]);
         if (idx >= 0) indices.push(idx);
      }
      indices.sort(function(a, b) { return b - a; });
      for (var i = 0; i < indices.length; i++) {
         self.frames.splice(indices[i], 1);
      }
      self.refreshFrameTree();
   };

   var clearFramesBtn = new PushButton(framesGroupBox);
   clearFramesBtn.text    = "Clear All";
   clearFramesBtn.toolTip = "Remove all frames from the list";
   clearFramesBtn.onClick = function() {
      self.frames = [];
      self.refreshFrameTree();
   };

   var frameBtnSizer = new HorizontalSizer;
   frameBtnSizer.spacing = 6;
   frameBtnSizer.add(addFramesBtn);
   frameBtnSizer.add(removeFrameBtn);
   frameBtnSizer.add(clearFramesBtn);
   frameBtnSizer.addStretch();

   framesGroupBox.sizer.add(this.frameTree);
   framesGroupBox.sizer.add(frameBtnSizer);

   // =====================================================
   // Section 2: Equipment
   // =====================================================
   var equipGroupBox = new GroupBox(this);
   equipGroupBox.title = "2. Equipment";
   equipGroupBox.sizer = new VerticalSizer;
   equipGroupBox.sizer.margin  = 8;
   equipGroupBox.sizer.spacing = 6;

   var cameraLabel = new Label(equipGroupBox);
   cameraLabel.text = "Camera:";
   cameraLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   cameraLabel.setFixedWidth(80);

   this.cameraCombo = new ComboBox(equipGroupBox);
   this.cameraCombo.toolTip = "Select camera";
   for (var i = 0; i < gEquipment.cameras.length; i++) {
      this.cameraCombo.addItem(gEquipment.cameras[i].name);
   }
   this.cameraCombo.onItemSelected = function() { self.updatePixelScale(); };

   var camRow = new HorizontalSizer;
   camRow.spacing = 6;
   camRow.add(cameraLabel);
   camRow.add(this.cameraCombo, 100);

   var teleLabel = new Label(equipGroupBox);
   teleLabel.text = "Telescope:";
   teleLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   teleLabel.setFixedWidth(80);

   this.teleCombo = new ComboBox(equipGroupBox);
   this.teleCombo.toolTip = "Select telescope";
   for (var i = 0; i < gEquipment.telescopes.length; i++) {
      this.teleCombo.addItem(gEquipment.telescopes[i].name);
   }
   this.teleCombo.onItemSelected = function() { self.updatePixelScale(); };

   var teleRow = new HorizontalSizer;
   teleRow.spacing = 6;
   teleRow.add(teleLabel);
   teleRow.add(this.teleCombo, 100);

   this.pixelScaleLabel = new Label(equipGroupBox);
   this.pixelScaleLabel.text = "Pixel Scale:  —  arcsec/px";
   this.pixelScaleLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   equipGroupBox.sizer.add(camRow);
   equipGroupBox.sizer.add(teleRow);
   equipGroupBox.sizer.add(this.pixelScaleLabel);

   // =====================================================
   // Section 3: Measurement Settings
   // =====================================================
   this.measureGroupBox = new GroupBox(this);
   var measureGroupBox = this.measureGroupBox;
   measureGroupBox.title = "3. Measurement Settings";
   measureGroupBox.sizer = new VerticalSizer;
   measureGroupBox.sizer.margin  = 8;
   measureGroupBox.sizer.spacing = 6;

   // Background ROI
   var bgLabel = new Label(measureGroupBox);
   bgLabel.text = "Background:";
   bgLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   bgLabel.setFixedWidth(100);

   this.bgPosLabel = new Label(measureGroupBox);
   this.bgPosLabel.text = "(not selected)";
   this.bgPosLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   var bgSelectBtn = new PushButton(measureGroupBox);
   bgSelectBtn.text    = "Select Region...";
   bgSelectBtn.toolTip = "Click on a star-free background region (longest-exposure frame shown)";
   bgSelectBtn.onClick = function() {
      if (self.frames.length === 0) {
         var mb = new MessageBox("Please add frames first.", TITLE, StdIcon.Warning, StdButton.Ok);
         mb.execute();
         return;
      }
      // Use longest-exposure frame so faint background structure is visible
      var bgFrame = self.frames[0];
      for (var fi = 0; fi < self.frames.length; fi++) {
         if (self.frames[fi].exptime > bgFrame.exptime) bgFrame = self.frames[fi];
      }
      // Construction itself can throw (e.g. while loading the preview bitmap), so
      // it goes inside the try too — otherwise a failed construction would leak
      // the ImageWindow it had already opened.
      var dlg = null;
      try {
         dlg = new PointSelectionDialog(self, "Select Background Region",
            bgFrame.filepath, "background", 0);
         if (dlg.execute() === 1) {
            self.bgX = dlg.selectedX;
            self.bgY = dlg.selectedY;
            self.bgPosLabel.text = "X=" + self.bgX + "  Y=" + self.bgY + "  (64×64 px region)";
            self.updateUI();
         }
      } finally {
         if (dlg) dlg.releaseImage();
      }
   };

   var bgRow = new HorizontalSizer;
   bgRow.spacing = 6;
   bgRow.add(bgLabel);
   bgRow.add(this.bgPosLabel, 100);
   bgRow.add(bgSelectBtn);

   // Star position
   var starPosLabel = new Label(measureGroupBox);
   starPosLabel.text = "Star Position:";
   starPosLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   starPosLabel.setFixedWidth(100);

   this.starPosDisplay = new Label(measureGroupBox);
   this.starPosDisplay.text = "(not selected)";
   this.starPosDisplay.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   var starSelectBtn = new PushButton(measureGroupBox);
   starSelectBtn.text    = "Select Star...";
   starSelectBtn.toolTip = "Click on the reference star (longest-exposure frame shown)";
   starSelectBtn.onClick = function() {
      if (self.frames.length === 0) {
         var mb = new MessageBox("Please add frames first.", TITLE, StdIcon.Warning, StdButton.Ok);
         mb.execute();
         return;
      }
      var ap = self.apertureSpinBox.value;
      // Compute current pixel scale from selected equipment for NearbyStarDialog suitability column.
      var currentPs = 0;
      var ci = self.cameraCombo.currentItem;
      var ti = self.teleCombo.currentItem;
      if (ci >= 0 && ti >= 0 && ci < gEquipment.cameras.length && ti < gEquipment.telescopes.length) {
         var camE  = gEquipment.cameras[ci];
         var teleE = gEquipment.telescopes[ti];
         if (camE.pixel_pitch > 0 && teleE.focal_length > 0) {
            currentPs = computePixelScale(camE.pixel_pitch, teleE.focal_length, 1);
         }
      }
      // Use longest-exposure frame with an astrometric solution (best SNR for star
      // identification). Fall back to longest-exposure frame without one if none are solved.
      var previewFrame = null;
      for (var fi = 0; fi < self.frames.length; fi++) {
         if (self.frames[fi].hasWcs) {
            if (!previewFrame || self.frames[fi].exptime > previewFrame.exptime)
               previewFrame = self.frames[fi];
         }
      }
      if (!previewFrame) {
         previewFrame = self.frames[0];
         for (var fi = 0; fi < self.frames.length; fi++) {
            if (self.frames[fi].exptime > previewFrame.exptime) previewFrame = self.frames[fi];
         }
      }
      var dlg = null;
      try {
         dlg = new PointSelectionDialog(self, "Select Reference Star",
            previewFrame.filepath, "star", ap, currentPs);
         if (dlg.execute() === 1) {
            self.starX     = dlg.selectedX;
            self.starY     = dlg.selectedY;
            self.starRaDec = dlg.selectedRaDec || null;
            self.starPosDisplay.text = "X=" + self.starX.toFixed(2) + "  Y=" + self.starY.toFixed(2);
            // Auto-fill name and V mag if a catalog star was identified
            if (dlg.selectedStar) {
               self.starNameEdit.text = dlg.selectedStar.id;
               self.vmagEdit.text     = dlg.selectedStar.vmag.toFixed(3);
               self.vmag              = dlg.selectedStar.vmag;
            }
            self.updateUI();
         }
      } finally {
         if (dlg) dlg.releaseImage();
      }
   };

   var starRow = new HorizontalSizer;
   starRow.spacing = 6;
   starRow.add(starPosLabel);
   starRow.add(this.starPosDisplay, 100);
   starRow.add(starSelectBtn);

   // Aperture radius
   var apLabel = new Label(measureGroupBox);
   apLabel.text = "Aperture Radius:";
   apLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   apLabel.setFixedWidth(100);

   this.apertureSpinBox = new SpinBox(measureGroupBox);
   this.apertureSpinBox.minValue = 5;
   this.apertureSpinBox.maxValue = 100;
   this.apertureSpinBox.value    = 15;
   this.apertureSpinBox.toolTip  = "Aperture radius in pixels. Increase for defocused stars.";

   var apUnitLabel = new Label(measureGroupBox);
   apUnitLabel.text = "px  (sky annulus: r+5 to r+25)";
   apUnitLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   var apRow = new HorizontalSizer;
   apRow.spacing = 6;
   apRow.add(apLabel);
   apRow.add(this.apertureSpinBox);
   apRow.add(apUnitLabel);
   apRow.addStretch();

   measureGroupBox.sizer.add(bgRow);
   measureGroupBox.sizer.add(starRow);
   measureGroupBox.sizer.add(apRow);

   // =====================================================
   // Section 4: Reference Star
   // =====================================================
   this.starGroupBox = new GroupBox(this);
   var starGroupBox = this.starGroupBox;
   starGroupBox.title = "4. Reference Star Magnitude";
   starGroupBox.sizer = new VerticalSizer;
   starGroupBox.sizer.margin  = 8;
   starGroupBox.sizer.spacing = 6;

   var starNameLabel = new Label(starGroupBox);
   starNameLabel.text = "Star Name:";
   starNameLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   starNameLabel.setFixedWidth(90);

   this.starNameEdit = new Edit(starGroupBox);
   this.starNameEdit.toolTip = "Enter star name (e.g., Tarazed, gamma Aql, Vega)";

   var searchBtn = new PushButton(starGroupBox);
   searchBtn.text    = "Search";
   searchBtn.toolTip = "Search star V magnitude via CDS Sesame";
   searchBtn.onClick = function() {
      var name = self.starNameEdit.text.trim();
      if (name.length === 0) {
         var mb = new MessageBox("Please enter a star name.", TITLE, StdIcon.Warning, StdButton.Ok);
         mb.execute();
         return;
      }
      console.writeln("Sesame: searching '" + name + "'...");
      console.flush();
      var info = searchStarInfo(name);
      if (info) {
         console.writeln("  → RA=" + info.ra.toFixed(4)
            + " Dec=" + info.dec.toFixed(4)
            + (info.vmag !== null ? "  V=" + info.vmag.toFixed(3) : "  (V mag not found)"));
         if (info.vmag !== null) {
            self.vmagEdit.text = info.vmag.toFixed(3);
            self.vmag = info.vmag;
         } else {
            var mb = new MessageBox(
               "'" + name + "' found but no V magnitude in catalog.\n"
               + "Please enter V magnitude manually.",
               TITLE, StdIcon.Warning, StdButton.Ok);
            mb.execute();
         }
      } else {
         var mb = new MessageBox(
            "'" + name + "' not found.\nPlease enter V magnitude manually.",
            TITLE, StdIcon.Warning, StdButton.Ok);
         mb.execute();
      }
   };

   var nameRow = new HorizontalSizer;
   nameRow.spacing = 6;
   nameRow.add(starNameLabel);
   nameRow.add(this.starNameEdit, 100);
   nameRow.add(searchBtn);

   var vmagLabel = new Label(starGroupBox);
   vmagLabel.text = "V Magnitude:";
   vmagLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   vmagLabel.setFixedWidth(90);

   this.vmagEdit = new Edit(starGroupBox);
   this.vmagEdit.toolTip = "Catalog V magnitude of the reference star";
   this.vmagEdit.onTextUpdated = function(text) {
      var v = parseFloat(text);
      self.vmag = isNaN(v) ? NaN : v;
      self.updateUI();
   };

   var vmagHint = new Label(starGroupBox);
   vmagHint.text = "mag  (e.g., Vega=0.03, Tarazed=2.72, Deneb=1.25)";
   vmagHint.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   var vmagRow = new HorizontalSizer;
   vmagRow.spacing = 6;
   vmagRow.add(vmagLabel);
   vmagRow.add(this.vmagEdit);
   vmagRow.add(vmagHint);
   vmagRow.addStretch();

   starGroupBox.sizer.add(nameRow);
   starGroupBox.sizer.add(vmagRow);

   // =====================================================
   // Section 5: Analyze button
   // =====================================================
   this.analyzeBtn = new PushButton(this);
   this.analyzeBtn.text    = "  Analyze  ";
   this.analyzeBtn.toolTip = "Run background + aperture photometry and compute SQM";
   this.analyzeBtn.enabled = false;
   this.analyzeBtn.onClick = function() {
      self.runAnalysis();
   };

   var analyzeSizer = new HorizontalSizer;
   analyzeSizer.addStretch();
   analyzeSizer.add(this.analyzeBtn);
   analyzeSizer.addStretch();

   // =====================================================
   // Section 6: Results
   // =====================================================
   var resultsGroupBox = new GroupBox(this);
   resultsGroupBox.title = "Results";
   resultsGroupBox.sizer = new VerticalSizer;
   resultsGroupBox.sizer.margin  = 8;
   resultsGroupBox.sizer.spacing = 4;

   this.resultSQMLabel        = new Label(resultsGroupBox);
   this.resultConditionLabel  = new Label(resultsGroupBox);
   this.resultLSkyLabel       = new Label(resultsGroupBox);
   this.resultLStarLabel      = new Label(resultsGroupBox);
   this.resultPixScaleLabel   = new Label(resultsGroupBox);
   this.resultNFramesLabel    = new Label(resultsGroupBox);

   var labelStyle = TextAlignment.Left | TextAlignment.VertCenter;
   this.resultSQMLabel.textAlignment       = labelStyle;
   this.resultConditionLabel.textAlignment = labelStyle;
   this.resultLSkyLabel.textAlignment      = labelStyle;
   this.resultLStarLabel.textAlignment     = labelStyle;
   this.resultPixScaleLabel.textAlignment  = labelStyle;
   this.resultNFramesLabel.textAlignment   = labelStyle;

   this.resultWarningLabel = new Label(resultsGroupBox);
   this.resultWarningLabel.textAlignment  = labelStyle;
   this.resultWarningLabel.text = "";

   this.clearResults();

   resultsGroupBox.sizer.add(this.resultSQMLabel);
   resultsGroupBox.sizer.add(this.resultConditionLabel);
   resultsGroupBox.sizer.add(this.resultLSkyLabel);
   resultsGroupBox.sizer.add(this.resultLStarLabel);
   resultsGroupBox.sizer.add(this.resultPixScaleLabel);
   resultsGroupBox.sizer.add(this.resultNFramesLabel);
   resultsGroupBox.sizer.add(this.resultWarningLabel);

   this.exportCSVBtn = new PushButton(resultsGroupBox);
   this.exportCSVBtn.text    = "Export CSV...";
   this.exportCSVBtn.toolTip = "Export analysis results to CSV file";
   this.exportCSVBtn.enabled = false;
   this.exportCSVBtn.onClick = function() {
      if (!self.sqmResult) return;
      var sd = new SaveFileDialog;
      sd.caption      = "Save Results as CSV";
      sd.filters      = [["CSV Files", "*.csv"]];
      sd.initialPath  = "sqm_result.csv";
      if (!sd.execute()) return;
      try {
         exportCSV(self.sqmResult, self.frames, sd.filePath);
         console.writeln("Results exported: " + sd.filePath);
         var mb = new MessageBox("Exported:\n" + sd.filePath, TITLE, StdIcon.NoIcon, StdButton.Ok);
         mb.execute();
      } catch (e) {
         var mb = new MessageBox("Export failed:\n" + e, TITLE, StdIcon.Error, StdButton.Ok);
         mb.execute();
      }
   };

   var exportRow = new HorizontalSizer;
   exportRow.addStretch();
   exportRow.add(this.exportCSVBtn);

   resultsGroupBox.sizer.add(exportRow);

   // =====================================================
   // Close button
   // =====================================================
   var closeBtn = new PushButton(this);
   closeBtn.text = "Close";
   closeBtn.icon = this.scaledResource(":/icons/close.png");
   closeBtn.onClick = function() { self.cancel(); };

   var closeSizer = new HorizontalSizer;
   closeSizer.addStretch();
   closeSizer.add(closeBtn);

   // =====================================================
   // Main layout
   // =====================================================
   this.sizer = new VerticalSizer;
   this.sizer.margin  = 10;
   this.sizer.spacing = 8;
   this.sizer.add(titleLabel);

   this.sizer.add(framesGroupBox);
   this.sizer.add(equipGroupBox);
   this.sizer.add(measureGroupBox);
   this.sizer.add(starGroupBox);
   this.sizer.add(analyzeSizer);
   this.sizer.add(resultsGroupBox);
   this.sizer.add(closeSizer);

   this.adjustToContents();
   this.updatePixelScale();
   this.updateUI();
   }

   refreshFrameTree(frameData) {
   this.frames.sort(function(a, b) { return a.exptime - b.exptime; });
   this.frameTree.clear();
   for (var i = 0; i < this.frames.length; i++) {
      var f = this.frames[i];
      var node = new TreeBoxNode(this.frameTree);
      node.setText(0, f.filename);
      node.setText(1, f.exptime.toFixed(3));
      node.setText(2, f.isColor ? "Color" : "Mono");
      node.setText(3, f.hasWcs ? "Yes" : "\u2014");

      // Fill analysis columns if results are available
      var filled = false;
      if (frameData) {
         for (var j = 0; j < frameData.length; j++) {
            if (frameData[j].filename === f.filename) {
               var fd = frameData[j];
               var satPct = (fd.saturated_fraction * 100).toFixed(1);
               var satPx  = fd.saturated_pixels || 0;
               var status = !fd.used ? "Sat" : (fd.nonlinear ? "Nonlin" : "OK");
               node.setText(4, isNaN(fd.adu_star) ? "\u2014" : Math.round(fd.adu_star).toString());
               node.setText(5, satPct + "% (" + satPx + ")");
               node.setText(6, status);
               filled = true;
               break;
            }
         }
      }
      if (!filled) {
         node.setText(4, "\u2014");
         node.setText(5, "\u2014");
         node.setText(6, "\u2014");
      }
   }
   this.updateUI();
   }

   updateUI() {
   var nf = this.frames.length;
   this.framesGroupBox.title = nf > 0
      ? "1. Frames (WBPP calibrated/debayered)  [" + nf + " frames \u2713]"
      : "1. Frames (WBPP calibrated/debayered)";

   var bgOk   = this.bgX >= 0 && this.bgY >= 0;
   var starOk = this.starX >= 0 && this.starY >= 0;
   this.measureGroupBox.title = "3. Measurement Settings"
      + "  [Background " + (bgOk   ? "\u2713" : "\u2717") + "]"
      + "  [Star "       + (starOk ? "\u2713" : "\u2717") + "]";

   var vmagOk = !isNaN(this.vmag);
   this.starGroupBox.title = "4. Reference Star Magnitude"
      + "  [V mag " + (vmagOk ? "\u2713" : "\u2717") + "]";

   this.analyzeBtn.enabled = (nf >= 2 && bgOk && starOk && vmagOk);
   }

   updatePixelScale() {
   var ci = this.cameraCombo.currentItem;
   var ti = this.teleCombo.currentItem;
   if (ci < 0 || ti < 0 || ci >= gEquipment.cameras.length || ti >= gEquipment.telescopes.length) {
      this.pixelScaleLabel.text = "Pixel Scale:  —  arcsec/px";
      return;
   }
   var cam  = gEquipment.cameras[ci];
   var tele = gEquipment.telescopes[ti];
   if (cam.pixel_pitch > 0 && tele.focal_length > 0) {
      var ps = computePixelScale(cam.pixel_pitch, tele.focal_length, 1);
      this.pixelScaleLabel.text = "Pixel Scale:  " + ps.toFixed(3) + " arcsec/px"
         + "  (" + cam.pixel_pitch + " μm / " + tele.focal_length + " mm)";
   } else {
      this.pixelScaleLabel.text = "Pixel Scale:  —  arcsec/px  (Custom: fill in pixel_pitch / focal_length)";
   }
   }

   clearResults() {
   this.resultSQMLabel.text       = "SQM:             \u2014";
   this.resultConditionLabel.text = "Sky Condition:   \u2014";
   this.resultLSkyLabel.text      = "L_sky:           \u2014";
   this.resultLStarLabel.text     = "L_star:          \u2014";
   this.resultPixScaleLabel.text  = "Pixel Scale:     \u2014";
   this.resultNFramesLabel.text   = "Frames:          \u2014";
   if (this.resultWarningLabel) this.resultWarningLabel.text = "";
   if (this.exportCSVBtn) this.exportCSVBtn.enabled = false;
   this.sqmResult = null;
   }

   runAnalysis() {
   var self = this;

   // Validation
   if (this.frames.length < 2) {
      var mb = new MessageBox("Please add at least 2 frames.", TITLE, StdIcon.Warning, StdButton.Ok);
      mb.execute();
      return;
   }
   if (this.bgX < 0 || this.bgY < 0) {
      var mb = new MessageBox("Please select a background region.", TITLE, StdIcon.Warning, StdButton.Ok);
      mb.execute();
      return;
   }
   if (this.starX < 0 || this.starY < 0) {
      var mb = new MessageBox("Please select a reference star position.", TITLE, StdIcon.Warning, StdButton.Ok);
      mb.execute();
      return;
   }
   if (isNaN(this.vmag)) {
      var mb = new MessageBox("Please enter or search the V magnitude of the reference star.",
         TITLE, StdIcon.Warning, StdButton.Ok);
      mb.execute();
      return;
   }

   var ci = this.cameraCombo.currentItem;
   var ti = this.teleCombo.currentItem;
   if (ci < 0 || ci >= gEquipment.cameras.length ||
       ti < 0 || ti >= gEquipment.telescopes.length) {
      var mb = new MessageBox("Please select a camera and telescope.", TITLE, StdIcon.Warning, StdButton.Ok);
      mb.execute();
      return;
   }

   var cam  = gEquipment.cameras[ci];
   var tele = gEquipment.telescopes[ti];

   if (cam.pixel_pitch <= 0 || tele.focal_length <= 0) {
      var mb = new MessageBox(
         "Custom equipment selected but pixel_pitch or focal_length is 0.\n"
         + "Please edit equipment.json or select a specific camera/telescope.",
         TITLE, StdIcon.Warning, StdButton.Ok);
      mb.execute();
      return;
   }

   var aperture = this.apertureSpinBox.value;

   console.writeln("");
   console.writeln("<b>Sky Quality Analyzer v" + VERSION + " — Analysis</b>");
   console.writeln("---");
   console.writeln("Camera:    " + cam.name + "  (channel: " + (cam.sqm_channel || "G") + ")");
   console.writeln("Telescope: " + tele.name);
   console.writeln("Frames:    " + this.frames.length);
   console.writeln("Background ROI: (" + this.bgX + ", " + this.bgY + ") 64×64 px");
   console.writeln("Star Position:  (" + this.starX.toFixed(2) + ", " + this.starY.toFixed(2) + ")  aperture=" + aperture + " px");
   console.writeln("V magnitude:    " + this.vmag.toFixed(3));
   console.writeln("");

   this.clearResults();
   this.analyzeBtn.enabled = false;

   try {
      var result = runAnalysis(
         this.frames, this.bgX, this.bgY, this.starX, this.starY,
         aperture, this.vmag, cam, tele, this.starRaDec);

      if (!result) {
         var mb = new MessageBox(
            "Analysis failed. Not enough valid frames (need ≥2).\n"
            + "Check that EXPTIME is in FITS headers and the ROI/star positions are within the image.",
            TITLE, StdIcon.Error, StdButton.Ok);
         mb.execute();
         this.analyzeBtn.enabled = true;
         return;
      }

      this.sqmResult = result;

      console.writeln("");
      console.writeln("<b>Results:</b>");
      console.writeln("  L_sky        = " + result.L_sky.toFixed(4) + " counts/s/px  (R²=" + result.r2_sky.toFixed(5) + ")");
      console.writeln("  L_star       = " + result.L_star.toFixed(1) + " counts/s     (R²=" + result.r2_star.toFixed(5) + ")");
      console.writeln("  Pixel Scale  = " + result.pixel_scale.toFixed(3) + " arcsec/px");
      console.writeln("  L'_sky       = " + result.L_prime_sky.toFixed(6) + " counts/s/arcsec²");
      console.writeln("  <b>SQM = " + result.sqm.toFixed(3) + " mag/arcsec²  → " + result.label + "</b>");

      if (result.r2_sky < 0.99) {
         console.warningln("  WARNING: R²_sky=" + result.r2_sky.toFixed(4) + " is low. Check background ROI for stars.");
      }
      if (result.r2_star < 0.99) {
         console.warningln("  WARNING: R²_star=" + result.r2_star.toFixed(4) + " is low. Check star position and aperture.");
      }

      // Update result labels
      var nUsed     = result.n_frames - (result.excluded_frames || 0);
      var nExcluded = result.excluded_frames || 0;
      var excludedStr = (nExcluded > 0)
         ? ("  (" + nUsed + " used / " + nExcluded + " excluded \u2014 saturation)")
         : ("  (" + nUsed + " frames)");

      this.resultSQMLabel.text = "SQM:             " + result.sqm.toFixed(3) + " mag/arcsec\u00b2";
      this.resultConditionLabel.text = "Sky Condition:   " + result.label;
      this.resultLSkyLabel.text  = "L_sky:           " + result.L_sky.toFixed(4)
         + " counts/s/px  (R\u00b2=" + result.r2_sky.toFixed(4) + ")";
      this.resultLStarLabel.text = "L_star:          " + result.L_star.toFixed(1)
         + " counts/s  (R\u00b2=" + result.r2_star.toFixed(4) + ")" + excludedStr;
      this.resultPixScaleLabel.text = "Pixel Scale:     " + result.pixel_scale.toFixed(3) + " arcsec/px";
      this.resultNFramesLabel.text  = "Frames:          " + result.n_frames + " measured"
         + (nExcluded > 0 ? ",  " + nUsed + " used for L_star  (" + nExcluded + " sat excluded)" : "");

      var warnings = [];
      if (result.r2_sky  < 0.99) warnings.push("R\u00b2_sky="  + result.r2_sky.toFixed(3)  + " is low \u2014 check background ROI for stars.");
      if (result.r2_star < 0.99) warnings.push("R\u00b2_star=" + result.r2_star.toFixed(3) + " is low \u2014 check star position and aperture.");
      if (isNaN(result.sqm) && nUsed < 2)
         warnings.push("Only " + nUsed + " frame(s) without saturated pixels \u2014 shorten exposure or defocus more.");
      if (result.nonlinear_frames && result.nonlinear_frames.length > 0)
         warnings.push("Non-linear rate (not excluded): " + result.nonlinear_frames.join(", "));
      this.resultWarningLabel.text = warnings.length > 0 ? "WARNING: " + warnings.join("  /  ") : "";

      // Refresh frame list with analysis status (Flux, Sat%, Status columns)
      this.refreshFrameTree(result.frameData);

      this.exportCSVBtn.enabled = true;

   } catch (e) {
      var mb = new MessageBox("Unexpected error:\n" + e, TITLE, StdIcon.Error, StdButton.Ok);
      mb.execute();
   }

   this.analyzeBtn.enabled = true;
   }
};

//============================================================================
// main()
//============================================================================

function main() {
   console.writeln("<b>" + TITLE + " v" + VERSION + "</b>");
   console.writeln("---");

   loadEquipmentDatabase();

   var dlg = new SkyQualityAnalyzerDialog();
   dlg.execute();

   console.writeln(TITLE + " finished.");
}

if (typeof __SQA_LIBRARY_MODE === "undefined" || !__SQA_LIBRARY_MODE) {
   main();
}
