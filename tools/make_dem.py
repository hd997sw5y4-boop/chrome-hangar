# Converts the Guadalupe coastal DEMs (Web-Mercator GeoTIFF, metres) into the game's Int16 decimetre grids.
# Rotated 180 degrees (world +x = real west, +z = real north) so the Pacific lies at +x and the layout still matches the globe. Ocean cells get a sloping sea floor.
import json, math, sys, numpy as np, tifffile
from scipy import ndimage
SRC = '/workspace/chrome-hangar-assets/terrain/'
OUT = '/workspace/chrome-hangar/assets/terrain/'
SITE_C = (-12.0, -77.0)          # world centre of the flat launch site

def load(name):
    # asset-worker deliverable: 16-bit PNG + JSON (row 0 north, col 0 west, metres = hmin + v/65535*(hmax-hmin))
    from PIL import Image
    meta = json.load(open(SRC + name + '_height.json'))
    png = [f for f in __import__('os').listdir(SRC) if f.startswith(name + '_height_') and f.endswith('.png')][0]
    v = np.array(Image.open(SRC + png)).astype(np.float64)
    a = meta['hmin_m'] + v / 65535.0 * (meta['hmax_m'] - meta['hmin_m'])
    return a[::-1, ::-1], meta['pixel_size_m']['x']    # rotate 180: +x west, +z north

def seafloor(a, spacing):
    ocean = a <= 0.25
    lab, n = ndimage.label(ocean)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    sea = np.isin(lab, list(edge))
    d = ndimage.distance_transform_edt(sea) * spacing
    out = a.copy(); out[sea] = -(1.2 + np.minimum(d[sea] * 0.035, 40.0))
    return out, sea

hi, sh = load('guadalupe_dunes_4km')
lo, sl = load('guadalupe_coast_24km')
lo, sea_lo = seafloor(lo, sl)
hi, sea_hi = seafloor(hi, sh)

# pick the launch site in the high-res tile: flattest 600 m window, 2-20 m above sea, 1-3.5 km from the shore
win = int(600 / sh)
gy, gx = np.gradient(hi, sh)
slope = ndimage.uniform_filter(np.hypot(gx, gy), win)
mean = ndimage.uniform_filter(hi, win)
dshore = ndimage.distance_transform_edt(~sea_hi) * sh
score = slope + (mean < 2) * 9 + (mean > 20) * 9 + ((dshore < 1000) | (dshore > 3500)) * 9
m = int(700 / sh); score[:m] = score[-m:] = 99; score[:, :m] = score[:, -m:] = 99
iy, ix = np.unravel_index(np.argmin(score), score.shape)
H0 = float(mean[iy, ix])
print('site px', ix, iy, 'height', round(H0, 2), 'slope', round(float(slope[iy, ix]), 4), 'shore m', round(float(dshore[iy, ix])))

# world placement: hi pixel (ix, iy) -> SITE_C; the low-res grid shares the same centre as the high-res one
hx0 = SITE_C[0] - ix * sh; hz0 = SITE_C[1] - iy * sh
cxw = hx0 + (hi.shape[1] - 1) * sh / 2; czw = hz0 + (hi.shape[0] - 1) * sh / 2
lx0 = cxw - (lo.shape[1] - 1) * sl / 2; lz0 = czw - (lo.shape[0] - 1) * sl / 2
sea_level = -H0 - 0.0
def save(name, a, spacing, x0, z0):
    q = np.clip(np.round((a - H0) * 10), -32000, 32000).astype('<i2')
    q.tofile(OUT + name + '.bin')
    meta = dict(w=int(a.shape[1]), h=int(a.shape[0]), spacing=spacing, x0=x0, z0=z0, sea=round(sea_level, 2), lat=SITE_LL[0], lon=SITE_LL[1], axes='+x west, +z north')
    json.dump(meta, open(OUT + name + '.json', 'w'))
    print(name, meta, 'range', float(a.min() - H0), float(a.max() - H0))
# real coordinates of the site centre (for the globe)
M4 = json.load(open(SRC + 'guadalupe_dunes_4km_height.json')); bb = M4['bbox_wgs84']; N = hi.shape[0] - 1
SITE_LL = (bb['north'] - (N - iy) / N * (bb['north'] - bb['south']), bb['west'] + (N - ix) / N * (bb['east'] - bb['west']))
print('site lat/lon', SITE_LL)
save('coast_dem_hi', hi, sh, hx0, hz0)
save('coast_dem_lo', lo, sl, lx0, lz0)
# coast line (first sea column east of the site, per world z) for surf and beach shading
rows = []
for j in range(0, lo.shape[0], 2):
    sea_cols = np.where(sea_lo[j])[0]
    if len(sea_cols): rows.append([round(lz0 + j * sl, 1), round(lx0 + sea_cols.min() * sl, 1)])
json.dump(rows, open(OUT + 'coast_line.json', 'w'))
print('coast x near site', [r for r in rows if abs(r[0] - SITE_C[1]) < 200])

# macro colour from the aerial imagery (mirrored the same way), WebP for the game
from PIL import Image
for src, dst, size in [('guadalupe_dunes_4km_albedo_2k.webp', 'albedo_hi_2k.webp', 2048), ('guadalupe_dunes_4km_albedo_1k.webp', 'albedo_hi_1k.webp', 1024), ('guadalupe_coast_24km_albedo_1k.webp', 'albedo_lo_1k.webp', 1024)]:
    im = Image.open(SRC + src).convert('RGB').transpose(Image.ROTATE_180).resize((size, size), Image.LANCZOS)
    # alpha = valid imagery (the mosaics have white / black no-data blocks); shaders fall back where alpha is 0
    from PIL import ImageFilter
    a = np.asarray(im).astype(np.int16)
    bad = ((a.min(2) > 246) | (a.max(2) < 8)).astype(np.uint8) * 255
    m = Image.fromarray(bad).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3))
    im.putalpha(Image.fromarray(255 - np.asarray(m)))
    im.save(OUT + dst, quality=86, alpha_quality=70, method=6)
print('albedo done')
