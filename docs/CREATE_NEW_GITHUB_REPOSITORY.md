# Create and publish a fresh repository (browser workflow)

1. Sign in at https://github.com/new.
2. Set owner to `bijeshstha` and repository name to `pokhara-landsat5-lst-analysis`.
3. Description: `Google Earth Engine workflow for Landsat 5 land surface temperature and spectral-index analysis in Pokhara, Nepal (2004).`
4. Set the repository to Private for initial verification. Do not create a new README, .gitignore, or license in GitHub.
5. Click **Create repository**.
6. Extract the provided ZIP. On GitHub's empty-repository page click **uploading an existing file**. Alternatively choose **Add file → Upload files**.
7. Drag and drop the **contents** of the extracted directory. Keep its folders. Upload only the individual files and folders, never the ZIP.
8. Commit with message: `Initial commit: original Pokhara Landsat 5 GEE workflow`.
9. Check that `README.md` displays on the repository home page, the `scripts/` folder contains **only one** JavaScript file, and `CITATION.cff` points to this repo.
10. Follow [RUN_IN_GEE.md](RUN_IN_GEE.md) and [LIMITATIONS.md](LIMITATIONS.md). Do not claim research results were verified unless you have run the script and checked the outputs.
11. To make it public later, open **Settings → General → Danger Zone → Change repository visibility**. Review carefully before confirming.

The old GitHub repository is not affected by these steps. Removing it later is optional and independent.

No open-source license is selected. The GEE boundary asset may not be accessible to others; provide an authorized public boundary and instructions before describing the project as fully reproducible.
