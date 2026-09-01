// Standalone zero-dependency WebGL2 MoltenMetal interactive background
export function initMoltenMetal(canvasId = 'molten-bg-canvas', options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'high-performance' }) ||
             canvas.getContext('webgl', { alpha: true, antialias: false });
  if (!gl) {
    console.warn('WebGL not supported for animated background.');
    return;
  }

  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

  const hexToRgb = (hex) => {
    const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!res) return [1, 1, 1];
    return [parseInt(res[1], 16) / 255, parseInt(res[2], 16) / 255, parseInt(res[3], 16) / 255];
  };

  const config = {
    color1: hexToRgb(options.color1 || '#5227FF'),
    color2: hexToRgb(options.color2 || '#FF9FFC'),
    color3: hexToRgb(options.color3 || '#FFFFFF'),
    speed: options.speed !== undefined ? options.speed : 0.35,
    scale: options.scale !== undefined ? options.scale : 4.0,
    detail: options.detail !== undefined ? options.detail : 3.0,
    glow: options.glow !== undefined ? options.glow : 1.6,
    coreSize: options.coreSize !== undefined ? options.coreSize : 0.1,
    swirl: options.swirl !== undefined ? options.swirl : 1.0,
    fold: options.fold !== undefined ? options.fold : -0.2,
    blackPoint: options.blackPoint !== undefined ? options.blackPoint : 0.05,
    brightness: options.brightness !== undefined ? options.brightness : 1.3,
    grain: options.grain !== false ? 1.0 : 0.0,
    grainIntensity: options.grainIntensity !== undefined ? options.grainIntensity : 0.05,
    mouseInteraction: options.mouseInteraction !== false,
    mouseStrength: options.mouseStrength !== undefined ? options.mouseStrength : 0.3,
    opacity: options.opacity !== undefined ? options.opacity : 0.85
  };

  const vsSource = isWebGL2 ? `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}` : `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

  const fsSource = isWebGL2 ? `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uScale;
uniform float uDetail;
uniform float uGlow;
uniform float uCoreSize;
uniform float uSwirl;
uniform float uFold;
uniform float uBlackPoint;
uniform float uBrightness;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform bool uEnableMouse;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float time = iTime * uSpeed;
  vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;

  vec2 drift = vec2(0.0);
  if (uEnableMouse) {
    drift = (uMouse - 0.5) * uMouseStrength * 2.0;
  }
  p += drift;

  vec2 i = p;
  float c = 0.0;
  float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
  float d = length(p);
  float rot = d + time + p.x * uSwirl;

  float cosRot = cos(rot);
  mat2 warp = mat2(cos(rot - sin(time / 5.0)), sin(rot), -sin(cosRot - time), cosRot) * uFold;
  float glowCore = uGlow * uCoreSize;

  for (float n = 0.0; n < 8.0; n++) {
    if (n >= uDetail) break;
    p *= warp;
    float t = r - time / (n + 3.0);
    i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
    c += glowCore / max(length(vec2(sin(i.x + t), cos(i.y + t))), 0.001);
  }

  c /= 6.0;
  float intensity = max(c - uBlackPoint, 0.0) * uBrightness;
  float g = clamp(intensity, 0.0, 1.0);

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, 0.5, g));
  col = mix(col, uColor3, smoothstep(0.5, 1.0, g));

  float a = g;
  if (uGrain > 0.5) {
    float gr = hash(gl_FragCoord.xy + iTime);
    a += (gr - 0.5) * uGrainIntensity;
  }
  a = clamp(a, 0.0, 1.0) * uOpacity;

  fragColor = vec4(col * a, a);
}` : `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uScale;
uniform float uDetail;
uniform float uGlow;
uniform float uCoreSize;
uniform float uSwirl;
uniform float uFold;
uniform float uBlackPoint;
uniform float uBrightness;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform bool uEnableMouse;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float time = iTime * uSpeed;
  vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;

  vec2 drift = vec2(0.0);
  if (uEnableMouse) {
    drift = (uMouse - 0.5) * uMouseStrength * 2.0;
  }
  p += drift;

  vec2 i = p;
  float c = 0.0;
  float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
  float d = length(p);
  float rot = d + time + p.x * uSwirl;

  float cosRot = cos(rot);
  mat2 warp = mat2(cos(rot - sin(time / 5.0)), sin(rot), -sin(cosRot - time), cosRot) * uFold;
  float glowCore = uGlow * uCoreSize;

  for (float n = 0.0; n < 8.0; n++) {
    if (n >= uDetail) break;
    p *= warp;
    float t = r - time / (n + 3.0);
    i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
    c += glowCore / max(length(vec2(sin(i.x + t), cos(i.y + t))), 0.001);
  }

  c /= 6.0;
  float intensity = max(c - uBlackPoint, 0.0) * uBrightness;
  float g = clamp(intensity, 0.0, 1.0);

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, 0.5, g));
  col = mix(col, uColor3, smoothstep(0.5, 1.0, g));

  float a = g;
  if (uGrain > 0.5) {
    float gr = hash(gl_FragCoord.xy + iTime);
    a += (gr - 0.5) * uGrainIntensity;
  }
  a = clamp(a, 0.0, 1.0) * uOpacity;

  gl_FragColor = vec4(col * a, a);
}`;

  function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = createShader(gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Program link error:', gl.getProgramInfoLog(program));
    return;
  }

  gl.useProgram(program);

  // Fullscreen quad
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1
  ]), gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Uniform locations
  const uRes = gl.getUniformLocation(program, 'iResolution');
  const uTime = gl.getUniformLocation(program, 'iTime');
  const uSpeed = gl.getUniformLocation(program, 'uSpeed');
  const uScale = gl.getUniformLocation(program, 'uScale');
  const uDetail = gl.getUniformLocation(program, 'uDetail');
  const uGlow = gl.getUniformLocation(program, 'uGlow');
  const uCoreSize = gl.getUniformLocation(program, 'uCoreSize');
  const uSwirl = gl.getUniformLocation(program, 'uSwirl');
  const uFold = gl.getUniformLocation(program, 'uFold');
  const uBlackPoint = gl.getUniformLocation(program, 'uBlackPoint');
  const uBrightness = gl.getUniformLocation(program, 'uBrightness');
  const uGrain = gl.getUniformLocation(program, 'uGrain');
  const uGrainIntensity = gl.getUniformLocation(program, 'uGrainIntensity');
  const uOpacity = gl.getUniformLocation(program, 'uOpacity');
  const uMouse = gl.getUniformLocation(program, 'uMouse');
  const uMouseStrength = gl.getUniformLocation(program, 'uMouseStrength');
  const uEnableMouse = gl.getUniformLocation(program, 'uEnableMouse');
  const uColor1 = gl.getUniformLocation(program, 'uColor1');
  const uColor2 = gl.getUniformLocation(program, 'uColor2');
  const uColor3 = gl.getUniformLocation(program, 'uColor3');

  // Set static uniforms
  gl.uniform1f(uSpeed, config.speed);
  gl.uniform1f(uScale, config.scale);
  gl.uniform1f(uDetail, config.detail);
  gl.uniform1f(uGlow, config.glow);
  gl.uniform1f(uCoreSize, config.coreSize);
  gl.uniform1f(uSwirl, config.swirl);
  gl.uniform1f(uFold, config.fold);
  gl.uniform1f(uBlackPoint, config.blackPoint);
  gl.uniform1f(uBrightness, config.brightness);
  gl.uniform1f(uGrain, config.grain);
  gl.uniform1f(uGrainIntensity, config.grainIntensity);
  gl.uniform1f(uOpacity, config.opacity);
  gl.uniform1f(uMouseStrength, config.mouseStrength);
  gl.uniform1i(uEnableMouse, config.mouseInteraction ? 1 : 0);
  gl.uniform3fv(uColor1, config.color1);
  gl.uniform3fv(uColor2, config.color2);
  gl.uniform3fv(uColor3, config.color3);

  let mouseX = 0.5;
  let mouseY = 0.5;
  let targetMouseX = 0.5;
  let targetMouseY = 0.5;

  const onMouseMove = (e) => {
    targetMouseX = e.clientX / window.innerWidth;
    targetMouseY = 1.0 - (e.clientY / window.innerHeight);
  };

  const onTouchMove = (e) => {
    if (e.touches && e.touches[0]) {
      targetMouseX = e.touches[0].clientX / window.innerWidth;
      targetMouseY = 1.0 - (e.touches[0].clientY / window.innerHeight);
    }
  };

  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };

  window.addEventListener('resize', resize);
  resize();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let startTime = performance.now();
  let animationFrameId;

  function render() {
    const now = performance.now();
    const elapsed = (now - startTime) * 0.001;

    // Smooth mouse interpolation
    mouseX += (targetMouseX - mouseX) * 0.05;
    mouseY += (targetMouseY - mouseY) * 0.05;

    gl.uniform1f(uTime, elapsed);
    gl.uniform2f(uMouse, mouseX, mouseY);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    animationFrameId = requestAnimationFrame(render);
  }

  animationFrameId = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('resize', resize);
  };
}
