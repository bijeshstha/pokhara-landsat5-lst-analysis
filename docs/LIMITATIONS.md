# Limitations and cautions

**Read this before making scientific claims based on the original script.** Only comments have been polished; all original executable statements are retained and does not include the suggested corrections from the code review.

## Major methodological limitations

1. **Temporal mixing in gap-filled rasters.** Pixels missing in the primary 2004 composite may be supplied by a 2004 fallback, then the mean of available 2003/2005 seasonal imagery, then 1-pixel spatial smoothing. Some mapped values are thus not direct 2004 observations.
2. **No source-provenance raster.** The code reports a change in coverage percentage, but it does not identify whether an individual output pixel came from primary imagery, 2004 fallback, another year or spatial interpolation. Without such a map, the uncertainty of filled pixels cannot be separated spatially.
3. **No uncertainty validation.** The package supplies no validation against ground measurements, a separate satellite product, a withheld-scene experiment or a sensitivity analysis of fallback choices.
4. **Negative-reflectance masking.** Earth Engine's `normalizedDifference()` masks a pixel when either scaled band is negative. This can change sample inclusion and composite coverage.
5. **Approximate metric grid.** The grid is made in EPSG:4326 using an approximation for meters per degree. The resulting 300 m spacing is approximate, and `f.id()` may not be suitable as a stable scientific identifier.
6. **Thermal-resolution distinction.** Landsat 5 TM surface-temperature products can be delivered on a 30 m grid but do not represent independent 30 m original thermal observations.
7. **Pixel masking details.** QA_PIXEL mask logic only tests bits 0–4; it does not explicitly exclude snow/ice. The QA_RADSAT mask removes radiometric saturation. Cloud-adjacent surface-temperature artifacts can remain.
8. **Systematic missing ST retrievals.** Landsat Level 2 surface temperature can be missing because of absent ASTER GED emissivity information. Spatial smoothing does not recover a measured surface temperature.
9. **Uneven temporal observation counts.** Pixelwise seasonal means can be formed from different numbers of observations at different places. No count-of-valid-scenes raster is exported.
10. **Unvalidated empty-collection behavior and export performance.** No Earth Engine runtime test or output files accompany this release. Empty seasonal collections and large numbers of per-scene exports may cause errors or resource burden.

## Interpretation cautions

- Scene-level `CLOUD_COVER` is not the cloud percentage in the user-defined study region.
- NDWI here is the **Green/NIR** water index, not a vegetation moisture index based on NIR/SWIR.
- NDBI is not a calibrated built-up land cover classification; bare soil and dry land can also respond.
- Values are mean composites of per-scene indices, not indices recalculated from mean reflectance.
- A 2004 map based partly on 2003/2005 observations should not be described without stating this caveat in map captions.
- The script contains no CA-ANN workflow, no CA-ANN accuracy metrics and no full thesis findings.

## Required before describing output as validated

Run the original script with an accessible boundary; check image counts, mask statistics, actual files, spatial alignment, temporal provenance, physical plausibility and the effect of alternative gap-fill approaches. Document the observations and numerical outcomes in README/results only after inspecting them.

No output figure or quantitative scientific finding was fabricated in this repository.

**Technical source:** https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LT05_C02_T1_L2
