/*
 * LANDSAT 5 | SEASONAL LST AND SPECTRAL-INDEX MAPPING — POKHARA, NEPAL
 * 
 * Author:      Bijesh Shrestha
 * Affiliation: Pashchimanchal Campus, Institute of Engineering (IOE), Nepal
 * Related thesis:
 *   Study on Urban Land Surface Temperature Using Remote Sensing and
 *   CA-ANN in Pokhara, Nepal
 * 
 * Scope of this script:
 *   Process Landsat 5 Collection 2 Level 2 imagery for 01 May–30 Aug 2004;
 *   derive LST, NDVI, NDWI and NDBI; create seasonal mean composites;
 *   fill selected data gaps; sample a geographic grid; and export GeoTIFFs
 *   and CSV summaries. This is an image-processing component, not a CA-ANN
 *   implementation or a complete thesis reproduction.
 * 
 * Data: USGS Landsat 5 TM Collection 2, Tier 1, Level 2
 *       LANDSAT/LT05/C02/T1_L2 (Google Earth Engine)
 * ROI:  Earth Engine feature collection for Pokhara (access required)
 * 
 * Important interpretation notes:
 *   - LST is the USGS surface-temperature product expressed in °C;
 *     it is not near-surface air temperature.
 *   - The primary composite uses 2004 scenes with <=20% scene cloud cover.
 *   - Gap filling can draw from <=50% cloud-cover scenes in 2004, 2003
 *     and 2005, followed by a one-pixel focal mean when enabled.
 *   - Consequently, the final filled raster must NOT be described as an
 *     entirely observed 2004 temperature surface.
 *   - Grid spacing is estimated from geographic degrees, not an exact
 *     projected 300 m lattice.
 * 
 * Publication note: Only documentation/comments have been refined;
 *                   analytical statements and executable code are unchanged.
 */

// ==========================================================================
// 01 | STUDY AREA AND USER-CONFIGURABLE PARAMETERS
// ==========================================================================
// Load the Pokhara boundary from the author's Earth Engine assets.
// The end date is advanced one day because filterDate uses an
// exclusive end date; selected dates therefore include 30 Aug 2004.
// CLOUD_COVER thresholds refer to image-wide metadata, not just the ROI.
// Grid spacing is nominal (metres); analysisScale controls nominal
// per-pixel reduction/sampling scale; exports have separate scale values.
// The asset path must be replaced if the asset is not shared publicly.
var studyArea = ee.FeatureCollection('projects/learnpokharalst/assets/boundary/Pokhara');
var roi = studyArea.geometry();

var startDate = ee.Date('2004-05-01');
var endDate   = ee.Date('2004-08-30').advance(1, 'day');

var primaryMaxCloud = 20;
var fallbackMaxCloud = 50;

var gridSpacing = 300;
var analysisScale = 30;

var useTinyHoleFill = true;
var tinyHoleRadiusPixels = 1;

var exportFolder = 'GEE_Exports';
var exportPrimaryIndividualTIFFs = true;

Map.centerObject(studyArea, 10);


// ==========================================================================
// 02 | APPLY USGS COLLECTION 2 SCALE FACTORS
// ==========================================================================
// Convert Level 2 scaled integer values into physical units:
//   SR_B* reflectance = DN * 0.0000275 - 0.2
//   ST_B6 Kelvin       = DN * 0.00341802 + 149.0
// The ST_B6 band is an existing USGS surface-temperature retrieval;
// this script does not independently retrieve atmospheric/emissivity
// parameters from raw thermal radiance.
function applyScaleFactors(image) {
  var optical = image.select(['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'])
    .multiply(0.0000275)
    .add(-0.2);

  var thermal = image.select('ST_B6')
    .multiply(0.00341802)
    .add(149.0);

  return image
    .addBands(optical, null, true)
    .addBands(thermal, null, true);
}


// ==========================================================================
// 03 | MASK INVALID OR LOW-QUALITY OBSERVATIONS
// ==========================================================================
// QA_PIXEL bits 0–4 are required to equal zero (fill, dilated cloud,
// unused bit 2 for Landsat 5, cloud and cloud shadow). This does NOT
// explicitly exclude QA_PIXEL snow/ice bit 5.
// QA_RADSAT == 0 removes pixels flagged for radiometric saturation.
// The same quality mask is applied across all image bands.
function maskQa(image) {
  var qa = image.select('QA_PIXEL');
  var qaMask = qa.bitwiseAnd(parseInt('11111', 2)).eq(0);
  var satMask = image.select('QA_RADSAT').eq(0);

  return image
    .updateMask(qaMask)
    .updateMask(satMask);
}


// ==========================================================================
// 04 | CALCULATE PER-SCENE ENVIRONMENTAL INDICATORS
// ==========================================================================
// LST_C: USGS surface temperature, scaled to Kelvin and converted to °C.
// Landsat 5 TM band mapping: green B2, red B3, NIR B4, SWIR1 B5.
// NDVI = (NIR - red) / (NIR + red) — vegetation index.
// NDWI = (green - NIR) / (green + NIR) — McFeeters-style water index.
// NDBI = (SWIR1 - NIR) / (SWIR1 + NIR) — built-up-related index.
// Indices are computed before temporal compositing.
// Note: normalizedDifference masks pixels with negative input values
// in Earth Engine; this behavior can affect index coverage.
function addDerivedBands(image) {
  var lst = image.select('ST_B6')
    .subtract(273.15)
    .rename('LST_C');

  var ndvi = image.normalizedDifference(['SR_B4', 'SR_B3']).rename('NDVI');
  var ndwi = image.normalizedDifference(['SR_B2', 'SR_B4']).rename('NDWI');
  var ndbi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDBI');

  return image.addBands([lst, ndvi, ndwi, ndbi]);
}


// ==========================================================================
// 05 | RECORD ACQUISITION DATE AND VALID LST FRACTION IN THE ROI
// ==========================================================================
// Compute the spatial mean of the LST validity mask within Pokhara.
// clear_pct_roi is thus a percentage of unmasked LST pixels after
// processing, not an independent meteorological clear-sky estimate.
// This can differ from the scene-wide CLOUD_COVER metadata.
function addSceneInfo(image) {
  var validMask = image.select('LST_C').mask().rename('valid');

  var clearPct = ee.Number(
    validMask.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: roi,
      scale: analysisScale,
      maxPixels: 1e13
    }).get('valid')
  ).multiply(100);

  return image.set({
    image_date: image.date().format('YYYY-MM-dd'),
    clear_pct_roi: clearPct
  });
}


// ==========================================================================
// 06 | CONSTRUCT FILTERED AND PREPROCESSED LANDSAT COLLECTIONS
// ==========================================================================
// Filter by Pokhara, date, scene cloud metadata and L2SP processing.
// L2SP provides the surface-temperature band required for LST_C.
// Apply reflectance/temperature scaling, QA masking, derived bands
// and ROI scene statistics; attach provenance fields to each image.
// Date end arguments remain exclusive.
function buildCollection(dateStart, dateEnd, maxCloud, sourceGroup) {
  return ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(dateStart, dateEnd)
    .filter(ee.Filter.lte('CLOUD_COVER', maxCloud))
    .filter(ee.Filter.eq('PROCESSING_LEVEL', 'L2SP'))
    .map(applyScaleFactors)
    .map(maskQa)
    .map(addDerivedBands)
    .map(addSceneInfo)
    .map(function(img) {
      return img.set({
        source_group: sourceGroup,
        source_start: ee.Date(dateStart).format('YYYY-MM-dd'),
        source_end: ee.Date(dateEnd).advance(-1, 'day').format('YYYY-MM-dd'),
        source_cloud_limit: maxCloud
      });
    });
}


// ==========================================================================
// 07 | DEFINE PRIMARY AND FALLBACK IMAGE COLLECTIONS
// ==========================================================================
// Primary: target interval in 2004 with scene CLOUD_COVER <= 20%.
// Same-year fallback: same 2004 interval with CLOUD_COVER <= 50%;
//   this collection includes eligible primary scenes (not disjoint).
// Adjacent-year fallback: corresponding intervals in 2003 and 2005
//   using the same <= 50% cloud-cover threshold.
// The merged patch-source collection is used for patch metadata
// and per-scene reporting; no unique-scene deduplication is applied.
var primaryCol = buildCollection(startDate, endDate, primaryMaxCloud, 'primary_same_year_strict');
var fallbackSameYearCol = buildCollection(startDate, endDate, fallbackMaxCloud, 'patch_same_year_loose');

var prevYearStart = startDate.advance(-1, 'year');
var prevYearEnd   = endDate.advance(-1, 'year');
var nextYearStart = startDate.advance(1, 'year');
var nextYearEnd   = endDate.advance(1, 'year');

var fallbackAdjacentYearsCol = buildCollection(prevYearStart, prevYearEnd, fallbackMaxCloud, 'patch_prev_year_loose')
  .merge(buildCollection(nextYearStart, nextYearEnd, fallbackMaxCloud, 'patch_next_year_loose'));

var patchSourceCol = fallbackSameYearCol.merge(fallbackAdjacentYearsCol);

print('Primary image count:', primaryCol.size());
print('Patch-source image count:', patchSourceCol.size());


// ==========================================================================
// 08 | CREATE PIXEL-WISE SEASONAL MEAN COMPOSITES
// ==========================================================================
// For each selected band, mean() averages available unmasked pixels
// across the images in that collection.
// Because indices were computed per image, this averages index
// values—not indices recalculated from mean reflectance.
// A pixel can have fewer valid observations than nearby pixels.
function makeMeanComposite(col, bandNames) {
  return col.select(bandNames).mean().clip(roi);
}

var primaryTrueColor = makeMeanComposite(primaryCol, ['SR_B3', 'SR_B2', 'SR_B1']);
var primaryVars = makeMeanComposite(primaryCol, ['LST_C', 'NDVI', 'NDWI', 'NDBI']);
var sameYearPatchVars = makeMeanComposite(fallbackSameYearCol, ['LST_C', 'NDVI', 'NDWI', 'NDBI']);
var adjacentYearPatchVars = makeMeanComposite(fallbackAdjacentYearsCol, ['LST_C', 'NDVI', 'NDWI', 'NDBI']);


// ==========================================================================
// 09 | FILL MASKED PIXELS USING ORDERED FALLBACK COMPOSITES
// ==========================================================================
// 1. Retain primary 2004 values where available.
// 2. Fill remaining gaps from the looser 2004 composite.
// 3. Fill further gaps from the 2003/2005 mean composite.
// 4. Optionally fill small residual holes using a one-pixel focal mean.
// unmask() fills masked locations; valid primary values are retained.
// WARNING: filled values may originate outside 2004 or be spatially
// estimated. This script does not export a per-pixel fill-source map.
var filledVars = primaryVars
  .unmask(sameYearPatchVars)
  .unmask(adjacentYearPatchVars);

if (useTinyHoleFill) {
  var localFill = filledVars.focalMean({
    radius: tinyHoleRadiusPixels,
    units: 'pixels',
    iterations: 1
  });
  filledVars = filledVars.unmask(localFill);
}

var lstFilled  = filledVars.select('LST_C');
var ndviFilled = filledVars.select('NDVI');
var ndwiFilled = filledVars.select('NDWI');
var ndbiFilled = filledVars.select('NDBI');

var outputImage = ee.Image.cat([lstFilled, ndviFilled, ndwiFilled, ndbiFilled]).clip(roi);


// ==========================================================================
// 10 | COMPARE VALID LST COVERAGE BEFORE AND AFTER FILLING
// ==========================================================================
// Estimate percentages of unmasked LST pixels within the ROI at the
// nominal analysis scale. The difference is expressed in percentage
// points, rather than a percentage growth rate.
// Improved coverage is not evidence of improved temperature accuracy.
var primaryValidPct = ee.Number(
  primaryVars.select('LST_C').mask().reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi,
    scale: analysisScale,
    maxPixels: 1e13
  }).get('LST_C')
).multiply(100);

var finalValidPct = ee.Number(
  lstFilled.mask().reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi,
    scale: analysisScale,
    maxPixels: 1e13
  }).get('LST_C')
).multiply(100);

var patchedGainPct = finalValidPct.subtract(primaryValidPct);

print('Primary valid area %:', primaryValidPct);
print('Final valid area % after patch fill:', finalValidPct);
print('Additional area filled %:', patchedGainPct);


// ==========================================================================
// 11 | DISPLAY SEASONAL COMPOSITES IN THE CODE EDITOR
// ==========================================================================
// Create true-colour and LST layers, plus optional NDVI/NDWI/NDBI
// layers, using fixed visualization ranges for quick inspection.
// Displayed colours are visualization settings, not classification
// thresholds or independent evidence of map accuracy.
Map.addLayer(primaryTrueColor, {
  bands: ['SR_B3', 'SR_B2', 'SR_B1'],
  min: 0.0,
  max: 0.3
}, 'Primary Seasonal Mean True Color');

Map.addLayer(lstFilled, {
  min: 15,
  max: 45,
  palette: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red']
}, 'Patched Final LST');

Map.addLayer(ndviFilled, {
  min: -1,
  max: 1,
  palette: ['blue', 'white', 'green']
}, 'Patched Final NDVI', false);

Map.addLayer(ndwiFilled, {
  min: -1,
  max: 1,
  palette: ['brown', 'white', 'blue']
}, 'Patched Final NDWI', false);

Map.addLayer(ndbiFilled, {
  min: -1,
  max: 1,
  palette: ['green', 'white', 'red']
}, 'Patched Final NDBI', false);

Map.addLayer(studyArea, {}, 'Pokhara Boundary');


// ==========================================================================
// 12 | SUMMARIZE PIXEL VALUES ACROSS THE POKHARA BOUNDARY
// ==========================================================================
// Compute mean, minimum and maximum of each filled environmental
// variable over the unmasked pixels at analysisScale.
// These are descriptive statistics of the composite, not results of
// independent validation against ground observations.
function getStats(image) {
  return image.reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.min(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.max(), sharedInputs: true}),
    geometry: roi,
    scale: analysisScale,
    maxPixels: 1e13
  });
}

var lstStats  = getStats(lstFilled);
var ndviStats = getStats(ndviFilled);
var ndwiStats = getStats(ndwiFilled);
var ndbiStats = getStats(ndbiFilled);

print('Final LST stats (mean/min/max):', lstStats);
print('Final NDVI stats (mean/min/max):', ndviStats);
print('Final NDWI stats (mean/min/max):', ndwiStats);
print('Final NDBI stats (mean/min/max):', ndbiStats);


// ==========================================================================
// 13 | CREATE PROVENANCE TABLE FOR PRIMARY 2004 SCENES
// ==========================================================================
// Store acquisition details, orbit information, scene cloud cover,
// ROI LST validity percentage and selected USGS metadata.
// Useful for auditing which scenes contributed to the primary mean.
var primaryMetadataTable = primaryCol.map(function(img) {
  return ee.Feature(null, {
    source_group: img.get('source_group'),
    source_start: img.get('source_start'),
    source_end: img.get('source_end'),
    source_cloud_limit: img.get('source_cloud_limit'),
    sensor: 'Landsat_5',
    dataset: 'LANDSAT/LT05/C02/T1_L2',
    image_id: img.get('system:index'),
    acquisition_date: img.get('image_date'),
    wrs_path: img.get('WRS_PATH'),
    wrs_row: img.get('WRS_ROW'),
    scene_cloud_cover: img.get('CLOUD_COVER'),
    clear_pct_roi: img.get('clear_pct_roi'),
    processing_level: img.get('PROCESSING_LEVEL'),
    collection_category: img.get('COLLECTION_CATEGORY'),
    spacecraft_id: img.get('SPACECRAFT_ID'),
    sensor_id: img.get('SENSOR_ID'),
    sun_elevation: img.get('SUN_ELEVATION'),
    sun_azimuth: img.get('SUN_AZIMUTH'),
    earth_sun_distance: img.get('EARTH_SUN_DISTANCE')
  });
});


// ==========================================================================
// 14 | CREATE PER-SCENE ROI STATISTICS FOR PRIMARY IMAGERY
// ==========================================================================
// Calculate mean, minimum and maximum LST/NDVI/NDWI/NDBI values
// for each cloud-masked primary image over the study area.
// These statistics describe individual scenes, not the final
// temporally averaged composite.
var primaryPerImageStatsTable = primaryCol.map(function(img) {
  var imageStats = img.select(['LST_C', 'NDVI', 'NDWI', 'NDBI']).reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.min(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.max(), sharedInputs: true}),
    geometry: roi,
    scale: analysisScale,
    maxPixels: 1e13
  });

  return ee.Feature(null, {
    source_group: img.get('source_group'),
    source_start: img.get('source_start'),
    source_end: img.get('source_end'),
    source_cloud_limit: img.get('source_cloud_limit'),
    sensor: 'Landsat_5',
    dataset: 'LANDSAT/LT05/C02/T1_L2',
    image_id: img.get('system:index'),
    acquisition_date: img.get('image_date'),
    wrs_path: img.get('WRS_PATH'),
    wrs_row: img.get('WRS_ROW'),
    scene_cloud_cover: img.get('CLOUD_COVER'),
    clear_pct_roi: img.get('clear_pct_roi'),
    lst_mean_c: imageStats.get('LST_C_mean'),
    lst_min_c:  imageStats.get('LST_C_min'),
    lst_max_c:  imageStats.get('LST_C_max'),
    ndvi_mean: imageStats.get('NDVI_mean'),
    ndvi_min:  imageStats.get('NDVI_min'),
    ndvi_max:  imageStats.get('NDVI_max'),
    ndwi_mean: imageStats.get('NDWI_mean'),
    ndwi_min:  imageStats.get('NDWI_min'),
    ndwi_max:  imageStats.get('NDWI_max'),
    ndbi_mean: imageStats.get('NDBI_mean'),
    ndbi_min:  imageStats.get('NDBI_min'),
    ndbi_max:  imageStats.get('NDBI_max')
  });
});


// ==========================================================================
// 15 | CREATE PROVENANCE TABLE FOR FALLBACK-SOURCE SCENES
// ==========================================================================
// Include same-year <=50% scenes and adjacent-year <=50% scenes.
// Because the same-year fallback includes eligible primary scenes,
// some primary acquisitions will also appear in this export.
var patchMetadataTable = patchSourceCol.map(function(img) {
  return ee.Feature(null, {
    source_group: img.get('source_group'),
    source_start: img.get('source_start'),
    source_end: img.get('source_end'),
    source_cloud_limit: img.get('source_cloud_limit'),
    sensor: 'Landsat_5',
    dataset: 'LANDSAT/LT05/C02/T1_L2',
    image_id: img.get('system:index'),
    acquisition_date: img.get('image_date'),
    wrs_path: img.get('WRS_PATH'),
    wrs_row: img.get('WRS_ROW'),
    scene_cloud_cover: img.get('CLOUD_COVER'),
    clear_pct_roi: img.get('clear_pct_roi'),
    processing_level: img.get('PROCESSING_LEVEL'),
    collection_category: img.get('COLLECTION_CATEGORY'),
    spacecraft_id: img.get('SPACECRAFT_ID'),
    sensor_id: img.get('SENSOR_ID'),
    sun_elevation: img.get('SUN_ELEVATION'),
    sun_azimuth: img.get('SUN_AZIMUTH'),
    earth_sun_distance: img.get('EARTH_SUN_DISTANCE')
  });
});


// ==========================================================================
// 16 | CREATE PER-SCENE ROI STATISTICS FOR FALLBACK IMAGERY
// ==========================================================================
// Report mean, minimum and maximum values for LST and the three
// indices for each member of the merged patch-source collection.
// Source-group/date metadata distinguishes contemporaneous and
// adjacent-year source records in the exported table.
var patchPerImageStatsTable = patchSourceCol.map(function(img) {
  var imageStats = img.select(['LST_C', 'NDVI', 'NDWI', 'NDBI']).reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.min(), sharedInputs: true})
      .combine({reducer2: ee.Reducer.max(), sharedInputs: true}),
    geometry: roi,
    scale: analysisScale,
    maxPixels: 1e13
  });

  return ee.Feature(null, {
    source_group: img.get('source_group'),
    source_start: img.get('source_start'),
    source_end: img.get('source_end'),
    source_cloud_limit: img.get('source_cloud_limit'),
    sensor: 'Landsat_5',
    dataset: 'LANDSAT/LT05/C02/T1_L2',
    image_id: img.get('system:index'),
    acquisition_date: img.get('image_date'),
    wrs_path: img.get('WRS_PATH'),
    wrs_row: img.get('WRS_ROW'),
    scene_cloud_cover: img.get('CLOUD_COVER'),
    clear_pct_roi: img.get('clear_pct_roi'),
    lst_mean_c: imageStats.get('LST_C_mean'),
    lst_min_c:  imageStats.get('LST_C_min'),
    lst_max_c:  imageStats.get('LST_C_max'),
    ndvi_mean: imageStats.get('NDVI_mean'),
    ndvi_min:  imageStats.get('NDVI_min'),
    ndvi_max:  imageStats.get('NDVI_max'),
    ndwi_mean: imageStats.get('NDWI_mean'),
    ndwi_min:  imageStats.get('NDWI_min'),
    ndwi_max:  imageStats.get('NDWI_max'),
    ndbi_mean: imageStats.get('NDBI_mean'),
    ndbi_min:  imageStats.get('NDBI_min'),
    ndbi_max:  imageStats.get('NDBI_max')
  });
});


// ==========================================================================
// 17 | BUILD A ONE-ROW PROCESSING AND OUTPUT SUMMARY
// ==========================================================================
// Capture image counts, cloud thresholds, date range, spatial
// coverage before/after filling and final raster statistics.
// Counts are collection membership counts, not unique valid-pixel
// observation counts.
var summaryTable = ee.FeatureCollection([
  ee.Feature(null, {
    sensor: 'Landsat_5',
    dataset: 'LANDSAT/LT05/C02/T1_L2',
    processing_level_filter: 'L2SP',
    start_date: startDate.format('YYYY-MM-dd'),
    end_date: endDate.advance(-1, 'day').format('YYYY-MM-dd'),
    primary_cloud_limit: primaryMaxCloud,
    fallback_cloud_limit: fallbackMaxCloud,
    primary_image_count: primaryCol.size(),
    patch_source_image_count: patchSourceCol.size(),
    primary_valid_pct: primaryValidPct,
    final_valid_pct: finalValidPct,
    added_valid_pct: patchedGainPct,
    grid_spacing_m: gridSpacing,
    tiny_hole_fill_used: useTinyHoleFill,
    tiny_hole_radius_pixels: tinyHoleRadiusPixels,
    lst_mean_c: lstStats.get('LST_C_mean'),
    lst_min_c:  lstStats.get('LST_C_min'),
    lst_max_c:  lstStats.get('LST_C_max'),
    ndvi_mean: ndviStats.get('NDVI_mean'),
    ndvi_min:  ndviStats.get('NDVI_min'),
    ndvi_max:  ndviStats.get('NDVI_max'),
    ndwi_mean: ndwiStats.get('NDWI_mean'),
    ndwi_min:  ndwiStats.get('NDWI_min'),
    ndwi_max:  ndwiStats.get('NDWI_max'),
    ndbi_mean: ndbiStats.get('NDBI_mean'),
    ndbi_min:  ndbiStats.get('NDBI_min'),
    ndbi_max:  ndbiStats.get('NDBI_max')
  })
]);


// ==========================================================================
// 18 | GENERATE NOMINAL 300 M GRID POINTS AND SAMPLE RASTER VALUES
// ==========================================================================
// Construct rectangular cells in EPSG:4326 using approximate
// metres-per-degree conversions at the ROI midpoint latitude.
// Select cell centroids that fall within the study boundary.
// sampleRegions extracts the four indices at nominal 30 m scale;
// fully or partly masked samples may be omitted.
// The output point coordinates may snap to source pixel centres.
// This is an approximate geographic grid, NOT a rigorously
// distance-preserving projected grid.
function makeGridPoints(region, spacingMeters) {
  var bounds = region.bounds(1, 'EPSG:4326');
  var coords = ee.List(bounds.coordinates().get(0));

  var xmin = ee.Number(ee.List(coords.get(0)).get(0));
  var ymin = ee.Number(ee.List(coords.get(0)).get(1));
  var xmax = ee.Number(ee.List(coords.get(2)).get(0));
  var ymax = ee.Number(ee.List(coords.get(2)).get(1));

  var latMid = ymin.add(ymax).divide(2);
  var metersPerDegLat = 111320;
  var metersPerDegLon = ee.Number(111320).multiply(latMid.multiply(Math.PI).divide(180).cos());

  var dx = ee.Number(spacingMeters).divide(metersPerDegLon);
  var dy = ee.Number(spacingMeters).divide(metersPerDegLat);

  var xSeq = ee.List.sequence(xmin, xmax, dx);
  var ySeq = ee.List.sequence(ymin, ymax, dy);

  var cells = xSeq.map(function(x) {
    x = ee.Number(x);
    return ySeq.map(function(y) {
      y = ee.Number(y);
      var cell = ee.Geometry.Rectangle([x, y, x.add(dx), y.add(dy)], 'EPSG:4326', false);
      return ee.Feature(cell);
    });
  }).flatten();

  var grid = ee.FeatureCollection(cells).filterBounds(region);

  var centroids = grid.map(function(f) {
    return ee.Feature(f.geometry().centroid(1), {
      grid_id: f.id()
    });
  }).filterBounds(region);

  return centroids;
}

var gridPoints = makeGridPoints(roi, gridSpacing);

var sampledGrid = outputImage.sampleRegions({
  collection: gridPoints,
  scale: analysisScale,
  geometries: true
});

var gridSampleTable = sampledGrid.map(function(feature) {
  var coords = feature.geometry().coordinates();
  return ee.Feature(null, {
    grid_id: feature.get('grid_id'),
    longitude: coords.get(0),
    latitude: coords.get(1),
    LST_C: feature.get('LST_C'),
    NDVI: feature.get('NDVI'),
    NDWI: feature.get('NDWI'),
    NDBI: feature.get('NDBI'),
    start_date: startDate.format('YYYY-MM-dd'),
    end_date: endDate.advance(-1, 'day').format('YYYY-MM-dd'),
    grid_spacing_m: gridSpacing
  });
});


// ==========================================================================
// 19 | EXPORT SIX CSV TABLES TO GOOGLE DRIVE
// ==========================================================================
// Export primary scene metadata, primary scene ROI statistics,
// fallback metadata, fallback ROI statistics, composite summary
// and grid-sampled values. Export tasks must be started in the
// Google Earth Engine Code Editor Tasks panel.
var dateLabel = startDate.format('YYYYMMdd').cat('_').cat(endDate.advance(-1, 'day').format('YYYYMMdd'));

Export.table.toDrive({
  collection: primaryMetadataTable,
  description: dateLabel.getInfo() + '_L5_Primary_Metadata',
  folder: exportFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: primaryPerImageStatsTable,
  description: dateLabel.getInfo() + '_L5_Primary_PerImage_ROI_Stats',
  folder: exportFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: patchMetadataTable,
  description: dateLabel.getInfo() + '_L5_PatchSource_Metadata',
  folder: exportFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: patchPerImageStatsTable,
  description: dateLabel.getInfo() + '_L5_PatchSource_PerImage_ROI_Stats',
  folder: exportFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: summaryTable,
  description: dateLabel.getInfo() + '_L5_Summary',
  folder: exportFolder,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: gridSampleTable,
  description: dateLabel.getInfo() + '_L5_Patched_Grid_Samples',
  folder: exportFolder,
  fileFormat: 'CSV'
});


// ==========================================================================
// 20 | EXPORT FOUR FILLED SEASONAL COMPOSITES AS GEOTIFF
// ==========================================================================
// Export LST_C, NDVI, NDWI and NDBI individually at 30 m grid scale.
// USGS Landsat 5 TM thermal observations have coarser native spatial
// resolution than the 30 m distributed/output grid; exporting at
// 30 m does not create finer independent thermal measurements.
// These are gap-filled products, not exclusively observed 2004 maps.
Export.image.toDrive({
  image: lstFilled,
  description: dateLabel.getInfo() + '_L5_Patched_LST_C',
  folder: exportFolder,
  region: roi,
  scale: 30,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: ndviFilled,
  description: dateLabel.getInfo() + '_L5_Patched_NDVI',
  folder: exportFolder,
  region: roi,
  scale: 30,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: ndwiFilled,
  description: dateLabel.getInfo() + '_L5_Patched_NDWI',
  folder: exportFolder,
  region: roi,
  scale: 30,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: ndbiFilled,
  description: dateLabel.getInfo() + '_L5_Patched_NDBI',
  folder: exportFolder,
  region: roi,
  scale: 30,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});


// ==========================================================================
// 21 | OPTIONALLY EXPORT INDIVIDUAL PRIMARY-SCENE GEOTIFFS
// ==========================================================================
// For every eligible primary 2004 image, create separate GeoTIFF
// exports for LST_C, NDVI and NDBI (NDWI is not exported here).
// The callback creates tasks asynchronously in the Code Editor;
// each task must be started by the user.
// A large number of scenes can produce many export tasks.
if (exportPrimaryIndividualTIFFs) {
  var primaryList = primaryCol.toList(primaryCol.size());

  primaryCol.size().evaluate(function(count) {
    print('Number of primary images to export individually:', count);

    for (var i = 0; i < count; i++) {
      var img = ee.Image(primaryList.get(i));
      var imgDate = ee.Date(img.get('system:time_start')).format('YYYYMMdd');
      var imgId = ee.String(img.get('system:index')).replace('/', '_');
      var baseName = imgDate.cat('_').cat(imgId);

      Export.image.toDrive({
        image: img.select('LST_C').clip(roi),
        description: baseName.getInfo() + '_L5_Primary_LST_C',
        folder: exportFolder,
        region: roi,
        scale: 30,
        maxPixels: 1e13,
        fileFormat: 'GeoTIFF'
      });

      Export.image.toDrive({
        image: img.select('NDVI').clip(roi),
        description: baseName.getInfo() + '_L5_Primary_NDVI',
        folder: exportFolder,
        region: roi,
        scale: 30,
        maxPixels: 1e13,
        fileFormat: 'GeoTIFF'
      });

      Export.image.toDrive({
        image: img.select('NDBI').clip(roi),
        description: baseName.getInfo() + '_L5_Primary_NDBI',
        folder: exportFolder,
        region: roi,
        scale: 30,
        maxPixels: 1e13,
        fileFormat: 'GeoTIFF'
      });
    }
  });
}