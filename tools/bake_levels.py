# Bakes the nested imagery + relief levels the planet pass streams (assets/earth/levels/).
# Level k is a square centred on the launch site, 1024 km / 2^k across, in the local tangent plane
# (orthographic: column -> world +x = real west, row 0 -> south, so uv = (x/E + .5, z/E + .5)).
#   col_k.webp  1024^2 RGB  imagery. k0-1: NASA Blue Marble NG (GIBS, public domain);
#                           k2+: USDA NAIP via the USGS National Map NAIP image service (public domain); its holes are filled with
#                           Landsat WELD (NASA GIBS, public domain), colour-matched, then anything left from the coarser level.
#   nrm_k.webp   512^2 RGBA R,G = surface normal x/z, B = sqrt(height / 5000 m), A = land fraction (0 = sea).
#                           Height from USGS 3DEP (public domain); sea = 0.
# Usage: python3 tools/bake_levels.py   (tiles are cached in /workspace/terrain-work/cache)
import json, math, os, io, time, urllib.request, numpy as np, tifffile
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from scipy import ndimage
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/earth/levels'); CACHE = '/workspace/terrain-work/cache'
os.makedirs(OUT, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
R = 6371.0; E0 = 1024.0; NL = 8; CS = 1024; NS = 512
meta = json.load(open(os.path.join(ROOT, 'assets/terrain/coast_dem_hi.json')))
# world origin sits 12 m west / 77 m north of the site point the DEM records (tools/make_dem.py SITE_C)
LAT0 = meta['lat'] + 0.077 / R * 180 / math.pi
LON0 = meta['lon'] - 0.012 / (R * math.cos(math.radians(meta['lat']))) * 180 / math.pi
f, l = math.radians(LAT0), math.radians(LON0)
U = np.array([math.cos(f) * math.cos(l), math.cos(f) * math.sin(l), math.sin(f)])
Ev = np.array([-math.sin(l), math.cos(l), 0.0]); Nv = np.array([-math.sin(f) * math.cos(l), -math.sin(f) * math.sin(l), math.cos(f)])

def latlon(x, z):            # local km (x west, z north) on the sphere -> degrees
    e, n = -x, z; u = np.sqrt(np.maximum(R * R - e * e - n * n, 0))
    P = e[..., None] * Ev + n[..., None] * Nv + u[..., None] * U
    return np.degrees(np.arcsin(P[..., 2] / R)), np.degrees(np.arctan2(P[..., 1], P[..., 0]))
def grid(E, S):
    c = (np.arange(S) + 0.5) / S * E - E / 2
    x, z = np.meshgrid(c, c); return x, z      # row j -> z, col i -> x
def merc(lat, lon, zm):
    n = 2 ** zm; return (lon + 180) / 360 * n * 256, (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n * 256

def fetch(url, fn):
    p = os.path.join(CACHE, fn)
    if not os.path.exists(p):
        for t in range(6):
            try:
                d = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'chrome-hangar-bake/1.0'}), timeout=60).read(); open(p, 'wb').write(d); break
            except Exception as e:
                if t == 5: print('fail', url, e); return None
                time.sleep(3 * (t + 1))
    return p
def mosaic(src, zm, lat, lon):
    px, py = merc(lat, lon, zm)
    tx0, tx1, ty0, ty1 = int(px.min() // 256) - 1, int(px.max() // 256) + 1, int(py.min() // 256) - 1, int(py.max() // 256) + 1
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    img = np.zeros((H, W, 3), np.uint8); ok = np.zeros((H, W), bool)
    jobs = []
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            if src == 'weld': url, fn = f'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/GoogleMapsCompatible_Level12/{zm}/{ty}/{tx}.jpeg', f'weld_{zm}_{ty}_{tx}.jpg'
            elif src == 'bm': url, fn = f'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{zm}/{ty}/{tx}.jpeg', f'bm_{zm}_{ty}_{tx}.jpg'
            else: url, fn = f'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{zm}/{ty}/{tx}', f'us_{zm}_{ty}_{tx}.img'
            jobs.append((tx, ty, url, fn))
    with ThreadPoolExecutor(12) as ex: paths = list(ex.map(lambda j: fetch(j[2], j[3]), jobs))
    for (tx, ty, _, _), p in zip(jobs, paths):
        if not p: continue
        try: a = np.asarray(Image.open(p).convert('RGB'))
        except Exception: continue
        y0, x0 = (ty - ty0) * 256, (tx - tx0) * 256; img[y0:y0 + 256, x0:x0 + 256] = a; ok[y0:y0 + 256, x0:x0 + 256] = True
    cx, cy = px - tx0 * 256 - 0.5, py - ty0 * 256 - 0.5
    out = np.stack([ndimage.map_coordinates(img[..., c].astype(np.float32), [cy, cx], order=1, mode='nearest') for c in range(3)], -1)
    valid = ndimage.map_coordinates(ok.astype(np.float32), [cy, cx], order=0) > 0.5
    return out, valid
def naip(lat, lon, H=3000):
    # one equirectangular export with square pixels (the service caps at 4000 px), resampled onto the level grid
    la0, la1, lo0, lo1 = lat.min() - 0.01, lat.max() + 0.01, lon.min() - 0.01, lon.max() + 0.01
    W = min(4000, round(H * (lo1 - lo0) / (la1 - la0)))
    url = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=%.6f,%.6f,%.6f,%.6f&bboxSR=4326&imageSR=4326&size=%d,%d&format=jpg&f=image' % (lo0, la0, lo1, la1, W, H)
    big = np.asarray(Image.open(fetch(url, 'naip1_%.5f_%.5f_%.5f_%.5f_%d.jpg' % (lo0, la0, lo1, la1, H))).convert('RGB'))
    h, w = big.shape[:2]; ry = (la1 - lat) / (la1 - la0) * h - 0.5; rx = (lon - lo0) / (lo1 - lo0) * w - 0.5
    out = np.stack([ndimage.map_coordinates(big[..., c].astype(np.float32), [ry, rx], order=1, mode='nearest') for c in range(3)], -1)
    return out, np.ones(lat.shape, bool)
def dem(lat, lon, size=1024):
    la0, la1, lo0, lo1 = lat.min() - 0.02, lat.max() + 0.02, lon.min() - 0.02, lon.max() + 0.02
    fn = f'dem_{la0:.4f}_{lo0:.4f}_{la1:.4f}_{lo1:.4f}_{size}.tif'
    url = f'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={lo0},{la0},{lo1},{la1}&bboxSR=4326&imageSR=4326&size={size},{size}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image'
    a = tifffile.imread(fetch(url, fn)).astype(np.float32)
    a[~np.isfinite(a) | (a < -1000)] = 0
    ry = (la1 - lat) / (la1 - la0) * size - 0.5; rx = (lon - lo0) / (lo1 - lo0) * size - 0.5
    return ndimage.map_coordinates(a, [ry, rx], order=1, mode='nearest')

prev = None; info = []
for k in range(NL):
    E = E0 / 2 ** k
    src, zm = ('bm', 8) if k <= 1 else ('naip', 0)
    x, z = grid(E, CS * 2); la, lo = latlon(x, z)
    big, valid = mosaic(src, zm, la, lo) if src == 'bm' else naip(la, lo)
    if src == 'naip':
        dark = big.max(-1) < 7                                       # USGS no-data blocks are pure black
        valid &= ~ndimage.binary_dilation(dark, iterations=3)
    if src == 'naip':                                                # NAIP holes (e.g. Vandenberg SFB): Landsat WELD, colour-matched to NAIP
        wb, wv = mosaic('weld', min(12, 8 + k), la, lo); wv &= wb.max(-1) > 10
        both = valid & wv
        if both.sum() > 1000:
            for c in range(3):
                a, b = wb[..., c][both], big[..., c][both]
                wb[..., c] = (wb[..., c] - a.mean()) * (b.std() / max(a.std(), 1)) + b.mean()
        fillw = ~valid & wv; big[fillw] = wb[fillw]; valid = valid | fillw
    col = big.reshape(CS, 2, CS, 2, 3).mean((1, 3)); val = valid.reshape(CS, 2, CS, 2).min((1, 3))
    if prev is not None:                                             # fill no-data from the coarser level (its centre half, upsampled)
        q = CS // 4; up = np.asarray(Image.fromarray(prev[q:q + CS // 2, q:q + CS // 2].astype(np.uint8)).resize((CS, CS), Image.BICUBIC)).astype(np.float32)
        w = ndimage.gaussian_filter(val.astype(np.float32), 2.0) * val  # feather the seams of the fill
        col = col * w[..., None] + up * (1 - w[..., None])
    # relief + water
    xs, zs = grid(E, NS); las, los = latlon(xs, zs)
    h = dem(las, los)
    hc = np.asarray(Image.fromarray(h).resize((CS, CS), Image.BILINEAR))
    lum = col @ np.array([0.3, 0.59, 0.11]) / 255; r, b = col[..., 0], col[..., 2]
    # sea = where 3DEP has no land (0 m), except bright salt flats below sea level (Death Valley)
    cb = np.stack([ndimage.gaussian_filter(col[..., c], 3) for c in range(3)], -1); lb = cb @ np.array([0.3, 0.59, 0.11]) / 255
    waterlike = (cb[..., 2] >= cb[..., 0] * 0.88) & (lb < 0.5)
    water = ((hc <= 0.3) & ~((lum > 0.45) & val)) | (~val & (hc < 3)) | (waterlike & (hc < 4))
    water = ndimage.binary_closing(ndimage.binary_opening(water, iterations=2), iterations=3)
    lab, n = ndimage.label(~water)                                   # drop specks of "land" out at sea (noisy near-shore 3DEP)
    if n:
        area = ndimage.sum(np.ones_like(hc), lab, range(1, n + 1)); top = ndimage.maximum(hc, lab, range(1, n + 1))
        for i in np.where((area < 600) & (np.array(top) < 6))[0]: water[lab == i + 1] = True
    lab, n = ndimage.label(water)                                    # and inland dark patches that are not sea
    if n:
        area = ndimage.sum(np.ones_like(hc), lab, range(1, n + 1)); low = ndimage.minimum(hc, lab, range(1, n + 1))
        for i in np.where((area < 3000) & (np.array(low) > 0.3))[0]: water[lab == i + 1] = False
    land = 1 - ndimage.gaussian_filter(water.astype(np.float32), 1.5)
    landS = np.asarray(Image.fromarray(land).resize((NS, NS), Image.BILINEAR))
    h = np.maximum(h, 0) * (landS > 0.5)
    hs = ndimage.gaussian_filter(h, 0.7)
    sp = E * 1000 / NS
    gz, gx = np.gradient(hs, sp)                                     # rows -> z, cols -> x
    ln = np.sqrt(gx * gx + gz * gz + 1); nx, nz = -gx / ln, -gz / ln
    nrm = np.stack([nx * 0.5 + 0.5, nz * 0.5 + 0.5, np.sqrt(np.clip(h / 5000, 0, 1)), landS], -1)
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(f'{OUT}/col_{k}.webp', quality=86, method=6)
    Image.fromarray(np.clip(nrm * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(f'{OUT}/nrm_{k}.webp', lossless=True, method=6)
    prev = col; info.append(dict(k=k, extent_km=E, source=src, zoom=zm, max_h=round(float(h.max()), 1), land=round(float(land.mean()), 3)))
    print(info[-1], flush=True)
json.dump(dict(lat=LAT0, lon=LON0, E0=E0, levels=NL, color=CS, relief=NS, hscale=5000, axes='+x west, +z north, row 0 south'), open(f'{OUT}/levels.json', 'w'))
