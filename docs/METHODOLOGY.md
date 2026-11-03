# Methodology — original GEE workflow with comment-only refinements

This document describes the behavior of the original executable code in `scripts/landsat5_pokhara_2004.js`. It is **documentation, not a correction or alternative pipeline**. The code was supplied by the author; analysis execution and outputs have not been independently confirmed for this release.

## 1. Study area, date range and sensor

- Study boundary: Earth Engine FeatureCollection at `projects/learnpokharalst/assets/boundary/Pokhara`. Other Earth Engine users may not have access.
- Dataset: `LANDSAT/LT05/C02/T1_L2` (Landsat 5 TM, USGS Collection 2 Tier 1 Level 2).
- Primary interval: `2004-05-01` to `2004-08-30`, inclusive (end date advances one day before `filterDate`).
- Primary collection: `CLOUD_COVER <= 20` and `PROCESSING_LEVEL == 'L2SP'`.
- Fallback same-year collection: 2004 seasonal interval at `CLOUD_COVER <= 50`.
- Adjacent-year fallback: equivalent seasonal date intervals in **2003 and 2005**, at `CLOUD_COVER <= 50`.

These are scene-level cloud filters. They do not guarantee the same valid-pixel percentages inside Pokhara.

## 2. Scaling and quality assurance

The script scales optical surface reflectance as `DN * 0.0000275 - 0.2`, and `ST_B6` as `DN * 0.00341802 + 149.0` (kelvin). It keeps processed scenes with available Level 2 surface temperature (`L2SP`).

The `QA_PIXEL` mask checks the lowest five bits with `bitwiseAnd(31).eq(0)` — fill (0), dilated cloud (1), an unused bit (2), cloud (3) and cloud shadow (4). It does not explicitly test snow (bit 5). It also requires `QA_RADSAT == 0`, which removes radiometrically saturated pixels.

## 3. Indicators

For each quality-screened image:

| Output | Bands / formula | Interpretation |
| --- | --- | --- |
| LST_C | `ST_B6 - 273.15` after kelvin scaling | USGS surface temperature in Celsius |
| NDVI | `(SR_B4 - SR_B3) / (SR_B4 + SR_B3)` | Greenness proxy |
| NDWI | `(SR_B2 - SR_B4) / (SR_B2 + SR_B4)` | Green/NIR water-related index |
| NDBI | `(SR_B5 - SR_B4) / (SR_B5 + SR_B4)` | SWIR1/NIR built-up-related proxy |

The script uses `normalizedDifference()` to derive all indices. Earth Engine can mask pixels when a scaled input band is negative, so the index validity mask may differ from that of LST.

## 4. Scene-level metadata and per-scene statistics

For each image, the code calculates the mean of the LST validity mask within the ROI at 30 m and expresses the value as `clear_pct_roi`. This is **valid LST coverage**, not necessarily a direct measure of cloud-free land area.

Image metadata include acquisition date, WRS path/row, scene cloud cover, source group, processing level and selected solar/image properties. Per-scene ROI statistics include mean, minimum and maximum for LST, NDVI, NDWI and NDBI.

## 5. Primary and fallback composites

A pixelwise arithmetic mean is calculated independently for each of the four output bands for the primary collection, same-year fallback collection and combined 2003/2005 fallback collection.

Composite precedence is:

1. Use the primary 2004 strict-cloud composite wherever valid.
2. Fill remaining masked pixels from the 2004 loose-cloud composite.
3. Fill remaining pixels from the combined 2003/2005 loose-cloud composite.
4. If enabled, fill residual tiny holes with a 1-pixel focal mean of the previously filled image.

These operations are performed with `unmask()`, and potential fill provenance is **not recorded per pixel**. Because the adjacent-year collection is merged before `mean()`, its composite can average observations from different years at each pixel. The default final raster therefore cannot be described as 2004-observed LST everywhere.

## 6. Coverage calculations and map layers

The script computes primary and final valid LST coverage percentages via a mean of mask imagery within the ROI and reports their difference. Maps include primary true-color mean, patched LST and optional patched NDVI/NDWI/NDBI layers, plus the study boundary. The palettes and min/max are display parameters, not classification thresholds.

## 7. Descriptive statistics

Each final patched indicator is summarized with ROI-wide mean, minimum and maximum. Interpretation requires valid-area checks and awareness that filled pixels can come from 2003/2005 or neighborhood averaging.

## 8. Sampling grid

The grid is based on the ROI's bounding box in geographic coordinates (EPSG:4326). The code converts a nominal 300 m interval to latitude/longitude steps using approximate meters per degree, forms rectangles, then takes centroids filtered to the ROI. It samples all four patched bands at 30 m via `sampleRegions()`.

This is an approximate, not a rigorously projected, 300 m sampling design. Samples masked in any one band are omitted. Exported coordinate fields represent the geometries returned by `sampleRegions()`; they may correspond to image pixel centers rather than the original grid point locations.

## 9. Export inventory

Six separate Drive CSV tasks are defined:

1. Primary image metadata.
2. Primary image ROI statistics.
3. Patch-source image metadata.
4. Patch-source image ROI statistics.
5. Summary table (date range, thresholds, ROI coverage, final statistics).
6. Final patched 300 m grid sample table.

Four final patched single-band GeoTIFF tasks are defined for LST, NDVI, NDWI and NDBI. When `exportPrimaryIndividualTIFFs` is `true` (default), three more GeoTIFF tasks are generated per primary image: LST, NDVI and NDBI.

Export tasks use the folder `GEE_Exports`, nominal scale 30 m and ROI geometry. Tasks still need manual initiation and verification in the Earth Engine Tasks interface.

## 10. Science and reproducibility status

This source is **authentic research code, preserved without edits**, but neither its outputs nor its scientific accuracy have been independently validated in this repository. For multi-year comparisons, gap filling across years requires explicit treatment as a potential bias rather than assuming temporal consistency.

## References

- Google Earth Engine data catalog: https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LT05_C02_T1_L2
- Earth Engine `normalizedDifference`: https://developers.google.com/earth-engine/apidocs/ee-image-normalizeddifference
- Earth Engine `sampleRegions`: https://developers.google.com/earth-engine/apidocs/ee-image-sampleregions
- Earth Engine `unmask`: https://developers.google.com/earth-engine/apidocs/ee-image-unmask
