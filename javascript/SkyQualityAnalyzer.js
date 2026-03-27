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

#include <pjsr/DataType.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdCursor.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/Color.jsh>

#include "sqm_math.js"

#define TITLE        "Sky Quality Analyzer"
#define MAX_BMP_EDGE 1200
#define BG_HALF      32    // Background ROI: 64x64 px (half = 32)

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
// Returns { filepath, exptime, instrume, gain, isColor, bitsPerSample }
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

   var isColor      = (image.numberOfChannels >= 3);
   var bitsPerSample = image.bitsPerSample;

   win.close();

   if (isNaN(exptime) || exptime <= 0) {
      console.warningln("EXPTIME missing or invalid in: " + File.extractName(filepath));
      return null;
   }

   return {
      filepath:     filepath,
      filename:     File.extractName(filepath),
      exptime:      exptime,
      instrume:     instrume,
      gain:         gain,
      isColor:      isColor,
      bitsPerSample: bitsPerSample
   };
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
// WCS: read keywords and convert pixel coordinates to RA/Dec
//============================================================================

// Read WCS from an XISF binary header.
// PixInsight WBPP stores WCS as <FITSKeyword> elements inside the XISF XML header,
// but they are NOT exposed via win.keywords. Parse the header directly.
// imageHeight: pass image.height from the already-opened ImageWindow.
function readXISFHeaderWCS(filepath, imageHeight) {
   var xml = "";
   try {
      // Open file for reading (PixInsight PJSR File API)
      var f = new File(filepath, FileMode_Read);

      // Read and verify XISF signature (8 bytes: "XISF0100")
      var sig = f.read(DataType_ByteArray, 8);
      if (sig[0] !== 88 || sig[1] !== 73 || sig[2] !== 83 || sig[3] !== 70) {
         return null; // not XISF
      }

      // Read header length (uint32 LE, 4 bytes)
      var lb = f.read(DataType_ByteArray, 4);
      var hdrLen = lb[0] | (lb[1] << 8) | (lb[2] << 16) | (lb[3] << 24);

      // Skip 4 reserved bytes
      f.read(DataType_ByteArray, 4);

      // Read up to 16KB of the XML header (WCS keywords appear within first ~4KB)
      var readLimit = Math.min(hdrLen, 16384);
      var xmlBytes = f.read(DataType_ByteArray, readLimit);

      // Convert ByteArray → string in 4KB chunks; stop once WCS keywords are found
      var chunkSize = 4096;
      for (var ci = 0; ci < readLimit; ci += chunkSize) {
         var endIdx = Math.min(ci + chunkSize, readLimit);
         var slice = [];
         for (var si = ci; si < endIdx; si++) slice.push(xmlBytes[si]);
         xml += String.fromCharCode.apply(null, slice);
         if (xml.indexOf("CD2_2") >= 0 && xml.indexOf("CRPIX2") >= 0) break;
      }
   } catch(e) {
      return null;
   }

   if (!xml) return null;

   // Extract value attribute from <FITSKeyword name="X" value="Y" .../>
   var extractKW = function(name) {
      var tag = 'name="' + name + '" value="';
      var idx = xml.indexOf(tag);
      if (idx < 0) return null;
      idx += tag.length;
      var end = xml.indexOf('"', idx);
      return (end >= 0) ? xml.substring(idx, end) : null;
   };

   var crpix1 = parseFloat(extractKW("CRPIX1"));
   var crpix2 = parseFloat(extractKW("CRPIX2"));
   var crval1 = parseFloat(extractKW("CRVAL1"));
   var crval2 = parseFloat(extractKW("CRVAL2"));
   var cd11   = parseFloat(extractKW("CD1_1"));
   var cd12   = parseFloat(extractKW("CD1_2"));
   var cd21   = parseFloat(extractKW("CD2_1"));
   var cd22   = parseFloat(extractKW("CD2_2"));

   if (isNaN(crpix1) || isNaN(crval1) || isNaN(cd11)) return null;

   return { crpix1: crpix1, crpix2: crpix2,
            crval1: crval1, crval2: crval2,
            cd11: cd11, cd12: cd12,
            cd21: cd21, cd22: cd22,
            imageHeight: imageHeight };
}

// Read WCS keywords from a FITS/XISF file.
// Returns a wcs object or null if keywords are missing.
function readWCS(filepath) {
   var wins = ImageWindow.open(filepath);
   if (!wins || wins.length === 0) return null;
   var win = wins[0];
   var kws = win.keywords;
   var h   = win.mainView.image.height;
   win.close();

   // Try standard FITS keywords first (works for plain FITS files)
   var crpix1 = parseFloat(getFITSKeyword(kws, "CRPIX1"));
   var crpix2 = parseFloat(getFITSKeyword(kws, "CRPIX2"));
   var crval1 = parseFloat(getFITSKeyword(kws, "CRVAL1"));
   var crval2 = parseFloat(getFITSKeyword(kws, "CRVAL2"));
   var cd11   = parseFloat(getFITSKeyword(kws, "CD1_1"));
   var cd12   = parseFloat(getFITSKeyword(kws, "CD1_2"));
   var cd21   = parseFloat(getFITSKeyword(kws, "CD2_1"));
   var cd22   = parseFloat(getFITSKeyword(kws, "CD2_2"));

   if (!isNaN(crpix1) && !isNaN(crval1) && !isNaN(cd11)) {
      return { crpix1: crpix1, crpix2: crpix2,
               crval1: crval1, crval2: crval2,
               cd11: cd11, cd12: cd12,
               cd21: cd21, cd22: cd22,
               imageHeight: h };
   }

   // Fallback: XISF files from PixInsight WBPP store WCS in the binary XML header
   if (filepath.toLowerCase().indexOf(".xisf") >= 0) {
      return readXISFHeaderWCS(filepath, h);
   }

   return null;
}

// Convert PixInsight pixel (0-indexed, y-down) to RA/Dec using TAN projection.
// Small-angle approximation — accurate to ~1 arcsec for fields < 3 degrees.
function pixelToRaDec(wcs, px, py) {
   var fitsX = px + 1.0;
   var fitsY = wcs.imageHeight - py;        // y-flip: PixInsight y-down → FITS y-up
   var dx = fitsX - wcs.crpix1;
   var dy = fitsY - wcs.crpix2;
   var xi  = wcs.cd11 * dx + wcs.cd12 * dy; // degrees
   var eta = wcs.cd21 * dx + wcs.cd22 * dy;
   var dec0 = wcs.crval2 * Math.PI / 180.0;
   var ra   = wcs.crval1 + xi / Math.cos(dec0);
   var dec  = wcs.crval2 + eta;
   while (ra <    0) ra += 360;
   while (ra >= 360) ra -= 360;
   return { ra: ra, dec: dec };
}

//============================================================================
// SIMBAD catalog query by position
//============================================================================

// Query SIMBAD for stars with V magnitude near (ra, dec).
// Returns array of { id, ra, dec, vmag } sorted by V magnitude, or null on error.
function querySIMBADNearby(ra, dec, radiusArcmin) {
   var script = "output console=off script=off\n"
              + "format object \"%IDLIST(1)|%COO(d,A)|%COO(d,D)|%FLUX(V)\"\n"
              + "query around " + ra.toFixed(6) + " "
              + (dec >= 0 ? "+" : "") + dec.toFixed(6)
              + " radius=" + radiusArcmin.toFixed(1) + "m\n";

   var scriptFile = File.systemTempDirectory + "/sqm_simbad_script.txt";
   var outFile    = File.systemTempDirectory + "/sqm_simbad_out.txt";
   File.writeTextFile(scriptFile, script);

   var P = new ExternalProcess;
   P.start("curl", ["-s", "-o", outFile, "-m", "20",
      "--data-urlencode", "script@" + scriptFile,
      "http://simbad.u-strasbg.fr/simbad/sim-script"]);
   if (!P.waitForFinished(25000)) { P.kill(); return null; }
   try { File.remove(scriptFile); } catch (e) {}
   if (!File.exists(outFile)) return null;

   var content = "";
   try { content = File.readTextFile(outFile); File.remove(outFile); } catch (e) {}

   var stars = [];
   var lines = content.split("\n");
   for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.length === 0 || line.charAt(0) === ":" || line.charAt(0) === "#") continue;
      var parts = line.split("|");
      if (parts.length < 4) continue;
      var id   = parts[0].trim();
      var sra  = parseFloat(parts[1]);
      var sdec = parseFloat(parts[2]);
      var vmag = parseFloat(parts[3]);
      if (id.length > 0 && !isNaN(sra) && !isNaN(sdec) && !isNaN(vmag)) {
         stars.push({ id: id, ra: sra, dec: sdec, vmag: vmag });
      }
   }
   stars.sort(function(a, b) { return a.vmag - b.vmag; });
   return stars;
}

//============================================================================
// NearbyStarDialog — show SIMBAD results, user picks a star
//============================================================================

function NearbyStarDialog(stars) {
   this.__base__ = Dialog;
   this.__base__();

   var self = this;
   this.selectedStar = null;
   this.windowTitle  = "Nearby Stars — SIMBAD";
   this.minWidth     = 520;

   var infoLabel = new Label(this);
   infoLabel.text = "Stars near the clicked position (sorted by V magnitude):";
   infoLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.starTree = new TreeBox(this);
   this.starTree.headerVisible   = true;
   this.starTree.numberOfColumns = 3;
   this.starTree.setColumnWidth(0, 260);
   this.starTree.setColumnWidth(1, 70);
   this.starTree.setColumnWidth(2, 100);
   this.starTree.setHeaderText(0, "Identifier");
   this.starTree.setHeaderText(1, "V mag");
   this.starTree.setHeaderText(2, "RA (deg)");
   this.starTree.minHeight = 220;

   for (var i = 0; i < stars.length; i++) {
      var s    = stars[i];
      var node = new TreeBoxNode(this.starTree);
      node.setText(0, s.id);
      node.setText(1, s.vmag.toFixed(3));
      node.setText(2, s.ra.toFixed(4));
   }

   var hintLabel = new Label(this);
   hintLabel.text = "Tip: Choose V=7~10 for 1~10s exposures at GAIN 120 (avoids saturation).";
   hintLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.selectBtn = new PushButton(this);
   this.selectBtn.text = "Use This Star";
   this.selectBtn.icon = this.scaledResource(":/icons/ok.png");
   this.selectBtn.onClick = function() {
      var sel = self.starTree.selectedNodes;
      if (sel.length === 0) {
         var mb = new MessageBox("Please select a star from the list.",
            TITLE, StdIcon_Warning, StdButton_Ok);
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

NearbyStarDialog.prototype = new Dialog;

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

function PointPreviewControl(parent, mode) {
   this.__base__ = ScrollBox;
   this.__base__(parent);

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
   this.viewport.cursor = new Cursor(StdCursor_Arrow);

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
               var ro = (self.aperture + 15) * scale * self.zoomLevel;
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
         self.viewport.cursor = new Cursor(StdCursor_ClosedHand);
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
      self.viewport.cursor = new Cursor(StdCursor_Arrow);
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

PointPreviewControl.prototype = new ScrollBox;

PointPreviewControl.prototype.setBitmap = function(bitmapResult) {
   this.bitmapResult = bitmapResult;
   this.scrollX = 0;
   this.scrollY = 0;
   this.fitToWindow();
};

PointPreviewControl.prototype.setScroll = function(x, y) {
   this.scrollX = Math.max(0, Math.min(this.maxScrollX, Math.round(x)));
   this.scrollY = Math.max(0, Math.min(this.maxScrollY, Math.round(y)));
   this.horizontalScrollPosition = this.scrollX;
   this.verticalScrollPosition   = this.scrollY;
   this.viewport.update();
};

PointPreviewControl.prototype.updateViewport = function() {
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
};

PointPreviewControl.prototype.fitToWindow = function() {
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
};

//============================================================================
// PointSelectionDialog — show a frame preview and let user click a position
//============================================================================

function PointSelectionDialog(parent, title, filepath, mode, aperture) {
   this.__base__ = Dialog;
   this.__base__();

   var self = this;
   this.selectedX    = -1;
   this.selectedY    = -1;
   this.selectedStar = null; // filled when catalog star is chosen
   this.wcs          = null;
   this.filepath     = filepath;
   this.mode         = mode;

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
   instructLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.preview = new PointPreviewControl(this, mode);
   this.preview.aperture = aperture || 15;

   var loadLabel = new Label(this);
   loadLabel.text = "Loading preview...";
   loadLabel.textAlignment = TextAlign_Center | TextAlign_VertCenter;

   this.coordLabel = new Label(this);
   this.coordLabel.text = "Position: (not selected)";
   this.coordLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   // "Find in Catalog" button — only shown in star mode
   this.catalogBtn = null;
   if (mode === "star") {
      this.catalogBtn = new PushButton(this);
      this.catalogBtn.text    = "Find in Catalog...";
      this.catalogBtn.toolTip = "Query SIMBAD for stars near the clicked position";
      this.catalogBtn.enabled = false;
      this.catalogBtn.onClick = function() {
         if (!self.wcs) {
            var mb = new MessageBox(
               "No WCS astrometric solution found in this frame.\n"
               + "Please plate-solve the images first, or enter the star name manually.",
               TITLE, StdIcon_Warning, StdButton_Ok);
            mb.execute();
            return;
         }
         var pos = pixelToRaDec(self.wcs, self.selectedX, self.selectedY);
         console.writeln("SIMBAD query: RA=" + pos.ra.toFixed(4)
            + " Dec=" + pos.dec.toFixed(4) + " radius=5'");
         console.flush();
         var stars = querySIMBADNearby(pos.ra, pos.dec, 5);
         if (!stars || stars.length === 0) {
            var mb = new MessageBox(
               "No stars with V magnitude found within 5 arcmin.\n"
               + "Try clicking closer to a star, or enter the star name manually.",
               TITLE, StdIcon_Warning, StdButton_Ok);
            mb.execute();
            return;
         }
         var catalogDlg = new NearbyStarDialog(stars);
         if (catalogDlg.execute() === 1 && catalogDlg.selectedStar) {
            self.selectedStar = catalogDlg.selectedStar;
            self.coordLabel.text = "Position: X=" + self.selectedX + "  Y=" + self.selectedY
               + "   →  " + self.selectedStar.id + "  V=" + self.selectedStar.vmag.toFixed(3);
         }
      };
   }

   this.preview.onImageClick = function(imgX, imgY) {
      self.selectedX = Math.round(imgX);
      self.selectedY = Math.round(imgY);
      self.coordLabel.text = "Position: X=" + self.selectedX + "  Y=" + self.selectedY;
      if (self.catalogBtn) self.catalogBtn.enabled = true;
   };

   this.okButton = new PushButton(this);
   this.okButton.text = "OK";
   this.okButton.icon = this.scaledResource(":/icons/ok.png");
   this.okButton.onClick = function() {
      if (self.selectedX < 0) {
         var mb = new MessageBox("Please click to select a position.", TITLE, StdIcon_Warning, StdButton_Ok);
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

   // Load preview bitmap + read WCS
   var wins = ImageWindow.open(filepath);
   if (wins && wins.length > 0) {
      var win   = wins[0];
      var image = win.mainView.image;
      var kws   = win.keywords;
      console.writeln("Generating preview for: " + File.extractName(filepath));
      console.flush();
      var bmpResult = createStretchedBitmap(image, MAX_BMP_EDGE);
      this.preview.setBitmap(bmpResult);

      // Try to read WCS for star mode catalog lookup
      if (mode === "star") {
         var wcsObj = null;
         // First try FITS keywords (plain FITS files)
         var crpix1 = parseFloat(getFITSKeyword(kws, "CRPIX1"));
         var crpix2 = parseFloat(getFITSKeyword(kws, "CRPIX2"));
         var crval1 = parseFloat(getFITSKeyword(kws, "CRVAL1"));
         var crval2 = parseFloat(getFITSKeyword(kws, "CRVAL2"));
         var cd11   = parseFloat(getFITSKeyword(kws, "CD1_1"));
         var cd12   = parseFloat(getFITSKeyword(kws, "CD1_2"));
         var cd21   = parseFloat(getFITSKeyword(kws, "CD2_1"));
         var cd22   = parseFloat(getFITSKeyword(kws, "CD2_2"));
         if (!isNaN(crpix1) && !isNaN(crval1) && !isNaN(cd11)) {
            wcsObj = { crpix1: crpix1, crpix2: crpix2,
                       crval1: crval1, crval2: crval2,
                       cd11: cd11, cd12: cd12,
                       cd21: cd21, cd22: cd22,
                       imageHeight: image.height };
         }
         // Fallback: XISF files from PixInsight WBPP store WCS in binary header
         if (!wcsObj && filepath.toLowerCase().indexOf(".xisf") >= 0) {
            wcsObj = readXISFHeaderWCS(filepath, image.height);
         }
         if (wcsObj) {
            this.wcs = wcsObj;
            console.writeln("  WCS available — catalog lookup enabled.");
         } else {
            console.writeln("  No WCS found — catalog lookup unavailable.");
         }
      }
      win.close();
   } else {
      var mb = new MessageBox("Cannot open file:\n" + filepath, TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
   }
}

PointSelectionDialog.prototype = new Dialog;

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

   var stats = sigmaClippingStats(pixels, 3.0, 5);
   return { adu_sky: stats.median, count: stats.count };
}

//============================================================================
// Aperture photometry
// Returns { adu_star } = net star flux (aperture sum minus sky background)
//============================================================================

function aperturePhotometry(filepath, starX, starY, aperture, bitsPerSample, sqmChannel) {
   var wins = ImageWindow.open(filepath);
   if (!wins || wins.length === 0) return null;
   var win   = wins[0];
   var image = win.mainView.image;

   var isColor = (image.numberOfChannels >= 3);
   var ch      = (isColor && sqmChannel === "G") ? 1 : 0;
   var maxADU  = (bitsPerSample === 32) ? 4294967295 : 65535;

   var r_ap  = aperture;
   var r_in  = aperture + 5;
   var r_out = aperture + 15;

   // Sky annulus (sigma-clipped median)
   var skyPixels = [];
   for (var y = starY - r_out - 1; y <= starY + r_out + 1; y++) {
      if (y < 0 || y >= image.height) continue;
      for (var x = starX - r_out - 1; x <= starX + r_out + 1; x++) {
         if (x < 0 || x >= image.width) continue;
         var dx = x - starX;
         var dy = y - starY;
         var dist = Math.sqrt(dx * dx + dy * dy);
         if (dist >= r_in && dist <= r_out) {
            skyPixels.push(image.sample(x, y, ch) * maxADU);
         }
      }
   }

   var skyStats  = sigmaClippingStats(skyPixels, 3.0, 5);
   var skyMedian = skyStats.median;

   // Aperture sum
   var aperSum = 0;
   var apCount = 0;
   for (var y = starY - r_ap - 1; y <= starY + r_ap + 1; y++) {
      if (y < 0 || y >= image.height) continue;
      for (var x = starX - r_ap - 1; x <= starX + r_ap + 1; x++) {
         if (x < 0 || x >= image.width) continue;
         var dx = x - starX;
         var dy = y - starY;
         if (dx * dx + dy * dy <= r_ap * r_ap) {
            aperSum += image.sample(x, y, ch) * maxADU;
            apCount++;
         }
      }
   }

   win.close();

   var netFlux = aperSum - skyMedian * apCount;
   return { adu_star: netFlux };
}

//============================================================================
// Main analysis: iterate over all frames, collect data, compute SQM
//============================================================================

function runAnalysis(frames, bgX, bgY, starX, starY, aperture, vmag, cameraEntry, telescopeEntry) {
   if (!cameraEntry || !telescopeEntry) return null;

   var pixelScale   = computePixelScale(cameraEntry.pixel_pitch, telescopeEntry.focal_length, 1);
   var sqmChannel   = cameraEntry.sqm_channel || "G";
   var bitsPerSample = frames[0].bitsPerSample;

   var skyFrameData  = [];
   var starFrameData = [];

   for (var i = 0; i < frames.length; i++) {
      var f  = frames[i];
      var bg = measureBackground(f.filepath, bgX, bgY, bitsPerSample, sqmChannel);
      var ap = aperturePhotometry(f.filepath, starX, starY, aperture, bitsPerSample, sqmChannel);

      if (!bg || !ap) {
         console.warningln("Skipping frame (measurement failed): " + f.filename);
         continue;
      }

      console.writeln(format("  %-40s  t=%5.1fs  bg=%8.1f ADU  star=%11.0f ADU",
         f.filename, f.exptime, bg.adu_sky, ap.adu_star));

      skyFrameData.push({ exptime: f.exptime, adu_sky:  bg.adu_sky  });
      starFrameData.push({ exptime: f.exptime, adu_star: ap.adu_star });
   }

   if (skyFrameData.length < 2) return null;

   var lSkyResult  = computeLSky(skyFrameData);
   var lStarResult = computeLStar(starFrameData);
   var lPrimeSky   = computeLPrimeSky(lSkyResult.L_sky, pixelScale);
   var sqm         = computeSQM(lStarResult.L_star, lPrimeSky, vmag);
   var label       = skyConditionLabel(sqm);

   return {
      L_sky:       lSkyResult.L_sky,
      r2_sky:      lSkyResult.r2,
      L_star:      lStarResult.L_star,
      r2_star:     lStarResult.r2,
      L_prime_sky: lPrimeSky,
      pixel_scale: pixelScale,
      sqm:         sqm,
      label:       label,
      n_frames:    skyFrameData.length,
      sqmChannel:  sqmChannel,
      bgX:         bgX,
      bgY:         bgY,
      starX:       starX,
      starY:       starY,
      aperture:    aperture,
      vmag:        vmag
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
   lines.push("StarPosition,\"(" + result.starX + "," + result.starY + ")\"");
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

function SkyQualityAnalyzerDialog() {
   this.__base__ = Dialog;
   this.__base__();

   var self = this;

   // State
   this.frames    = [];           // Array of frame metadata objects
   this.bgX       = -1;           // Background ROI center X
   this.bgY       = -1;           // Background ROI center Y
   this.starX     = -1;           // Reference star X
   this.starY     = -1;           // Reference star Y
   this.vmag      = NaN;          // V magnitude
   this.sqmResult = null;         // Last analysis result

   this.windowTitle = TITLE + " v" + VERSION;
   this.minWidth    = 640;

   // =====================================================
   // Title
   // =====================================================
   var titleLabel = new Label(this);
   titleLabel.text = "<b>" + TITLE + "</b>  —  Reference Star Method";
   titleLabel.textAlignment = TextAlign_Center | TextAlign_VertCenter;

   // =====================================================
   // Section 1: Frames
   // =====================================================
   var framesGroupBox = new GroupBox(this);
   framesGroupBox.title = "1. Frames (WBPP calibrated/debayered)";
   framesGroupBox.sizer = new VerticalSizer;
   framesGroupBox.sizer.margin  = 8;
   framesGroupBox.sizer.spacing = 6;

   this.frameTree = new TreeBox(framesGroupBox);
   this.frameTree.headerVisible  = true;
   this.frameTree.numberOfColumns = 3;
   this.frameTree.setColumnWidth(0, 320);
   this.frameTree.setColumnWidth(1, 80);
   this.frameTree.setColumnWidth(2, 80);
   this.frameTree.setHeaderText(0, "Filename");
   this.frameTree.setHeaderText(1, "Exp (s)");
   this.frameTree.setHeaderText(2, "Color");
   this.frameTree.setMinHeight(120);
   this.frameTree.toolTip = "List of FITS frames to analyze";

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
      for (var i = 0; i < od.fileNames.length; i++) {
         var fp = od.fileNames[i];
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
   cameraLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
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
   teleLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
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
   this.pixelScaleLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   equipGroupBox.sizer.add(camRow);
   equipGroupBox.sizer.add(teleRow);
   equipGroupBox.sizer.add(this.pixelScaleLabel);

   // =====================================================
   // Section 3: Measurement Settings
   // =====================================================
   var measureGroupBox = new GroupBox(this);
   measureGroupBox.title = "3. Measurement Settings";
   measureGroupBox.sizer = new VerticalSizer;
   measureGroupBox.sizer.margin  = 8;
   measureGroupBox.sizer.spacing = 6;

   // Background ROI
   var bgLabel = new Label(measureGroupBox);
   bgLabel.text = "Background:";
   bgLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   bgLabel.setFixedWidth(100);

   this.bgPosLabel = new Label(measureGroupBox);
   this.bgPosLabel.text = "(not selected)";
   this.bgPosLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   var bgSelectBtn = new PushButton(measureGroupBox);
   bgSelectBtn.text    = "Select Region...";
   bgSelectBtn.toolTip = "Click on a star-free background region in the first frame";
   bgSelectBtn.onClick = function() {
      if (self.frames.length === 0) {
         var mb = new MessageBox("Please add frames first.", TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      var dlg = new PointSelectionDialog(self, "Select Background Region",
         self.frames[0].filepath, "background", 0);
      if (dlg.execute() === 1) {
         self.bgX = dlg.selectedX;
         self.bgY = dlg.selectedY;
         self.bgPosLabel.text = "X=" + self.bgX + "  Y=" + self.bgY + "  (64×64 px region)";
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
   starPosLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   starPosLabel.setFixedWidth(100);

   this.starPosDisplay = new Label(measureGroupBox);
   this.starPosDisplay.text = "(not selected)";
   this.starPosDisplay.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   var starSelectBtn = new PushButton(measureGroupBox);
   starSelectBtn.text    = "Select Star...";
   starSelectBtn.toolTip = "Click on the reference star in the first frame";
   starSelectBtn.onClick = function() {
      if (self.frames.length === 0) {
         var mb = new MessageBox("Please add frames first.", TITLE, StdIcon_Warning, StdButton_Ok);
         mb.execute();
         return;
      }
      var ap = self.apertureSpinBox.value;
      // Prefer a frame that has WCS keywords for catalog lookup
      var previewFrame = self.frames[0];
      for (var fi = 0; fi < self.frames.length; fi++) {
         var testWcs = readWCS(self.frames[fi].filepath);
         if (testWcs !== null) { previewFrame = self.frames[fi]; break; }
      }
      var dlg = new PointSelectionDialog(self, "Select Reference Star",
         previewFrame.filepath, "star", ap);
      if (dlg.execute() === 1) {
         self.starX = dlg.selectedX;
         self.starY = dlg.selectedY;
         self.starPosDisplay.text = "X=" + self.starX + "  Y=" + self.starY;
         // Auto-fill name and V mag if a catalog star was identified
         if (dlg.selectedStar) {
            self.starNameEdit.text = dlg.selectedStar.id;
            self.vmagEdit.text     = dlg.selectedStar.vmag.toFixed(3);
            self.vmag              = dlg.selectedStar.vmag;
         }
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
   apLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   apLabel.setFixedWidth(100);

   this.apertureSpinBox = new SpinBox(measureGroupBox);
   this.apertureSpinBox.minValue = 5;
   this.apertureSpinBox.maxValue = 100;
   this.apertureSpinBox.value    = 15;
   this.apertureSpinBox.toolTip  = "Aperture radius in pixels. Increase for defocused stars.";

   var apUnitLabel = new Label(measureGroupBox);
   apUnitLabel.text = "px  (sky annulus: r+5 to r+15)";
   apUnitLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

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
   var starGroupBox = new GroupBox(this);
   starGroupBox.title = "4. Reference Star Magnitude";
   starGroupBox.sizer = new VerticalSizer;
   starGroupBox.sizer.margin  = 8;
   starGroupBox.sizer.spacing = 6;

   var starNameLabel = new Label(starGroupBox);
   starNameLabel.text = "Star Name:";
   starNameLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   starNameLabel.setFixedWidth(90);

   this.starNameEdit = new Edit(starGroupBox);
   this.starNameEdit.toolTip = "Enter star name (e.g., Tarazed, gamma Aql, Vega)";

   var searchBtn = new PushButton(starGroupBox);
   searchBtn.text    = "Search";
   searchBtn.toolTip = "Search star V magnitude via CDS Sesame";
   searchBtn.onClick = function() {
      var name = self.starNameEdit.text.trim();
      if (name.length === 0) {
         var mb = new MessageBox("Please enter a star name.", TITLE, StdIcon_Warning, StdButton_Ok);
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
               TITLE, StdIcon_Warning, StdButton_Ok);
            mb.execute();
         }
      } else {
         var mb = new MessageBox(
            "'" + name + "' not found.\nPlease enter V magnitude manually.",
            TITLE, StdIcon_Warning, StdButton_Ok);
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
   vmagLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   vmagLabel.setFixedWidth(90);

   this.vmagEdit = new Edit(starGroupBox);
   this.vmagEdit.toolTip = "Catalog V magnitude of the reference star";
   this.vmagEdit.onTextUpdated = function(text) {
      var v = parseFloat(text);
      self.vmag = isNaN(v) ? NaN : v;
   };

   var vmagHint = new Label(starGroupBox);
   vmagHint.text = "mag  (e.g., Vega=0.03, Tarazed=2.72, Deneb=1.25)";
   vmagHint.textAlignment = TextAlign_Left | TextAlign_VertCenter;

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

   var labelStyle = TextAlign_Left | TextAlign_VertCenter;
   this.resultSQMLabel.textAlignment       = labelStyle;
   this.resultConditionLabel.textAlignment = labelStyle;
   this.resultLSkyLabel.textAlignment      = labelStyle;
   this.resultLStarLabel.textAlignment     = labelStyle;
   this.resultPixScaleLabel.textAlignment  = labelStyle;
   this.resultNFramesLabel.textAlignment   = labelStyle;

   this.clearResults();

   resultsGroupBox.sizer.add(this.resultSQMLabel);
   resultsGroupBox.sizer.add(this.resultConditionLabel);
   resultsGroupBox.sizer.add(this.resultLSkyLabel);
   resultsGroupBox.sizer.add(this.resultLStarLabel);
   resultsGroupBox.sizer.add(this.resultPixScaleLabel);
   resultsGroupBox.sizer.add(this.resultNFramesLabel);

   this.exportCSVBtn = new PushButton(resultsGroupBox);
   this.exportCSVBtn.text    = "Export CSV...";
   this.exportCSVBtn.toolTip = "Export analysis results to CSV file";
   this.exportCSVBtn.enabled = false;
   this.exportCSVBtn.onClick = function() {
      if (!self.sqmResult) return;
      var sd = new SaveFileDialog;
      sd.caption  = "Save Results as CSV";
      sd.filters  = [["CSV Files", "*.csv"]];
      sd.fileName = "sqm_result.csv";
      if (!sd.execute()) return;
      try {
         exportCSV(self.sqmResult, self.frames, sd.fileName);
         console.writeln("Results exported: " + sd.fileName);
         var mb = new MessageBox("Exported:\n" + sd.fileName, TITLE, StdIcon_NoIcon, StdButton_Ok);
         mb.execute();
      } catch (e) {
         var mb = new MessageBox("Export failed:\n" + e, TITLE, StdIcon_Error, StdButton_Ok);
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
}

SkyQualityAnalyzerDialog.prototype = new Dialog;

SkyQualityAnalyzerDialog.prototype.refreshFrameTree = function() {
   this.frameTree.clear();
   for (var i = 0; i < this.frames.length; i++) {
      var f = this.frames[i];
      var node = new TreeBoxNode(this.frameTree);
      node.setText(0, f.filename);
      node.setText(1, f.exptime.toFixed(3));
      node.setText(2, f.isColor ? "Color" : "Mono");
   }
};

SkyQualityAnalyzerDialog.prototype.updatePixelScale = function() {
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
};

SkyQualityAnalyzerDialog.prototype.clearResults = function() {
   this.resultSQMLabel.text       = "SQM:             —";
   this.resultConditionLabel.text = "Sky Condition:   —";
   this.resultLSkyLabel.text      = "L_sky:           —";
   this.resultLStarLabel.text     = "L_star:          —";
   this.resultPixScaleLabel.text  = "Pixel Scale:     —";
   this.resultNFramesLabel.text   = "Frames used:     —";
   if (this.exportCSVBtn) this.exportCSVBtn.enabled = false;
   this.sqmResult = null;
};

SkyQualityAnalyzerDialog.prototype.runAnalysis = function() {
   var self = this;

   // Validation
   if (this.frames.length < 2) {
      var mb = new MessageBox("Please add at least 2 frames.", TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }
   if (this.bgX < 0 || this.bgY < 0) {
      var mb = new MessageBox("Please select a background region.", TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }
   if (this.starX < 0 || this.starY < 0) {
      var mb = new MessageBox("Please select a reference star position.", TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }
   if (isNaN(this.vmag)) {
      var mb = new MessageBox("Please enter or search the V magnitude of the reference star.",
         TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }

   var ci = this.cameraCombo.currentItem;
   var ti = this.teleCombo.currentItem;
   if (ci < 0 || ci >= gEquipment.cameras.length ||
       ti < 0 || ti >= gEquipment.telescopes.length) {
      var mb = new MessageBox("Please select a camera and telescope.", TITLE, StdIcon_Warning, StdButton_Ok);
      mb.execute();
      return;
   }

   var cam  = gEquipment.cameras[ci];
   var tele = gEquipment.telescopes[ti];

   if (cam.pixel_pitch <= 0 || tele.focal_length <= 0) {
      var mb = new MessageBox(
         "Custom equipment selected but pixel_pitch or focal_length is 0.\n"
         + "Please edit equipment.json or select a specific camera/telescope.",
         TITLE, StdIcon_Warning, StdButton_Ok);
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
   console.writeln("Star Position:  (" + this.starX + ", " + this.starY + ")  aperture=" + aperture + " px");
   console.writeln("V magnitude:    " + this.vmag.toFixed(3));
   console.writeln("");

   this.clearResults();
   this.analyzeBtn.enabled = false;

   try {
      var result = runAnalysis(
         this.frames, this.bgX, this.bgY, this.starX, this.starY,
         aperture, this.vmag, cam, tele);

      if (!result) {
         var mb = new MessageBox(
            "Analysis failed. Not enough valid frames (need ≥2).\n"
            + "Check that EXPTIME is in FITS headers and the ROI/star positions are within the image.",
            TITLE, StdIcon_Error, StdButton_Ok);
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
      this.resultSQMLabel.text = "SQM:             " + result.sqm.toFixed(3) + " mag/arcsec²";
      this.resultConditionLabel.text = "Sky Condition:   " + result.label;
      this.resultLSkyLabel.text  = "L_sky:           " + result.L_sky.toFixed(4)
         + " counts/s/px  (R²=" + result.r2_sky.toFixed(4) + ")";
      this.resultLStarLabel.text = "L_star:          " + result.L_star.toFixed(1)
         + " counts/s  (R²=" + result.r2_star.toFixed(4) + ")";
      this.resultPixScaleLabel.text = "Pixel Scale:     " + result.pixel_scale.toFixed(3) + " arcsec/px";
      this.resultNFramesLabel.text  = "Frames used:     " + result.n_frames;
      this.exportCSVBtn.enabled = true;

   } catch (e) {
      var mb = new MessageBox("Unexpected error:\n" + e, TITLE, StdIcon_Error, StdButton_Ok);
      mb.execute();
   }

   this.analyzeBtn.enabled = true;
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

main();
