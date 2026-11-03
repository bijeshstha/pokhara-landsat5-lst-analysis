# Run the original Landsat 5 script in Google Earth Engine

> Follow these instructions in your own Earth Engine account. They do **not** imply that this repository has been executed or validated.

1. Sign in at https://code.earthengine.google.com/ and select a Google Cloud project configured for Earth Engine.
2. Open [`../scripts/landsat5_pokhara_2004.js`](../scripts/landsat5_pokhara_2004.js), copy the entire text into a **new** script in the Earth Engine Code Editor and save it.
3. The original executable code uses the original boundary asset below. Confirm you have permission to access it. If not, upload your own authorized Pokhara boundary to Earth Engine and update the asset path **in your working copy only**. The repository preserves the original processing statements; comments have been polished.

   ```javascript
   var studyArea = ee.FeatureCollection('projects/learnpokharalst/assets/boundary/Pokhara');
   ```

4. Review the user parameters near the start of the script: start `2004-05-01`, end `2004-08-30`, primary cloud limit 20, fallback cloud limit 50, gridSpacing 300, analysisScale 30, local focal fill enabled and exportPrimaryIndividualTIFFs enabled.
5. Before pressing **Run**, understand that gap filling can draw from **2003 and 2005**. If you modify the method for another study, document and publish the modified code separately, rather than describing it as this original script.
6. Press **Run**. Look in the **Console** for primary and patch image counts; valid-area coverage; mean, min and max values; and any error messages. Check the Map layers for obvious artifacts and alignment.
7. Open **Tasks**. The code creates Drive export tasks; it does not start each one automatically. Starting every per-scene TIFF export may create many tasks.
8. Confirm exported CSV column headers and rows, georeferencing, missing areas, data types, spatial range and date labeling. Confirm grid samples were not unexpectedly dropped due to masked bands.
9. Only after quality control, copy a small set of actual maps or tables into `results/` and update the README with traceable findings.

## Expected task categories

- Six CSV reports: primary and patch image metadata and per-image ROI stats, final summary, sampled grid.
- Four final patched composite GeoTIFFs: LST, NDVI, NDWI, NDBI.
- Three additional GeoTIFFs per selected primary scene if `exportPrimaryIndividualTIFFs = true` (LST, NDVI, NDBI).

## Common issues

- **Asset not found / access denied:** you do not have permission to the hard-coded boundary path.
- **No band named LST_C or empty collection:** check dates, processing-level filter, scene counts and cloud thresholds.
- **Export tasks not finished:** initiate from the Tasks tab, inspect status, and use the named Drive folder.
- **Slow execution or large job queue:** the original code uses several region reductions and per-scene export loops; use an appropriate compute budget and check quotas.

This guide is documentation only. It does not change the original JavaScript.
