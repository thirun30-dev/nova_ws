// Tiny WebGL renderer for NOVA (no three.js): z-up world (ROS), lit meshes with rim glow + fog,
// lines/points, a textured floor, ground-plane picking and screen projection for HTML labels.

// ------------------------------------------------------------------ math (column-major mat4)
export const m4 = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  persp(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const o = new Float32Array(16);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) / (near - far);
    o[11] = -1;
    o[14] = (2 * far * near) / (near - far);
    return o;
  },
  lookAt(e, c, up = [0, 0, 1]) {
    let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]];
    z = norm(z);
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  },
  // translate * rotZ(yaw) * scale
  trs(tx, ty, tz, yaw = 0, sx = 1, sy = sx, sz = sx) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return new Float32Array([c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, sz, 0, tx, ty, tz, 1]);
  },
  invert(m) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m4.ident();
    det = 1 / det;
    return new Float32Array([
      (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
      (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
      (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
      (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
      (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
      (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
      (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
      (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ]);
  },
  apply(m, [x, y, z], w = 1) {
    const ox = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    const oy = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    const oz = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    const ow = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    return [ox / ow, oy / ow, oz / ow, ow];
  },
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------ geometry builder
export class Geo {
  constructor() {
    this.p = [];
    this.n = [];
  }
  tri(a, b, c) {
    const nn = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    for (const v of [a, b, c]) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nn[0], nn[1], nn[2]);
    }
    return this;
  }
  quad(a, b, c, d) {
    return this.tri(a, b, c).tri(a, c, d);
  }
  /** Extrude a CCW polygon [[x,y]...] from z0 to z1; `map` re-orients/moves each vertex. */
  prism(poly, z0, z1, map = (v) => v, caps = true) {
    const n = poly.length;
    const B = poly.map(([x, y]) => map([x, y, z0]));
    const T = poly.map(([x, y]) => map([x, y, z1]));
    if (caps) {
      const cb = map([0, 0, z0]);
      const ct = map([0, 0, z1]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.tri(ct, T[i], T[j]);
        this.tri(cb, B[j], B[i]);
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(B[i], B[j], T[j], T[i]);
    }
    return this;
  }
  box(cx, cy, cz, sx, sy, sz) {
    const hx = sx / 2;
    const hy = sy / 2;
    return this.prism([[hx, hy], [-hx, hy], [-hx, -hy], [hx, -hy]], cz - sz / 2, cz + sz / 2, ([x, y, z]) => [x + cx, y + cy, z]);
  }
  /** Cylinder centred at (cx,cy,cz) along axis 'x' | 'y' | 'z'. */
  cyl(cx, cy, cz, r, h, axis = 'z', seg = 22) {
    const poly = [];
    for (let i = 0; i < seg; i++) poly.push([r * Math.cos((2 * Math.PI * i) / seg), r * Math.sin((2 * Math.PI * i) / seg)]);
    const map = {
      z: ([x, y, z]) => [x + cx, y + cy, z + cz],
      y: ([x, y, z]) => [x + cx, z + cy, y + cz],
      x: ([x, y, z]) => [z + cx, x + cy, y + cz],
    }[axis];
    return this.prism(poly, -h / 2, h / 2, map);
  }
  /** Flat ring in the XY plane at height z. */
  ring(cx, cy, z, r0, r1, seg = 40) {
    for (let i = 0; i < seg; i++) {
      const a0 = (2 * Math.PI * i) / seg;
      const a1 = (2 * Math.PI * (i + 1)) / seg;
      const P = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
      this.quad(P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a1));
    }
    return this;
  }
  get count() {
    return this.p.length / 3;
  }
}

export const HEX = (len, wid) => {
  const a = len / 2;
  const b = len / 4;
  const w = wid / 2;
  return [[a, 0], [b, w], [-b, w], [-a, 0], [-b, -w], [b, -w]];
};

// ------------------------------------------------------------------ shaders
const MESH_VS = `
attribute vec3 aPos; attribute vec3 aNrm;
uniform mat4 uModel; uniform mat4 uVP;
varying vec3 vN; varying vec3 vW;
void main(){ vec4 w = uModel * vec4(aPos,1.0); vW = w.xyz; vN = mat3(uModel) * aNrm; gl_Position = uVP * w; }`;
const MESH_FS = `
precision mediump float;
varying vec3 vN; varying vec3 vW;
uniform vec4 uColor; uniform float uEmissive; uniform vec3 uLight; uniform vec3 uCam;
uniform vec3 uRim; uniform vec3 uFogColor; uniform vec2 uFog;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(uCam - vW);
  if (dot(n, v) < 0.0) n = -n;
  float d = max(dot(n, normalize(uLight)), 0.0);
  float d2 = max(dot(n, normalize(vec3(-0.4, 0.6, 0.5))), 0.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 c = uColor.rgb * (0.22 + 0.62 * d + 0.18 * d2) + uRim * rim * 0.6 + uColor.rgb * uEmissive;
  float f = smoothstep(uFog.x, uFog.y, length(uCam - vW));
  gl_FragColor = vec4(mix(c, uFogColor, f), uColor.a);
}`;
const LINE_VS = `
attribute vec3 aPos; attribute vec4 aCol;
uniform mat4 uVP; uniform float uSize; varying vec4 vC;
void main(){ gl_Position = uVP * vec4(aPos,1.0); gl_PointSize = uSize; vC = aCol; }`;
const LINE_FS = `
precision mediump float; varying vec4 vC; uniform float uPoint;
void main(){
  if (uPoint > 0.5) { vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
    gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r * 1.7)); }
  else gl_FragColor = vC;
}`;
const FLOOR_VS = `
attribute vec3 aPos; attribute vec2 aUV; uniform mat4 uVP; varying vec2 vUV; varying vec3 vW;
void main(){ vUV = aUV; vW = aPos; gl_Position = uVP * vec4(aPos,1.0); }`;
const FLOOR_FS = `
precision mediump float; varying vec2 vUV; varying vec3 vW;
uniform sampler2D uTex; uniform vec3 uCam; uniform vec3 uFogColor; uniform vec2 uFog; uniform float uAlpha;
void main(){ vec4 t = texture2D(uTex, vUV); float f = smoothstep(uFog.x, uFog.y, length(uCam - vW));
  gl_FragColor = vec4(mix(t.rgb, uFogColor, f), t.a * uAlpha); }`;

function program(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {};
  const nA = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < nA; i++) { const n = gl.getActiveAttrib(p, i).name; loc[n] = gl.getAttribLocation(p, n); }
  const nU = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nU; i++) { const n = gl.getActiveUniform(p, i).name; loc[n] = gl.getUniformLocation(p, n); }
  return { p, loc };
}

// ------------------------------------------------------------------ engine
export class Engine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;
    this.mesh = program(gl, MESH_VS, MESH_FS);
    this.line = program(gl, LINE_VS, LINE_FS);
    this.floorP = program(gl, FLOOR_VS, FLOOR_FS);
    this.dyn = gl.createBuffer();
    this.dynCol = gl.createBuffer();
    this.clear = opts.clear || [0.02, 0.03, 0.06, 0];
    this.fogColor = opts.fogColor || [0.02, 0.035, 0.07];
    this.fog = opts.fog || [8, 30];
    this.rim = opts.rim || [0.13, 0.83, 0.93];
    this.light = [0.35, -0.5, 0.8];
    this.vp = m4.ident();
    this.cam = [5, 5, 5];
    this.dpr = 1;
  }

  createMesh(geo) {
    const gl = this.gl;
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.p), gl.STATIC_DRAW);
    const nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.n), gl.STATIC_DRAW);
    return { pb, nb, count: geo.count };
  }

  deleteMesh(m) {
    if (!m) return;
    this.gl.deleteBuffer(m.pb);
    this.gl.deleteBuffer(m.nb);
  }

  /** Floor quad textured with an RGBA image (Uint8Array, width x height, row 0 = bottom). */
  setFloor(rgba, width, height, x0, y0, x1, y1) {
    const gl = this.gl;
    if (!this.floorTex) this.floorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (!this.floorBuf) this.floorBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.floorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      x0, y0, 0, 0, 0, x1, y0, 0, 1, 0, x1, y1, 0, 1, 1,
      x0, y0, 0, 0, 0, x1, y1, 0, 1, 1, x0, y1, 0, 0, 1,
    ]), gl.STATIC_DRAW);
    this.hasFloor = true;
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    this.dpr = dpr;
    return [c.clientWidth, c.clientHeight];
  }

  begin(eye, target, fov = 0.9) {
    const gl = this.gl;
    const [w, h] = this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...this.clear);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const dist = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
    this.view = m4.lookAt(eye, target);
    this.proj = m4.persp(fov, w / h, Math.max(0.005, dist * 0.01), 200);
    this.vp = m4.mul(this.proj, this.view);
    this.cam = eye;
    this.size = [w, h];
  }

  drawFloor(alpha = 1) {
    if (!this.hasFloor) return;
    const gl = this.gl;
    const { p, loc } = this.floorP;
    gl.useProgram(p);
    gl.uniformMatrix4fv(loc.uVP, false, this.vp);
    gl.uniform3fv(loc.uCam, this.cam);
    gl.uniform3fv(loc.uFogColor, this.fogColor);
    gl.uniform2fv(loc.uFog, this.fog);
    gl.uniform1f(loc.uAlpha, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.floorTex);
    gl.uniform1i(loc.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.floorBuf);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(loc.aUV);
    gl.vertexAttribPointer(loc.aUV, 2, gl.FLOAT, false, 20, 12);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc.aUV);
  }

  /** color = [r,g,b,a] (0..1). Transparent meshes blend and don't write depth; additive for glows. */
  drawMesh(mesh, model, color, emissive = 0, { additive = false } = {}) {
    if (!mesh || !mesh.count) return;
    const gl = this.gl;
    const { p, loc } = this.mesh;
    gl.useProgram(p);
    gl.uniformMatrix4fv(loc.uVP, false, this.vp);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniform4fv(loc.uColor, color);
    gl.uniform1f(loc.uEmissive, emissive);
    gl.uniform3fv(loc.uLight, this.light);
    gl.uniform3fv(loc.uCam, this.cam);
    gl.uniform3fv(loc.uRim, this.rim);
    gl.uniform3fv(loc.uFogColor, this.fogColor);
    gl.uniform2fv(loc.uFog, this.fog);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb);
    gl.enableVertexAttribArray(loc.aNrm);
    gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 0, 0);
    const transparent = color[3] < 0.999 || additive;
    if (transparent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    } else gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.depthMask(true);
    gl.disableVertexAttribArray(loc.aNrm);
  }

  /** Lines or points from flat arrays: pos [x,y,z,...], col [r,g,b,a,...]. mode: 'lines'|'strip'|'points'. */
  drawLines(pos, col, mode = 'lines', { size = 3, additive = true, depthTest = true } = {}) {
    const n = pos.length / 3;
    if (!n) return;
    const gl = this.gl;
    const { p, loc } = this.line;
    gl.useProgram(p);
    gl.uniformMatrix4fv(loc.uVP, false, this.vp);
    gl.uniform1f(loc.uSize, size * this.dpr);
    gl.uniform1f(loc.uPoint, mode === 'points' ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn);
    gl.bufferData(gl.ARRAY_BUFFER, pos instanceof Float32Array ? pos : new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynCol);
    gl.bufferData(gl.ARRAY_BUFFER, col instanceof Float32Array ? col : new Float32Array(col), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc.aCol);
    gl.vertexAttribPointer(loc.aCol, 4, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (!depthTest) gl.disable(gl.DEPTH_TEST);
    gl.drawArrays({ lines: gl.LINES, strip: gl.LINE_STRIP, points: gl.POINTS }[mode], 0, n);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disableVertexAttribArray(loc.aCol);
  }

  /** World point -> CSS pixel coords (null if behind the camera). */
  project(pt) {
    const [x, y, z, w] = m4.apply(this.vp, pt);
    if (w <= 0 || z > 1) return null;
    return [((x + 1) / 2) * this.size[0], ((1 - y) / 2) * this.size[1]];
  }

  /** CSS pixel -> point on the ground plane z = h (or null). */
  pickGround(px, py, h = 0) {
    const inv = m4.invert(this.vp);
    const nx = (px / this.size[0]) * 2 - 1;
    const ny = 1 - (py / this.size[1]) * 2;
    const a = m4.apply(inv, [nx, ny, -1]);
    const b = m4.apply(inv, [nx, ny, 1]);
    const dz = b[2] - a[2];
    if (Math.abs(dz) < 1e-9) return null;
    const t = (h - a[2]) / dz;
    if (t < 0) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
}

/** Orbit camera state helper (spherical around a target, z-up). */
export class OrbitCam {
  constructor({ target = [0, 0, 0], dist = 10, yaw = -2.2, pitch = 0.9 } = {}) {
    Object.assign(this, { target: [...target], dist, yaw, pitch });
    this.goal = null;
  }
  eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.dist * cp * Math.cos(this.yaw),
      this.target[1] + this.dist * cp * Math.sin(this.yaw),
      this.target[2] + this.dist * Math.sin(this.pitch),
    ];
  }
  rotate(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.08, Math.min(1.53, this.pitch + dy * 0.005));
  }
  zoom(f, min = 0.3, max = 60) {
    this.dist = Math.max(min, Math.min(max, this.dist * f));
  }
  pan(dx, dy) {
    // grab-style pan on the ground plane
    const s = this.dist * 0.0016;
    const fwd = [-Math.cos(this.yaw), -Math.sin(this.yaw)]; // eye -> target
    const right = [-Math.sin(this.yaw), Math.cos(this.yaw)];
    this.target[0] += (-right[0] * dx + fwd[0] * dy) * s;
    this.target[1] += (-right[1] * dx + fwd[1] * dy) * s;
  }
  /** Smoothly approach `goal` = {target, dist, yaw, pitch} (any subset). */
  update(k = 0.08) {
    if (!this.goal) return;
    const g = this.goal;
    if (g.target) for (let i = 0; i < 3; i++) this.target[i] += (g.target[i] - this.target[i]) * k;
    if (g.dist !== undefined) this.dist += (g.dist - this.dist) * k;
    if (g.pitch !== undefined) this.pitch += (g.pitch - this.pitch) * k;
    if (g.yaw !== undefined) {
      const d = Math.atan2(Math.sin(g.yaw - this.yaw), Math.cos(g.yaw - this.yaw));
      this.yaw += d * k;
    }
  }
}
