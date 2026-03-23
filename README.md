[日本語](README.ja.md)

# Sky Quality Analyzer

A sky quality measurement tool for PixInsight. Analyzes astronomical images to calculate Sky Quality Meter (SQM) values — a measure of sky brightness (mag/arcsec²) — enabling quantitative evaluation of light pollution and sky conditions.

## Overview

Sky Quality Analyzer estimates the SQM value (sky brightness in mag/arcsec²) directly from PixInsight images by analyzing the background sky level, using image metadata (exposure time, pixel scale, filter, etc.) and a photometric calibration model.

## Features

_(Under development — see Issues for planned features)_

## Installation

### From Repository (Recommended)

1. In PixInsight, go to **Resources > Updates > Manage Repositories**
2. Click **Add** and enter the following URL:
   ```
   https://ysmrastro.github.io/pixinsight-scripts/
   ```
3. Click **OK**, then run **Resources > Updates > Check for Updates**
4. Restart PixInsight

### Manual Installation

1. Clone or download this repository
2. In PixInsight, open **Script > Feature Scripts...**
3. Click **Add** and select the `sky-quality-analyzer/javascript/` directory
4. Click **Done** — **Script > Utility > SkyQualityAnalyzer** will appear in the menu

No Python or external packages required.

## Technical Details

See [docs/specs.md](docs/specs.md) for the full technical specification.

## License

This project is licensed under the [MIT License](LICENSE).
