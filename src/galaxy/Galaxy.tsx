import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { GraphData, GraphNode } from './types';
import { FAMILIES, GALAXY_CENTERS, familyCenter, familyOf, layoutStars, pluginCenter, type PlacedStar } from './layout';

interface Props {
  data: GraphData;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
  /** 0 = 全部点亮；N = 只点亮影响力 ≥ N 的星 */
  focusThreshold: number;
  spinning: boolean;
  viewRequest: ViewRequest | null;
  focusRequest: { id: string; key: number } | null;
  /** 只亮某一个家族；null = 全部显示 */
  familyFocus: string | null;
  onFamilyClick: (id: string) => void;
}

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aGlow;
  attribute float aSeed;
  uniform float uTime;
  varying vec3 vColor;
  varying float vGlow;
  varying float vTw;
  void main() {
    vColor = aColor;
    vGlow = aGlow;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 点本身放大 3.4 倍：多出来的空间全用来画「这颗星自己颜色的光晕」。
    // 像近视眼看灯——灯芯很小，外面一大片光。
    gl_PointSize = clamp(aSize * 2.0 * (1150.0 / max(1.0, -mv.z)), 2.0, 44.0);
    // per-star phase: this is what makes the whole field feel alive
    vTw = 0.72 + 0.28 * sin(uTime * 0.6 + aSeed * 6.2831853);
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vGlow;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));

    // 核心：很小、很锐，占整个点的一小部分
    float core = smoothstep(0.13, 0.0, d);

    // 光晕：从核心向外柔和衰减，铺满整个点，用的是这颗星自己的颜色。
    // 这就是「星星本身在发光」——光晕是它的颜色，不是白色。
    float glow = clamp(vGlow, 0.0, 1.0);
    float halo = exp(-d * d * 9.0) * (0.05 + glow * 0.22);
    // 到点的边缘必须归零，否则会被方形画布切出方框
    halo *= smoothstep(0.5, 0.34, d);

    float a = core + halo;
    if (a < 0.012) discard;

    // 颜色：核心更白，光晕保持本色，叠起来就是「近视看灯」那圈彩色的光
    // 乘数压在 1 附近：超过 1 就会削顶成白，那正是「廉价」的来源
    // 星点亮度压到 0.7-1.15：中心已经很密，再亮就叠成一团白
    vec3 col = mix(vColor, vec3(1.0), core * 0.18) * (0.7 + glow * 0.45);

    gl_FragColor = vec4(col, a * vTw);
  }
`;


/** 圆形点贴图：没有它，PointsMaterial 会把每个点画成正方形像素块 */
function makeDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const DOT_TEX = makeDotTexture();


/**
 * 雾层（星云）。
 *
 * 抄的是诗云的做法：不是贴图，是几万个高斯衰减的粒子叠在一起，
 * 边缘互相融成连续的雾。单看每个粒子都是一个极淡的软圆，
 * 叠起来就是有颜色的星云——宇宙的背景从来不是纯黑。
 */
function hazeLayer(total: number): THREE.Points {
  // 三层结构，照抄诗云的 Galaxy.tsx：
  //   DUST  雾团  —— 填满旋臂之间的空
  //   STARS 装饰星 —— 稀疏、暗，不抢主角
  //   BULGE 核心云 —— 中心那一大团，密度决定它是「亮」而不是「几个白点」
  const DUST = Math.round(total * 0.68);
  const STARS = Math.round(total * 0.05);
  const BULGE = Math.round(total * 0.27);
  const R = 1650;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const scl = new Float32Array(total);
  const c = new THREE.Color();
  const cCore = new THREE.Color('#fff0d2'); // 核心偏暖白
  const cInner = new THREE.Color('#ffd9a8');
  const cMid = new THREE.Color('#9fb6e8');
  const cArm = new THREE.Color('#5f86d6'); // 外圈冷蓝

  // 指数盘半径：中心密、边缘稀，没有带状分层
  const expR = (h: number, cap: number) => Math.min(cap, -h * Math.log(1 - Math.random() * 0.9999));

  // 便宜的二维值噪声，让密度有团块、有空洞，而不是均匀撒点
  const hash2 = (x: number, y: number) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };
  const vnoise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const cc = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v;
  };

  for (let i = 0; i < total; i += 1) {
    const isBulge = i >= DUST + STARS;
    const isStar = !isBulge && i >= DUST;
    let x = 0;
    let y = 0;
    let z = 0;
    let t = 0;
    let armProx = 0;
    let bright = 0;

    if (isBulge) {
      // 核心：宽而软的指数云 + 抖动，读起来是「糊成一团的光」，不是一颗颗白点
      const rr = expR(R * 0.11, R * 0.46);
      t = rr / R;
      const phi = Math.random() * Math.PI * 2;
      const ct = 2 * Math.random() - 1;
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      x = rr * st * Math.cos(phi) + R * 0.05 * (Math.random() - 0.5);
      z = rr * st * Math.sin(phi) + R * 0.05 * (Math.random() - 0.5);
      y = rr * ct * 0.62 + R * 0.03 * (Math.random() - 0.5);
      armProx = 0.2;
      const nz = vnoise(x * 0.004 * 1.6, z * 0.004 * 1.6);
      bright = (0.62 - t * 0.5) * (0.5 + Math.random() * 0.45) * (0.65 + nz * 0.7);
    } else {
      // 盘：指数半径 + 四条旋臂 + 中心角度打散
      const rr = expR(R * 0.3, R) + R * 0.015;
      t = rr / R;
      const branch = (Math.floor(Math.random() * 4) / 4) * Math.PI * 2;
      const twist = t * 5.2;
      const armDev = (Math.random() + Math.random() + Math.random() - 1.5) * 0.42;
      armProx = Math.exp(-((armDev / 0.42) ** 2) * 2.2);
      const cb = Math.max(0, 0.45 - t) / 0.45;
      const ang = branch + twist + armDev + (Math.random() - 0.5) * Math.PI * 2 * cb * cb;
      const scatter = (v: number) => Math.pow(Math.random(), 2.6) * (Math.random() < 0.5 ? -1 : 1) * v * rr;
      const coreFill = cb * cb * R * 0.07;
      x = Math.cos(ang) * rr + scatter(0.16) + (Math.random() - 0.5) * 2 * coreFill;
      z = Math.sin(ang) * rr + scatter(0.16) + (Math.random() - 0.5) * 2 * coreFill;
      y = (Math.random() + Math.random() + Math.random() - 1.5) * rr * 0.11 * (isStar ? 0.8 : 1.1);
      const nz = vnoise(x * 0.004, z * 0.004);
      const armBoost = isStar ? 0.42 + armProx * 1.0 : 0.34 + armProx * 0.75;
      bright = (armBoost + cb * 0.4) * (0.45 + cb * 0.25 + nz * 0.8) * (0.8 + Math.random() * 0.4);
    }

    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;

    // 颜色随半径渐变：暖核心 → 中间 → 冷蓝旋臂
    if (t < 0.12) c.copy(cCore).lerp(cInner, t / 0.12);
    else if (t < 0.4) c.copy(cInner).lerp(cMid, (t - 0.12) / 0.28);
    else c.copy(cMid).lerp(cArm, Math.min(1, (t - 0.4) / 0.5));
    if (!isBulge) c.lerp(cArm, armProx * 0.45);

    col[i * 3] = c.r * bright;
    col[i * 3 + 1] = c.g * bright;
    col[i * 3 + 2] = c.b * bright;

    // 核心粒子更大更软 → 叠成连续的光雾；星尘更小
    scl[i] = isBulge
      ? (1.5 + (0.3 - t) * 2.6) * (0.7 + Math.random() * 0.7)
      : isStar
        ? (0.7 + armProx * 0.8) * (0.7 + Math.random() * 0.6)
        : (0.5 + (1 - t) * 0.8) * (0.7 + Math.random() * 0.5);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scl, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aScale;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vec4 vp = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * vp;
        float dist = max(1.0, -vp.z);
        gl_PointSize = clamp(2.6 * aScale * (1500.0 / dist), 0.8, 64.0);
        vFade = smoothstep(260.0, 1100.0, dist);
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float a = exp(-d * d * 4.5) * vFade;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * a, a);
      }`,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

function starfield(count: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    // 球壳上撒点，离得足够远就不会跟着转
    const r = 6000 + Math.pow(Math.random(), 0.55) * 4200;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.55;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const t = 0.55 + Math.random() * 0.45;
    col[i * 3] = t * (0.85 + Math.random() * 0.15);
    col[i * 3 + 1] = t * (0.9 + Math.random() * 0.1);
    col[i * 3 + 2] = t;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, vertexColors: true, map: DOT_TEX, alphaTest: 0.01, transparent: true, opacity: 0.62, depthWrite: false }),
  );
}

/**
 * 巨星贴图：一团大的柔和光晕 + 六道星芒。
 *
 * 为什么需要它：真实天文照片里，撑住整个画面的永远只有几颗巨星——
 * 其余全是几乎看不见的星尘。如果所有星都是同样的小点，
 * 画面就是噪点，不是星空。所以最有分量的那十几颗单独用贴图画。
 */
function makeStarTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const c = size / 2;

  // 五层渐变，模拟真实镜头的点扩散函数：核心极锐，外围缓慢衰减
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.03, 'rgba(235, 245, 255, 0.82)');
  g.addColorStop(0.08, 'rgba(190, 220, 255, 0.3)');
  g.addColorStop(0.2, 'rgba(140, 190, 255, 0.09)');
  g.addColorStop(0.45, 'rgba(110, 160, 255, 0.022)');
  g.addColorStop(1, 'rgba(90, 140, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // 四道细星芒：细、长、越往外越淡
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i += 1) {
    const a = (i * Math.PI) / 2;
    const dx = Math.cos(a) * c * 0.96;
    const dy = Math.sin(a) * c * 0.96;
    const grad = ctx.createLinearGradient(c - dx, c - dy, c + dx, c + dy);
    grad.addColorStop(0, 'rgba(200, 225, 255, 0)');
    grad.addColorStop(0.5, 'rgba(230, 242, 255, 0.42)');
    grad.addColorStop(1, 'rgba(200, 225, 255, 0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(c - dx, c - dy);
    ctx.lineTo(c + dx, c + dy);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 星云贴图：一团由二十多个随机光斑叠出来的云气。
 * 银河照片的主体从来不是星点，是这层雾——没有它，画面就是散点图。
 */
function makeNebulaTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i += 1) {
    const x = size * (0.15 + Math.random() * 0.7);
    const y = size * (0.15 + Math.random() * 0.7);
    const r = 18 + Math.random() * 72;
    const a = 0.03 + Math.random() * 0.07;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(150, 195, 255, ' + a + ')');
    g.addColorStop(0.55, 'rgba(110, 160, 245, ' + (a * 0.45) + ')');
    g.addColorStop(1, 'rgba(80, 130, 220, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // 用径向遮罩把边缘彻底擦掉，否则贴图会露出方形边界
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.5);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.6, 'rgba(0,0,0,0.55)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 沿星系盘面撒十几团云气，形成银河那样的光带质感 */
function nebulaClouds(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 26; i += 1) {
    const tex = makeNebulaTexture();
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.3,
    });
    const sprite = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const r = 120 + Math.pow(Math.random(), 0.6) * 640;
    const scale = 220 + Math.random() * 420;
    sprite.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 90, Math.sin(a) * r);
    sprite.scale.set(scale, scale * (0.5 + Math.random() * 0.4), 1);
    group.add(sprite);
  }
  return group;
}

/**
 * 中心的黑洞。
 *
 * 三层结构，缺一层就不像黑洞：
 *   ① 事件视界 —— 一个纯黑的球，它挡住背后的星，形成剪影
 *   ② 光子环  —— 贴着视界的一圈白热粒子，被引力弯折的光
 *   ③ 吸积盘  —— 扁平的粒子盘，内圈白热、外圈暗橙，绕中心转
 */
function blackHole() {
  const group = new THREE.Group();

  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(38, 56, 56),
    // 双面：从视界内部看它也得是黑的，否则背景星会从里面透出来\n    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
  );
  group.add(horizon);

  const ringCount = 1100;
  const ringGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(ringCount * 3);
  const rc = new Float32Array(ringCount * 3);
  for (let i = 0; i < ringCount; i += 1) {
    const a = (i / ringCount) * Math.PI * 2 + Math.random() * 0.06;
    const r = 42 + Math.random() * 4.5;
    rp[i * 3] = Math.cos(a) * r;
    rp[i * 3 + 1] = (Math.random() - 0.5) * 2.6;
    rp[i * 3 + 2] = Math.sin(a) * r;
    const k = 0.86 + Math.random() * 0.14;
    rc[i * 3] = k;
    rc[i * 3 + 1] = 0.94 * k;
    rc[i * 3 + 2] = 0.86 * k;
  }
  ringGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  ringGeo.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  group.add(
    new THREE.Points(
      ringGeo,
      new THREE.PointsMaterial({
        size: 1.8,
        sizeAttenuation: true,
        map: DOT_TEX,
        alphaTest: 0.01,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );

  const diskCount = 3000;
  const diskGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(diskCount * 3);
  const dc = new Float32Array(diskCount * 3);
  const color = new THREE.Color();
  for (let i = 0; i < diskCount; i += 1) {
    const r = 54 + Math.pow(Math.random(), 0.62) * 150;
    const a = Math.random() * Math.PI * 2;
    dp[i * 3] = Math.cos(a) * r;
    dp[i * 3 + 1] = (Math.random() - 0.5) * (3 + r * 0.07);
    dp[i * 3 + 2] = Math.sin(a) * r;
    const heat = 1 - (r - 34) / 120;
    color.setHSL(0.09 - heat * 0.055, 0.92, 0.3 + heat * 0.5);
    dc[i * 3] = color.r;
    dc[i * 3 + 1] = color.g;
    dc[i * 3 + 2] = color.b;
  }
  diskGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  diskGeo.setAttribute('color', new THREE.BufferAttribute(dc, 3));
  const disk = new THREE.Points(
    diskGeo,
    new THREE.PointsMaterial({
      size: 3.4,
      sizeAttenuation: true,
      map: DOT_TEX,
      alphaTest: 0.01,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(disk);

  return { group, disk };
}

/** 每座星系中心的核球：一小团密集的暖色粒子，让两个盘一眼能分辨 */
function coreBulge(
  count: number,
  center: { x: number; y: number; z: number },
  tilt: number,
  tint?: string,
): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tintColor = tint ? new THREE.Color(tint) : null;
  for (let i = 0; i < count; i += 1) {
    const r = Math.pow(Math.random(), 2.1) * 105;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = center.x + Math.cos(a) * r;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 26 + Math.cos(a) * r * tilt;
    pos[i * 3 + 2] = center.z + Math.sin(a) * r;
    if (tintColor) {
      // 插件星团用冷色，跟两座暖色星系的核球区分开
      const k = 0.42 + Math.random() * 0.58;
      col[i * 3] = tintColor.r * k;
      col[i * 3 + 1] = tintColor.g * k;
      col[i * 3 + 2] = tintColor.b * k;
    } else {
      const warm = 0.72 + Math.random() * 0.28;
      col[i * 3] = warm;
      col[i * 3 + 1] = warm * (0.82 + Math.random() * 0.12);
      col[i * 3 + 2] = warm * (0.58 + Math.random() * 0.2);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 2.1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

/** 两座星系之间的星尘桥（纯装饰，让两个盘看起来有引力联系） */
function bridgeDust(count: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const from = GALAXY_CENTERS.core;
  const to = pluginCenter();
  for (let i = 0; i < count; i += 1) {
    const t = Math.random();
    const curve = Math.sin(t * Math.PI) * 90;
    pos[i * 3] = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * 46;
    pos[i * 3 + 1] = curve * (Math.random() - 0.5) * 1.4;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 150 * (1 - Math.abs(t - 0.5) * 1.4);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 1.15, color: new THREE.Color('#4b6ea8'), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

export interface ViewRequest {
  /** 相机看向哪里 */
  target: [number, number, number];
  /** 相机放在哪里 */
  cam: [number, number, number];
  /** 每次点按钮都要变，否则同一个目标不会二次触发 */
  key: number;
}

export default function Galaxy({ data, selectedId, onSelect, focusThreshold, spinning, viewRequest, focusRequest, familyFocus, onFamilyClick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const neighbourRef = useRef<Map<string, Set<string>>>(new Map());
  const hoverRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const applyRef = useRef<(id: string | null) => void>(() => {});
  const familyByIdRef = useRef<Map<string, string | null>>(new Map());
  const giantsRef = useRef<THREE.Sprite[]>([]);
  const nameLabelsRef = useRef<CSS2DObject[]>([]);
  const familyFocusRef = useRef<string | null>(null);
  const onFamilyClickRef = useRef<(id: string) => void>(() => {});
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    composer: EffectComposer;
    stars: THREE.Points;
    lines: THREE.LineSegments;
    placed: PlacedStar[];
    starGeo: THREE.BufferGeometry;
    highlightGeo: THREE.BufferGeometry;
    selHalo: THREE.Sprite;
  } | null>(null);

  // —— 初始化和销毁 ——
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02030a, 0.00012);

    const camera = new THREE.PerspectiveCamera(48, mount.clientWidth / mount.clientHeight, 1, 12000);
    camera.position.set(-180, 780, 2900);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x02030a, 1);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 1.35;
    controls.panSpeed = 1.35;
    // 平移跟着屏幕方向走，才符合"拖动画面"的直觉
    controls.screenSpacePanning = true;
    // 放大朝鼠标所指的方向推进，而不是朝屏幕中心——这是「钻进去看」的关键手感
    controls.zoomToCursor = true;
    controls.minDistance = 70;
    controls.maxDistance = 9000;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.22;
    controls.target.set(0, 0, 0);

    // 背景星空跟随相机：这样无论转到哪个方向，外面永远是星星，不会「转出宇宙」
    // 星云雾层：宇宙的背景是有颜色的
    scene.add(hazeLayer(160000));
    const sky = starfield(26000);
    scene.add(sky);

    // 中心黑洞：整张图上唯一不发光的东西
    const hole = blackHole();
    scene.add(hole.group);
    scene.add(coreBulge(320, pluginCenter(), 0, '#7fe6ff'));
    // 每个模型家族一颗小核球，让 11 颗卫星星团一眼能分辨
    FAMILIES.forEach((_, idx) => {
      const c = familyCenter(idx);
      scene.add(coreBulge(110, c, 0, '#8fd8ff'));
    });
    scene.add(bridgeDust(180));

    // 占位几何，数据到了再填
    const starGeo = new THREE.BufferGeometry();
    const starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    const lineGeo = new THREE.BufferGeometry();
    const lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x2f4a7a, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    scene.add(lines);

    // 高亮线：选中一颗星时，把它连出去的线单独用亮色画一遍
    const highlightGeo = new THREE.BufferGeometry();
    const highlightLines = new THREE.LineSegments(
      highlightGeo,
      new THREE.LineBasicMaterial({
        color: 0xfff2cc,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false,
        linewidth: 2,
        blending: THREE.AdditiveBlending,
      }),
    );
    scene.add(highlightLines);

    // 选中光晕：被点开的那颗星额外亮一圈，像恒星被聚焦
    const selHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeStarTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.9,
      }),
    );
    selHalo.visible = false;
    scene.add(selHalo);

    // 地标层：家族名字、中心、插件星团。用 HTML 渲染，比在 3D 里画字清楚得多
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(mount.clientWidth, mount.clientHeight);
    Object.assign(labelRenderer.domElement.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      pointerEvents: 'none',
    });
    mount.appendChild(labelRenderer.domElement);

    const labels: CSS2DObject[] = [];

    // 镜头平滑飞到某处（初始化阶段的局部版本，标签点击会用到）
    const flyTo = (camPos: THREE.Vector3, targetPos: THREE.Vector3) => {
      const startCam = camera.position.clone();
      const startTarget = controls.target.clone();
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 900);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(startCam, camPos, e);
        controls.target.lerpVectors(startTarget, targetPos, e);
        controls.update();
        if (k < 1) requestAnimationFrame(step);
      };
      step();
    };

    const addLabel = (text: string, x: number, y: number, z: number, cls: string, onClick?: () => void) => {
      const el = document.createElement('div');
      el.className = 'galaxy-label ' + cls;
      el.textContent = text;
      if (onClick) {
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onClick();
        });
      }
      const obj = new CSS2DObject(el);
      obj.position.set(x, y, z);
      scene.add(obj);
      labels.push(obj);
    };
    addLabel('Transformer · 2017', 0, 150, 0, 'label-core');
    { const pc = pluginCenter(); addLabel('DSH 插件星团', pc.x, pc.y + 250, pc.z, 'label-plugin'); }
    FAMILIES.forEach((f, idx) => {
      const c = familyCenter(idx);
      addLabel(f.label, c.x, c.y + 215, c.z, 'label-family', () => {
        flyTo(
          new THREE.Vector3(c.x + 210, c.y + 270, c.z + 400),
          new THREE.Vector3(c.x, c.y, c.z),
        );
        onFamilyClickRef.current(f.id);
      });
    });

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // 泛光：光从亮部溢出到周围。阈值压低让更多亮部参与，
    // 半径拉大让光晕铺得更远，强度取中间值——这一步才是「恒星在发光」。
    const bloom = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.95, 0.82, 0.42);
    composer.addPass(bloom);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      labelRenderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let raf = 0;
    const clock = new THREE.Clock();
    let frameTick = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      // 让点大小随呼吸微微变化，静态图也有生气
      starMat.uniforms.uTime.value = t;
      // 吸积盘慢慢转：静止的黑洞看着只是个洞
      hole.disk.rotation.y += 0.0016;
      sky.position.copy(camera.position);

      // 星名标签：1/12 帧更新一次就够，避免每帧操作 DOM
      if (frameTick++ % 12 === 0 && nameLabelsRef.current.length) {
        const dist = camera.position.distanceTo(controls.target);
        const show = Math.max(0, Math.min(1, (1500 - dist) / 700));
        for (const lb of nameLabelsRef.current) {
          const el = lb.element as HTMLDivElement;
          el.style.opacity = String(show * 0.85);
        }
      }
      controls.update();
      composer.render();
      labelRenderer.render(scene, camera);
    };
    animate();

    stateRef.current = { renderer, scene, camera, controls, composer, stars, lines, placed: [], starGeo, highlightGeo, selHalo };

    // —— 点击拾取 ——
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 6 };
    const pointer = new THREE.Vector2();
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      // 缩得越近，拾取半径越小：远处一大片星只要点到大概位置，近处才要求点准
      const dist = camera.position.distanceTo(controls.target);
      raycaster.params.Points = { threshold: Math.max(1.2, Math.min(10, dist * 0.007)) };
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(stateRef.current?.stars ?? stars, false);
      if (hits.length > 0) {
        const idx = hits[0].index ?? -1;
        const placed = stateRef.current?.placed[idx];
        onSelect(placed ? placed.node : null);
      } else {
        onSelect(null);
      }
    };
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.style.cursor = 'grab';

    // —— 悬停：点亮它和它的邻居，并弹一个标签 ——
    const tip = document.createElement('div');
    tip.className = 'star-tip';
    tip.style.display = 'none';
    mount.appendChild(tip);

    const onMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const dist = camera.position.distanceTo(controls.target);
      raycaster.params.Points = { threshold: Math.max(1.2, Math.min(10, dist * 0.007)) };
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(stateRef.current?.stars ?? stars, false);
      const idx = hits.length ? (hits[0].index ?? -1) : -1;
      const placed = stateRef.current?.placed ?? [];
      const node = idx >= 0 ? placed[idx]?.node : undefined;

      if (node) {
        if (hoverRef.current !== node.id) {
          hoverRef.current = node.id;
          applyRef.current(node.id);
        }
        tip.style.display = 'block';
        tip.style.left = `${event.clientX - rect.left + 18}px`;
        tip.style.top = `${event.clientY - rect.top + 16}px`;
        tip.textContent = `${node.name}（${node.year}）`;
        renderer.domElement.style.cursor = 'pointer';
      } else if (hoverRef.current !== null) {
        hoverRef.current = null;
        applyRef.current(selectedIdRef.current);
        tip.style.display = 'none';
        renderer.domElement.style.cursor = 'grab';
      }
    };
    renderer.domElement.addEventListener('mousemove', onMouseMove);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      tip.remove();
      labels.forEach((l) => { l.element.remove(); scene.remove(l); });
      labelRenderer.domElement.remove();
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      starGeo.dispose();
      lineGeo.dispose();
      mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [onSelect]);

  // —— 数据变化时重建粒子和连线 ——
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    const placed = layoutStars(data.nodes);

    const n = placed.length;
    const positions = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const glows = new Float32Array(n);

    const indexOf = new Map<string, number>();
    placed.forEach((p, i) => {
      indexOf.set(p.node.id, i);
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      sizes[i] = p.size;
      colors[i * 3] = p.rgb[0];
      colors[i * 3 + 1] = p.rgb[1];
      colors[i * 3 + 2] = p.rgb[2];
      glows[i] = Math.max(0, (p.node.weight - 60) / 40);
    });

    st.starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    st.starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    st.starGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    st.starGeo.setAttribute('aGlow', new THREE.BufferAttribute(glows, 1));
    // 每颗星一个固定的随机相位，用于各自的呼吸节奏
    const seeds = new Float32Array(n);
    for (let i = 0; i < n; i += 1) seeds[i] = Math.random();
    st.starGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    st.starGeo.computeBoundingSphere();

    // 连线
    const seg: number[] = [];
    for (const link of data.links) {
      const a = indexOf.get(link.source);
      const b = indexOf.get(link.target);
      if (a === undefined || b === undefined) continue;
      const cross = placed[a].side !== placed[b].side;
      if (cross && link.strength < 5) continue;
      seg.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
      seg.push(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    st.lines.geometry.dispose();
    st.lines.geometry = lineGeo;

    // 邻接表：悬停时用来点亮「与它相连的那些星」
    const nb = new Map<string, Set<string>>();
    for (const link of data.links) {
      if (!nb.has(link.source)) nb.set(link.source, new Set());
      if (!nb.has(link.target)) nb.set(link.target, new Set());
      nb.get(link.source)!.add(link.target);
      nb.get(link.target)!.add(link.source);
    }
    neighbourRef.current = nb;

    // 每颗星属于哪个家族：标签点击后用来「只亮这一家」
    const famMap = new Map<string, string | null>();
    for (const p of placed) famMap.set(p.node.id, familyOf(p.node as never));
    familyByIdRef.current = famMap;

    st.placed = placed;

    // ── 巨星层：只有最有分量的十几颗星用贴图画，撑住整个画面 ──
    // 其余全是细碎星尘。没有这个对比，画面就只是噪点。
    for (const old of giantsRef.current) {
      st.scene.remove(old);
      old.material.map?.dispose();
      old.material.dispose();
    }
    const giantTex = makeStarTexture();
    const giants: THREE.Sprite[] = [];
    for (const p of placed) {
      // 只有骨架层（图灵、Transformer、ChatGPT 这些）才配得上手动画的大光斑。
      // 插件的 weight 只是下载量，一个普通插件变成带星芒的巨星，就是假象。
      if (p.node.layer !== 'skeleton' || p.node.weight < 98) continue;
      const mat = new THREE.SpriteMaterial({
        map: giantTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.75,
      });
      const sprite = new THREE.Sprite(mat);
      const scale = 10 + Math.pow(p.node.weight / 100, 14) * 46;
      sprite.scale.set(scale, scale, 1);
      sprite.position.set(p.x, p.y, p.z);
      st.scene.add(sprite);
      giants.push(sprite);
    }
    giantsRef.current = giants;

    // ── 星名标签：只在镜头靠近时浮出来 ──
    // 远处全显就成了密密麻麻的字，近处不显又不知道自己在看什么。
    for (const old of nameLabelsRef.current) {
      old.element.remove();
      st.scene.remove(old);
    }
    const nameLabels: CSS2DObject[] = [];
    for (const p of placed) {
      // 只给骨架层里最顶尖的那十几颗挂标签。
      // 之前按 weight >= 84 全挂，论文层一下进来五百多个 DOM，既糊屏又卡死。
      if (p.node.layer !== 'skeleton' || p.node.weight < 95) continue;
      if (nameLabels.length >= 20) break;
      const el = document.createElement('div');
      el.className = 'star-label';
      const short = p.node.name.length > 22 ? p.node.name.slice(0, 22) + '…' : p.node.name;
      el.textContent = short;
      el.style.opacity = '0';
      const obj = new CSS2DObject(el);
      obj.position.set(p.x, p.y + p.size * 3 + 12, p.z);
      st.scene.add(obj);
      nameLabels.push(obj);
    }
    nameLabelsRef.current = nameLabels;

    // 相机跟着数据规模走，第一次加载时把两个星系都框进来
    st.camera.position.set(-180, 780, 2900);
    st.controls.target.set(0, 0, 0);
    st.controls.update();
  }, [data]);

  // —— 飞到某个视角（平滑过渡，不瞬移） ——
  const animateCamRef = useRef<number | null>(null);
  const animateCam = useCallback((endCam: THREE.Vector3, endTarget: THREE.Vector3, dur = 950) => {
    const st = stateRef.current;
    if (!st) return;
    if (animateCamRef.current) cancelAnimationFrame(animateCamRef.current);
    const startCam = st.camera.position.clone();
    const startTarget = st.controls.target.clone();
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      st.camera.position.lerpVectors(startCam, endCam, e);
      st.controls.target.lerpVectors(startTarget, endTarget, e);
      st.controls.update();
      if (k < 1) animateCamRef.current = requestAnimationFrame(step);
    };
    step();
  }, []);

  useEffect(() => {
    if (!viewRequest) return;
    animateCam(
      new THREE.Vector3(...viewRequest.cam),
      new THREE.Vector3(...viewRequest.target),
    );
  }, [viewRequest, animateCam]);

  // —— 点搜索结果时，镜头贴到那颗星跟前 ——
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !focusRequest) return;
    const target = st.placed.find((p) => p.node.id === focusRequest.id);
    if (!target) return;
    const t = new THREE.Vector3(target.x, target.y, target.z);
    const cam = new THREE.Vector3(target.x + 78, target.y + 108, target.z + 285);
    animateCam(cam, t, 780);
  }, [focusRequest, animateCam]);

  // —— 自转开关 ——
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    st.controls.autoRotate = spinning;
  }, [spinning]);

  // —— 强调某颗星：它和它的邻居亮起来，其余压暗 ——
  const applyEmphasis = useCallback(
    (activeId: string | null) => {
      const st = stateRef.current;
      if (!st || !st.placed.length) return;
      const geo = st.starGeo;
      const glowAttr = geo.getAttribute('aGlow') as THREE.BufferAttribute | undefined;
      const sizeAttr = geo.getAttribute('aSize') as THREE.BufferAttribute | undefined;
      if (!glowAttr || !sizeAttr) return;

      const neighbours = activeId ? neighbourRef.current.get(activeId) : undefined;
      const famFocus = familyFocusRef.current;
      const placed = st.placed;
      for (let i = 0; i < placed.length; i += 1) {
        const p = placed[i];
        const lit = focusThreshold <= 0 || p.node.weight >= focusThreshold;
        let glow = Math.max(0, (p.node.weight - 60) / 40) * (lit ? 1 : 0.3);
        let size = p.size * (lit ? 1 : 0.72);

        // 选中了某个家族：只亮它那一团，其余压到几乎看不见
        if (famFocus) {
          const inFamily = familyByIdRef.current.get(p.node.id) === famFocus;
          if (!inFamily) {
            glow *= 0.05;
            size *= 0.45;
          } else {
            glow = Math.max(glow, 0.75);
            size *= 1.45;
          }
        }

        if (activeId) {
          if (p.node.id === activeId) {
            glow = 1.8;
            size *= 2.1;
          } else if (neighbours?.has(p.node.id)) {
            glow = Math.max(glow, 0.85);
            size *= 1.35;
          } else {
            glow *= 0.12;
            size *= 0.72;
          }
        }
        glowAttr.setX(i, glow);
        sizeAttr.setX(i, size);
      }
      glowAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;

      // 把选中/悬停这颗星的关系线单独用暖色描一遍，像光束从它身上散出去
      if (activeId) {
        const idxOf = new Map<string, number>();
        placed.forEach((p, k) => idxOf.set(p.node.id, k));
        const seg: number[] = [];
        const ai = idxOf.get(activeId);
        if (ai !== undefined) {
          for (const nb of neighbours ?? []) {
            const bi = idxOf.get(nb);
            if (bi === undefined) continue;
            seg.push(placed[ai].x, placed[ai].y, placed[ai].z);
            seg.push(placed[bi].x, placed[bi].y, placed[bi].z);
          }
        }
        st.highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
        st.highlightGeo.computeBoundingSphere();
      } else {
        st.highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      }
    },
    [focusThreshold],
  );

  // —— 选中的星亮一圈光晕 ——
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    if (!selectedId) {
      st.selHalo.visible = false;
      return;
    }
    const p = st.placed.find((x) => x.node.id === selectedId);
    if (!p) {
      st.selHalo.visible = false;
      return;
    }
    const size = 18 + Math.pow(Math.max(0, p.node.weight) / 100, 2) * 46;
    st.selHalo.position.set(p.x, p.y, p.z);
    st.selHalo.scale.set(size, size, 1);
    st.selHalo.visible = true;
  }, [selectedId, data]);

  // —— 选中或悬停变化时重新强调 ——
  useEffect(() => {
    applyEmphasis(selectedId ?? hoverRef.current);
  }, [selectedId, focusThreshold, data, applyEmphasis]);

  // 初始化用的那个 effect 只挂一次，靠这两个 ref 拿到最新的回调与选中态
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    applyRef.current = applyEmphasis;
  }, [applyEmphasis]);
  useEffect(() => {
    familyFocusRef.current = familyFocus;
    applyEmphasis(selectedId ?? hoverRef.current);
  }, [familyFocus, applyEmphasis, selectedId]);
  useEffect(() => {
    onFamilyClickRef.current = onFamilyClick;
  }, [onFamilyClick]);

  return <div ref={mountRef} className="galaxy-canvas" />;
}












































