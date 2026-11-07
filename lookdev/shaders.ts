// GLSL ES 1.00, so this runs on WebGL 1 hardware. Lighting happens in the vertex shader. The
// fragment shaders do a shadow lookup, a material lookup and the fog mix.

const FS_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const worldVs = (skin: boolean, sway = false) => `
attribute vec3 aPos;
attribute vec4 aNormal;
attribute vec4 aColor;
attribute vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uShadowM;
uniform vec3 uCam;
uniform vec3 uL;
uniform vec3 uSun;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uUnlit;
uniform float uSunCurve;
uniform float uBands;
uniform float uFogD;
uniform float uFogMax;
uniform vec3 uFill;
uniform vec3 uFillDir;
uniform float uSpec;
${sway ? "uniform float uTime;\nuniform float uWind;" : ""}
${skin ? "uniform mat4 uBones[16];" : ""}
varying vec3 vShade;
varying vec3 vSun;
varying vec3 vShadowP;
varying vec2 vUv;
varying float vFog;
void main() {
  ${skin ? "mat4 M = uModel * uBones[int(aUv.x + 0.5)];" : "mat4 M = uModel;"}
  vec4 W = M * vec4(aPos, 1.0);
  ${sway ? `// Plants lean with the gusts: rooted at the ground, and shivering at the tips.
  float gust = sin(uTime * 1.7 - W.x * 0.28 + W.z * 0.5) * 0.5 + 0.5;
  float shiver = sin(uTime * 8.0 + W.z * 3.1 + W.x * 2.3);
  W.x += W.y * W.y * uWind * (0.1 + 0.3 * gust * gust + 0.035 * shiver);
  W.z += W.y * W.y * uWind * 0.04 * shiver;` : ""}
  vec3 N = normalize(M[0].xyz * aNormal.x + M[1].xyz * aNormal.y + M[2].xyz * aNormal.z);
  vec3 albedo = aColor.rgb;
  if (aNormal.w > 0.5) {
    vShade = albedo * uUnlit;
    vSun = vec3(0.0);
  } else {
    float ndl = max(dot(N, uL), 0.0);
    float s = pow(ndl, uSunCurve);
    if (uBands > 0.0) s = floor(s * uBands + 0.5) / uBands;
    vShade = albedo * mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5)
           + albedo * uFill * max(dot(N, uFillDir), 0.0);
    vSun = albedo * uSun * s;
    if (uSpec > 0.0) {
      vec3 H = normalize(normalize(uCam - W.xyz) + uL);
      vSun += uSun * uSpec * pow(max(dot(N, H), 0.0), 26.0);
    }
  }
  vec4 sp = uShadowM * vec4(W.xyz + N * 0.09, 1.0);
  vShadowP = sp.xyz;
  vUv = ${skin ? "vec2(0.5)" : "aUv"};
  float d = length(W.xyz - uCam);
  vFog = min(1.0 - exp(-d * uFogD), uFogMax) * aColor.a;
  gl_Position = uViewProj * W;
}
`;

export const WORLD_VS = worldVs(false);
export const SKIN_VS = worldVs(true);
export const FOLIAGE_VS = worldVs(false, true);

const SHADOW_FS = `
uniform sampler2D uShadow;
uniform float uTexel;
uniform vec3 uFog;
uniform float uGray;
uniform float uFogSteps;
varying vec3 vShade;
varying vec3 vSun;
varying vec3 vShadowP;
varying vec2 vUv;
varying float vFog;
float occl(vec2 uv, float z) {
  vec4 t = texture2D(uShadow, uv);
  return step(z, t.r + t.g / 255.0);
}
float sunLit() {
  if (dot(vSun, vSun) <= 0.00001) return 1.0;
  float z = vShadowP.z - 0.0009;
  vec2 uv = vShadowP.xy;
  return 0.25 * (occl(uv + vec2(-uTexel, -uTexel) * 0.5, z)
               + occl(uv + vec2( uTexel, -uTexel) * 0.5, z)
               + occl(uv + vec2(-uTexel,  uTexel) * 0.5, z)
               + occl(uv + vec2( uTexel,  uTexel) * 0.5, z));
}
vec4 finish(vec3 c, float a) {
  // Flat art: distance fog snaps into a few solid layers, like painted background cards.
  float fogK = uFogSteps > 0.0 ? floor(vFog * uFogSteps + 0.5) / uFogSteps : vFog;
  c = mix(c, uFog, fogK);
  if (uGray > 0.5) c = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
  return vec4(c, a);
}
`;

/** Wood, rock and plain: palette colour times a brightness tile. */
export const WORLD_FS = `${FS_PRECISION}${SHADOW_FS}
uniform sampler2D uDetail;
void main() {
  vec3 tex = texture2D(uDetail, vUv).rgb * 2.0;
  gl_FragColor = finish((vShade + vSun * sunLit()) * tex, 1.0);
}
`;

/** Plant cards: hard-edged alpha, smoothed by multisampling through alpha-to-coverage. */
export const FOLIAGE_FS = `${FS_PRECISION}${SHADOW_FS}
uniform sampler2D uDetail;
void main() {
  vec4 t = texture2D(uDetail, vUv);
  if (t.a < 0.2) discard;
  gl_FragColor = finish((vShade + vSun * sunLit()) * t.rgb * 2.0, clamp((t.a - 0.35) / 0.25, 0.0, 1.0));
}
`;

/**
 * The ground. uv holds world xz. A splat map says sand or dirt, the sand's height breaks up that
 * edge so it looks painted rather than blurred, and each side has its own detail tile.
 */
export const GROUND_FS = `${FS_PRECISION}${SHADOW_FS}
uniform sampler2D uSplat;
uniform sampler2D uSand;
uniform sampler2D uDirt;
uniform vec3 uSandCol;
uniform vec3 uDirtCol;
uniform vec3 uWearCol;
uniform vec4 uSplatX;
uniform float uTime;
uniform float uWind;
void main() {
  vec4 m = texture2D(uSplat, vUv * uSplatX.xy + uSplatX.zw);
  vec4 sd = texture2D(uSand, vUv * 0.15);
  vec4 dt = texture2D(uDirt, vUv * 0.19);
  float s = smoothstep(0.46, 0.54, m.r + (sd.a - 0.5) * 0.5);
  vec3 dirt = mix(uDirtCol, uWearCol, m.g) * dt.rgb * 2.0;
  vec3 alb = mix(dirt, uSandCol * sd.rgb * 2.0, s);
  // Blowing sand: long thin streaks snaking across the ground, gathered into moving gusts.
  float snake = sin(vUv.x * 0.21 + uTime * 0.5) * 0.35;
  float fine = texture2D(uSand, vec2(vUv.x * 0.024 - uTime * 0.27, vUv.y * 0.21 + snake)).a;
  float gusts = texture2D(uSand, vec2(vUv.x * 0.0085 - uTime * 0.085, vUv.y * 0.031)).a;
  float blown = smoothstep(0.53, 0.68, fine) * smoothstep(0.42, 0.6, gusts) * uWind;
  alb = mix(alb, uSandCol * 1.14, blown * (0.42 + 0.3 * s));
  // Cloud shadows sliding down the street with the wind.
  float cloud = texture2D(uSand, (vUv - vec2(uTime * 3.2, 0.0)) * 0.0052).a;
  float sunK = 1.0 - smoothstep(0.47, 0.62, cloud) * 0.5 * step(0.001, uWind);
  gl_FragColor = finish((vShade + vSun * sunLit() * sunK) * alb, 1.0);
}
`;

export const DEPTH_VS = `
attribute vec3 aPos;
uniform mat4 uShadowClip;
void main() { gl_Position = uShadowClip * vec4(aPos, 1.0); }
`;

/** Packs depth into two 8-bit channels, because WebGL 1 can't be assumed to have depth textures. */
export const DEPTH_FS = `${FS_PRECISION}
void main() {
  float d = gl_FragCoord.z;
  vec2 enc = fract(vec2(1.0, 255.0) * d);
  enc.x -= enc.y / 255.0;
  gl_FragColor = vec4(enc, 0.0, 1.0);
}
`;

const SKIN_ATTRS = `
attribute vec4 aJoints;
attribute vec4 aWeights;
uniform mat4 uBones[24];
mat4 skinMatrix() {
  return uBones[int(aJoints.x)] * aWeights.x
       + uBones[int(aJoints.y)] * aWeights.y
       + uBones[int(aJoints.z)] * aWeights.z
       + uBones[int(aJoints.w)] * aWeights.w;
}
`;

const planarVs = (skin: boolean) => `
attribute vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uL;
uniform float uGroundY;
${skin ? SKIN_ATTRS : ""}
void main() {
  ${skin ? "vec4 W = uModel * skinMatrix() * vec4(aPos, 1.0);" : "vec4 W = uModel * vec4(aPos, 1.0);"}
  W.xyz -= uL * (max(W.y - uGroundY, 0.0) / uL.y);
  W.y = uGroundY + 0.035;
  gl_Position = uViewProj * W;
}
`;

const toonVs = (skin: boolean) => `
attribute vec3 aPos;
attribute vec4 aNormal;
attribute vec4 aColor;
${skin ? "" : "attribute vec2 aUv;"}
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uCam;
uniform float uFogD;
uniform float uFogMax;
${skin ? SKIN_ATTRS : ""}
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying vec2 vUv;
varying float vFog;
varying float vU;
varying float vLit;
void main() {
  mat4 M = uModel${skin ? " * skinMatrix()" : ""};
  vLit = 1.0 - aColor.a;
  vec4 W = M * vec4(aPos, 1.0);
  vN = M[0].xyz * aNormal.x + M[1].xyz * aNormal.y + M[2].xyz * aNormal.z;
  vV = uCam - W.xyz;
  vC = aColor.rgb;
  vU = aNormal.w;
  vUv = ${skin ? "vec2(0.5)" : "aUv"};
  vFog = min(1.0 - exp(-length(vV) * uFogD), uFogMax);
  gl_Position = uViewProj * W;
}
`;

export const TOON_SKIN_VS = toonVs(true);
export const TOON_VS = toonVs(false);

/**
 * Stylised character shading. A soft two-tone ramp from a flattering camera-side key, tinted
 * shadows instead of dark ones, a warm rim from the real sun, and no cast shadows on the body.
 * Unlike the world shader this runs per pixel, so the ramp stays smooth across the mesh.
 */
export const TOON_FS = `#extension GL_OES_standard_derivatives : enable
${FS_PRECISION}
uniform sampler2D uDetail;
uniform float uFacet;
uniform vec3 uKey;
uniform vec3 uSunDir;
uniform vec3 uLight;
uniform vec3 uShade;
uniform vec3 uRim;
uniform vec3 uFog;
uniform vec3 uFlash;
uniform float uGloss;
uniform float uGray;
uniform float uLit;
uniform float uIsSign;
uniform float uHard;
uniform vec4 uSil;
uniform vec4 uInk;
uniform vec3 uInkDark;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying vec2 vUv;
varying float vFog;
varying float vU;
varying float vLit;
void main() {
  if (uSil.a > 0.5) {
    gl_FragColor = vec4(uSil.rgb, 1.0);
    return;
  }
  vec3 c;
  if (vU > 0.5) {
    c = vC;
  } else {
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    // Leans toward each triangle's own normal, so the facets show.
    #ifdef GL_OES_standard_derivatives
    if (uFacet > 0.0) N = normalize(mix(N, normalize(cross(dFdx(vV), dFdy(vV))), uFacet));
    #endif
    // A printed comic: x on, y where shadow starts, z dither cell in pixels, w how thick the contour.
    // Every surface is its one flat colour, its shadow is a darker flat colour, and an ordered dither
    // lies between them. The contour is solid ink.
    if (uInk.x > 0.5) {
      float k = clamp((dot(N, uKey) - (uInk.y - 0.34)) / 0.34, 0.0, 1.0);
      float lit = step(bayer4(gl_FragCoord.xy / uInk.z), k);
      vec3 flatCol = mix(mix(vC * 0.42, uInkDark, 0.22), vC, lit);
      gl_FragColor = vec4(mix(uInkDark, flatCol, step(uInk.w, dot(N, V))) + vC * uFlash, 1.0);
      return;
    }
    float w = dot(N, uKey) * 0.5 + 0.5;
    float ramp = uHard > 0.5 ? step(0.34, w) : smoothstep(0.3, 0.6, w);
    // Above 1, uHard is a halftone's cell size in pixels: shadow becomes dots that grow into solid.
    if (uHard > 1.5) {
      vec2 g = vec2(gl_FragCoord.x + gl_FragCoord.y, gl_FragCoord.x - gl_FragCoord.y) * 0.7071 / uHard;
      float d = length(fract(g) - 0.5) * 1.414;
      ramp = 1.0 - step(d, clamp((0.68 - w) / 0.36, 0.0, 1.0));
    }
    // Below -1, it's a dither's cell size instead: shadow breaks up in an ordered pattern.
    if (uHard < -0.5) {
      ramp = step(bayer4(gl_FragCoord.xy / -uHard), clamp((w - 0.2) / 0.42, 0.0, 1.0));
    }
    // Exactly 1.25 means completely flat: every surface shows its colour, with no shadow at all.
    if (abs(uHard - 1.25) < 0.01) ramp = 1.0;
    float hard = step(0.5, abs(uHard));
    vec3 tone = mix(uShade, uLight, ramp);
    if (hard < 0.5) tone *= mix(0.95, 1.03, N.y * 0.5 + 0.5);
    c = vC * tone * texture2D(uDetail, vUv).rgb * 2.0;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    c += uRim * fres * (0.16 + 0.34 * max(dot(N, uSunDir) * 0.5 + 0.5, 0.0)) * (1.0 - hard);
    if (uGloss > 0.0) {
      vec3 H = normalize(V + uKey);
      c += uGloss * smoothstep(0.86, 0.97, dot(N, H));
    }
    c += vC * uFlash;
    // A lit sign, like a marquee: the board drops dark so the letters burn gold against it.
    c = mix(c, vec3(1.0, 0.82, 0.28), vLit * uLit);
    c = mix(c, vC * vec3(0.26, 0.17, 0.12), (1.0 - vLit) * uLit * uIsSign);
  }
  c = mix(c, uFog, vFog);
  if (uGray > 0.5) c = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Moving objects throw a flattened copy of themselves onto the ground. */
export const PLANAR_VS = planarVs(false);
export const PLANAR_SKIN_VS = planarVs(true);

export const PLANAR_FS = `${FS_PRECISION}
uniform vec3 uMul;
void main() { gl_FragColor = vec4(uMul, 1.0); }
`;

export const SKY_VS = `
attribute vec3 aPos;
uniform mat4 uInvVP;
varying vec3 vDir;
void main() {
  vec4 p = uInvVP * vec4(aPos.xy, 1.0, 1.0);
  vDir = p.xyz / p.w;
  gl_Position = vec4(aPos.xy, 0.9999, 1.0);
}
`;

export const SKY_FS = `${FS_PRECISION}
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSunDisc;
uniform vec3 uSunGlow;
uniform vec3 uL;
uniform vec4 uStops; // midAt, zenithAt (sine of elevation), sun disc cos, glow cos
uniform float uGlowGain;
uniform float uBands;
uniform float uGray;
uniform float uNight;
varying vec3 vDir;
/** Where the moon is, in the town: over the bank, seen from the end of the road. */
const vec3 MOON = vec3(0.098, 0.22, -0.97);
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float a = smoothstep(0.0, uStops.x, h);
  float b = smoothstep(uStops.x, uStops.y, h);
  if (uBands > 0.0) {
    a = floor(a * uBands + 0.5) / uBands;
    b = floor(b * uBands + 0.5) / uBands;
  }
  vec3 c = mix(mix(uHorizon, uMid, a), uZenith, b);
  float s = dot(d, uL);
  float g = clamp((s - uStops.w) / (1.0 - uStops.w), 0.0, 1.0);
  c += uSunGlow * g * g * uGlowGain;
  float e = smoothstep(uStops.z - 0.0012, uStops.z + 0.0012, s);
  c = mix(c, uSunDisc, e * (1.0 - uNight));
  if (uNight > 0.0) {
    // Stars come out as blocks, the same as everything else up there, thinning toward the horizon.
    vec3 cell = floor(d * 120.0);
    float star = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float shown = smoothstep(0.08, 0.34, d.y) * smoothstep(0.55, 1.0, uNight);
    c = mix(c, vec3(1.0), step(0.9955, star) * shown);
    float m = dot(d, MOON);
    float halo = clamp((m - 0.93) / 0.07, 0.0, 1.0);
    c += vec3(0.16, 0.2, 0.34) * halo * halo * uNight;
    c = mix(c, vec3(1.0, 1.0, 0.95), smoothstep(0.9974, 0.9979, m) * uNight);
  }
  if (uGray > 0.5) c = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Additive sun wash over everything: one quad, and the whole reason the distance feels hot. */
export const WASH_VS = `
attribute vec3 aPos;
varying vec2 vP;
void main() {
  vP = aPos.xy;
  gl_Position = vec4(aPos.xy, 0.0, 1.0);
}
`;

export const WASH_FS = `${FS_PRECISION}
uniform vec2 uCenter;
uniform vec3 uColor;
uniform float uRadius;
uniform float uAspect;
varying vec2 vP;
void main() {
  vec2 d = (vP - uCenter) * vec2(uAspect, 1.0);
  float f = exp(-dot(d, d) / (uRadius * uRadius));
  gl_FragColor = vec4(uColor * f, 1.0);
}
`;

export const DUST_VS = `
attribute vec3 aPos;
uniform mat4 uViewProj;
uniform float uTime;
uniform float uPx;
varying float vA;
void main() {
  vec3 p = aPos;
  float life = fract(p.y + uTime * 0.03);
  vec3 w = vec3(
    fract(p.x + uTime * 0.012) * 34.0 - 17.0,
    0.2 + life * 4.2 + sin(uTime * 0.7 + p.z * 40.0) * 0.15,
    p.z * 90.0 - 70.0);
  vA = sin(life * 3.14159);
  gl_Position = uViewProj * vec4(w, 1.0);
  gl_PointSize = uPx * (0.5 + fract(p.x * 19.0)) / gl_Position.w;
}
`;

export const DUST_FS = `${FS_PRECISION}
uniform vec4 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float f = 1.0 - smoothstep(0.1, 0.5, length(q));
  gl_FragColor = vec4(uColor.rgb, uColor.a * f * vA);
}
`;

/** Effects: premultiplied, so a particle with alpha 0 adds light and one with alpha 1 covers. */
export const FX_VS = `
attribute vec3 aPos;
attribute vec4 aColor;
attribute vec2 aUv;
uniform mat4 uViewProj;
varying vec4 vC;
varying vec2 vUv;
void main() {
  vC = aColor;
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const FX_FS = `${FS_PRECISION}
uniform sampler2D uTex;
varying vec4 vC;
varying vec2 vUv;
void main() {
  float a = texture2D(uTex, vUv).a;
  gl_FragColor = vec4(vC.rgb * a, vC.a * a);
}
`;

export const FACE_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uCam;
uniform float uFogD;
uniform float uFogMax;
varying vec2 vUv;
varying float vFog;
void main() {
  vec4 W = uModel * vec4(aPos, 1.0);
  vUv = aUv;
  vFog = min(1.0 - exp(-length(uCam - W.xyz) * uFogD), uFogMax);
  gl_Position = uViewProj * W;
}
`;

/**
 * Flat vector face. The atlas stores key colours, premultiplied, so edges stay clean: red is
 * skin, green is white, blue is tongue and whatever's left of the coverage is ink. No shading,
 * just the look's light colour, which keeps it graphic while sitting in the scene's light.
 */
export const FACE_FS = `${FS_PRECISION}
uniform sampler2D uAtlas;
uniform vec2 uCell;
uniform vec2 uPlate;
uniform vec2 uEye;
uniform vec2 uMouth;
uniform vec3 uSkin;
uniform vec3 uTongue;
uniform vec3 uInk;
uniform vec3 uLight;
uniform vec3 uFog;
uniform float uGray;
varying vec2 vUv;
varying float vFog;
vec4 layer(vec2 at) {
  vec4 t = texture2D(uAtlas, at + clamp(vUv, 0.012, 0.988) * uCell);
  vec3 c = t.r * uSkin + t.g * vec3(1.0, 0.99, 0.95) + t.b * uTongue + max(t.a - t.r - t.g - t.b, 0.0) * uInk;
  return vec4(c, t.a);
}
void main() {
  vec4 out0 = layer(uPlate);
  vec4 m = layer(uMouth);
  out0 = m + out0 * (1.0 - m.a);
  vec4 e = layer(uEye);
  out0 = e + out0 * (1.0 - e.a);
  vec3 c = out0.rgb * uLight;
  c = mix(c, uFog * out0.a, vFog);
  if (uGray > 0.5) c = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
  gl_FragColor = vec4(c, out0.a);
}
`;
