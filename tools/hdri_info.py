# Sun direction / colour and horizon colour per sky HDRI -> assets/hdri/sky_info.json
import numpy as np, json, math, re, sys
def read_hdr(p):
    b = open(p, 'rb').read(); i = b.index(b'\n\n') + 2; j = b.index(b'\n', i); m = re.match(rb'-Y (\d+) \+X (\d+)', b[i:j]); H, W = int(m[1]), int(m[2]); d = b[j+1:]
    out = np.zeros((H, W, 4), np.uint8); k = 0
    for y in range(H):
        k += 4  # 2,2,hi,lo
        for c in range(4):
            x = 0
            while x < W:
                n = d[k]; k += 1
                if n > 128: n -= 128; out[y, x:x+n, c] = d[k]; k += 1
                else: out[y, x:x+n, c] = np.frombuffer(d[k:k+n], np.uint8); k += n
                x += n
    e = out[..., 3].astype(np.float64); f = np.where(e > 0, np.ldexp(1.0, (e - 136).astype(int)), 0)
    return out[..., :3] * f[..., None]
info = {}
for n in ['qwantani_noon_puresky', 'qwantani_sunset_puresky', 'qwantani_dusk_2_puresky', 'kloofendal_overcast_puresky']:
    a = read_hdr(f'assets/hdri/{n}_1k.hdr'); H, W, _ = a.shape
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    r, c = np.unravel_index(np.argmax(lum), lum.shape)
    # centroid of the brightest blob
    m = lum > lum[r, c] * 0.5; ys, xs = np.nonzero(m); w = lum[m]
    xs = np.where(np.abs(xs - c) > W / 2, xs + np.sign(c - xs) * W, xs)
    cy, cx = (ys * w).sum() / w.sum(), (xs * w).sum() / w.sum()
    u, v = (cx + .5) / W, 1 - (cy + .5) / H
    phi, th = (u - .5) * 2 * math.pi, (v - .5) * math.pi     # three.js equirect: u = atan(z,x)/2pi + .5
    d = [math.cos(th) * math.cos(phi), math.sin(th), math.cos(th) * math.sin(phi)]
    sun = a[m].sum(0); sun = sun / sun.max()
    band = np.median(a[int(H * .45):int(H * .495)].reshape(-1, 3), 0)   # just above the horizon
    up = np.median(a[:int(H * .2)].reshape(-1, 3), 0)
    info[n] = dict(sunDir=[round(x, 4) for x in d], sunColor=[round(x, 3) for x in sun], peak=round(float(lum[r, c]), 1), horizon=[round(x, 4) for x in band], zenith=[round(x, 4) for x in up], elevDeg=round(math.degrees(th), 1))
    print(n, info[n])
json.dump(info, open('assets/hdri/sky_info.json', 'w'), indent=1)
