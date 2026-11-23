#!/usr/bin/env python3
"""Generate a UNIT hexagonal prism STL used for NOVA's three layers.

Unit size: 1.0 vertex-to-vertex along x, 1.0 flat-to-flat along y, z from 0 to 1.
The URDF scales it with  scale="hex_length hex_width height", so changing
dimensions in properties.xacro never needs a new mesh.

Usage: python3 tools/gen_hex_mesh.py src/nova_description/meshes/hex_prism.stl
"""
import struct
import sys


def hexagon(a=0.5, b=0.25, w=0.5):
    # counter-clockwise, starting at the front vertex
    return [(a, 0.0), (b, w), (-b, w), (-a, 0.0), (-b, -w), (b, -w)]


def normal(p0, p1, p2):
    ux, uy, uz = (p1[i] - p0[i] for i in range(3))
    vx, vy, vz = (p2[i] - p0[i] for i in range(3))
    n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    length = sum(c * c for c in n) ** 0.5 or 1.0
    return tuple(c / length for c in n)


def build_triangles():
    pts = hexagon()
    tris = []
    bottom = [(x, y, 0.0) for x, y in pts]
    top = [(x, y, 1.0) for x, y in pts]
    cb, ct = (0.0, 0.0, 0.0), (0.0, 0.0, 1.0)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        tris.append((ct, top[i], top[j]))           # top cap (normal +z)
        tris.append((cb, bottom[j], bottom[i]))     # bottom cap (normal -z)
        tris.append((bottom[i], bottom[j], top[j]))  # side
        tris.append((bottom[i], top[j], top[i]))
    return tris


def write_binary_stl(path, tris):
    with open(path, 'wb') as f:
        f.write(b'NOVA unit hexagonal prism'.ljust(80, b' '))
        f.write(struct.pack('<I', len(tris)))
        for t in tris:
            f.write(struct.pack('<3f', *normal(*t)))
            for v in t:
                f.write(struct.pack('<3f', *v))
            f.write(struct.pack('<H', 0))


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'hex_prism.stl'
    tris = build_triangles()
    write_binary_stl(out, tris)
    print(f'wrote {out} ({len(tris)} triangles)')
