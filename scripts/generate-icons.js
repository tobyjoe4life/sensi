/**
 * PACKAGING-01 / A.5 — sensi icon generator
 *
 * Rasterizes the SensiMark brush-s SVG into every icon variant
 * electron-builder needs:
 *
 *   assets/icons/win/icon.ico        — multi-resolution Windows icon
 *                                      (NSIS installer, taskbar, Alt-Tab,
 *                                      splash, Start menu)
 *   assets/icons/png/icon_*.png       — Linux AppImage/deb icon ladder
 *   assets/icon.png                   — generic 1024×1024 source
 *   assets/icon.icns                  — macOS .icns (built via iconutil
 *                                      on macOS, skipped on other hosts)
 *
 * Source of truth: src/components/SensiLogoMark.tsx (SensiMark). The
 * brushstroke path + circle are embedded in this script so the generator
 * has zero dependency on the TSX (no compile / no React runtime needed).
 * Keep the `SENSI_MARK_SVG` string in sync if the glyph ever changes.
 *
 * Usage:
 *   npm run icons
 *
 * The script is idempotent — rerunning overwrites outputs in place.
 * Check the resulting files into git.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(REPO_ROOT, 'assets');
const PNG_DIR = path.join(ASSETS, 'icons', 'png');
const WIN_DIR = path.join(ASSETS, 'icons', 'win');

// ─── Source SVG ──────────────────────────────────────────────────────────────
// Drawn at 1024×1024 for a crisp upscale target. The brush-s path is the
// same one in SensiLogoMark.tsx, scaled from the 100×100 viewBox to 1024×1024
// (multiplier ×10.24). Stroke widths scale proportionally. A solid background
// is included so rasterization produces a filled square icon rather than an
// alpha-edged glyph (better at small sizes in taskbar/tray). For the tray the
// app reads `iconTemplate.png` anyway — this asset is for the .ico / PNG ladder.
//
// Colors: white glyph on the sensi brand dark (near-black) — matches the
// Launcher header and overlay. The icon is solid, not template — Windows
// uses the full color image.

const STROKE = 10; // in 100×100 coordinate space

const brushPath = [
    'M 72 30',
    'C 72 18, 58 14, 46 18',
    'C 30 24, 26 40, 40 46',
    'L 60 54',
    'C 74 60, 70 76, 54 82',
    'C 42 86, 28 82, 28 70',
].join(' ');

/** Build a sensi-mark SVG sized for direct rasterization at `pixels`×`pixels`. */
function buildSensiMarkSvg(pixels) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${pixels}" height="${pixels}">
  <rect x="0" y="0" width="100" height="100" rx="20" ry="20" fill="#0f1115"/>
  <circle cx="50" cy="50" r="47" stroke="#ffffff" stroke-width="5" fill="none"/>
  <path d="${brushPath}"
        fill="none"
        stroke="#ffffff"
        stroke-width="${STROKE}"
        stroke-linecap="round"
        stroke-linejoin="round"/>
</svg>`;
}

// ─── Size ladder ─────────────────────────────────────────────────────────────
// Windows .ico: embed these sizes (standard set). 256 is essential for Win10+
// Alt-Tab and File Explorer. 16/20/24/32/48 cover taskbar + small-view tiles.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

// Linux PNG ladder: AppImage uses 16–1024; keep the existing filenames.
const PNG_LADDER = [16, 32, 64, 128, 256, 512, 1024];

// ─── Output helpers ──────────────────────────────────────────────────────────

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

async function renderPng(size, outPath) {
    // Build the SVG sized for this target so sharp rasterizes directly at
    // `size`×`size` with no intermediate resize (which overflows sharp's
    // 268M-pixel cap at higher densities).
    const svgBuffer = Buffer.from(buildSensiMarkSvg(size), 'utf8');
    await sharp(svgBuffer)
        .png({ compressionLevel: 9 })
        .toFile(outPath);
    const stat = fs.statSync(outPath);
    console.log(`  ${path.relative(REPO_ROOT, outPath)}  (${size}×${size}, ${stat.size} B)`);
}

async function generateLinuxPngLadder() {
    console.log('[icons] Linux PNG ladder → assets/icons/png/');
    ensureDir(PNG_DIR);
    for (const size of PNG_LADDER) {
        const out = path.join(PNG_DIR, `icon_${size}x${size}.png`);
        await renderPng(size, out);
    }
}

async function generateWindowsIco() {
    console.log('[icons] Windows multi-resolution .ico → assets/icons/win/icon.ico');
    ensureDir(WIN_DIR);
    // Render each ICO size to a temp PNG buffer, then pack them.
    const tmpDir = path.join(WIN_DIR, '.ico-tmp');
    ensureDir(tmpDir);
    const tmpFiles = [];
    try {
        for (const size of ICO_SIZES) {
            const p = path.join(tmpDir, `icon_${size}.png`);
            await renderPng(size, p);
            tmpFiles.push(p);
        }
        const icoBuf = await pngToIco(tmpFiles);
        const icoPath = path.join(WIN_DIR, 'icon.ico');
        fs.writeFileSync(icoPath, icoBuf);
        const stat = fs.statSync(icoPath);
        console.log(`  ${path.relative(REPO_ROOT, icoPath)}  (${stat.size} B, ${ICO_SIZES.length} resolutions)`);
    } finally {
        // Cleanup tmp pngs (they've been embedded into the .ico)
        for (const f of tmpFiles) {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
        }
        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
    }
}

async function generateTopLevelIcons() {
    console.log('[icons] Top-level assets/icon.png + fallback icon');
    // assets/icon.png — 1024×1024 canonical source. Some builder targets fall
    // back to this when a platform-specific icon is missing.
    await renderPng(1024, path.join(ASSETS, 'icon.png'));
    // assets/fakeicon — a legacy upstream artifact. Leave untouched; not a PNG.
}

async function generateMacIcns() {
    // .icns generation uses iconutil which only ships with macOS. On Windows/
    // Linux, skip — the packaged build is Windows-first and macOS is deferred
    // per PACKAGING-01 scope fence.
    if (process.platform !== 'darwin') {
        console.log('[icons] Skipping .icns (not on macOS — deferred per PACKAGING-01 scope)');
        return;
    }
    const { execSync } = require('child_process');
    console.log('[icons] macOS .icns → assets/icon.icns');
    const iconset = path.join(ASSETS, 'sensi.iconset');
    ensureDir(iconset);
    const macSizes = [
        { size: 16, name: 'icon_16x16.png' },
        { size: 32, name: 'icon_16x16@2x.png' },
        { size: 32, name: 'icon_32x32.png' },
        { size: 64, name: 'icon_32x32@2x.png' },
        { size: 128, name: 'icon_128x128.png' },
        { size: 256, name: 'icon_128x128@2x.png' },
        { size: 256, name: 'icon_256x256.png' },
        { size: 512, name: 'icon_256x256@2x.png' },
        { size: 512, name: 'icon_512x512.png' },
        { size: 1024, name: 'icon_512x512@2x.png' },
    ];
    for (const { size, name } of macSizes) {
        await renderPng(size, path.join(iconset, name));
    }
    const icnsOut = path.join(ASSETS, 'icon.icns');
    execSync(`iconutil -c icns "${iconset}" -o "${icnsOut}"`);
    // Cleanup
    fs.rmSync(iconset, { recursive: true, force: true });
    console.log(`  ${path.relative(REPO_ROOT, icnsOut)}`);
}

async function main() {
    console.log('[icons] Generating sensi icon set from inline SensiMark SVG');
    console.log('[icons] Repo root:', REPO_ROOT);
    console.log('');
    await generateLinuxPngLadder();
    await generateWindowsIco();
    await generateTopLevelIcons();
    await generateMacIcns();
    console.log('');
    console.log('[icons] Done. Check-in the generated files:');
    console.log('  - assets/icons/win/icon.ico');
    console.log('  - assets/icons/png/icon_*.png');
    console.log('  - assets/icon.png');
    if (process.platform === 'darwin') console.log('  - assets/icon.icns');
}

main().catch((err) => {
    console.error('[icons] FAILED:', err);
    process.exit(1);
});
