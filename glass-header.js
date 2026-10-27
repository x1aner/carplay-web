/*! SPDX-License-Identifier: GPL-3.0-only */
// Reduce only the frame's upper background to a tiny color row, then diffuse it
// across the header. The picture and the date keep their original render paths.

/**
 * The app's header settings: sample depth in source pixels (1-160) and blur levels. Current apps offer 3-6 (3 is
 * their lightest); 0-2 remain for older apps, whose default is 1, the look a page without settings keeps.
 */
const DEFAULT_DEPTH = 72;
// Stronger blur lowers the color row's resolution instead of spreading taps, which would band.
const BLURS = [
  { divisor: 4, step: 2, canvasPx: 12 },
  { divisor: 8, step: 2, canvasPx: 24 },
  { divisor: 16, step: 2, canvasPx: 48 },
  { divisor: 32, step: 2, canvasPx: 96 },
  { divisor: 64, step: 2, canvasPx: 192 },
  { divisor: 128, step: 2, canvasPx: 384 },
  { divisor: 256, step: 2, canvasPx: 768 },
];
const level = value => (Number.isInteger(value) && value >= 0 && value < BLURS.length ? value : 1);
/** The header style from the phone's status (`{ enabled, depth, blur }`); anything invalid keeps the default. */
export function glassHeaderStyle(input) {
  const depth = Number.isInteger(input?.depth) && input.depth >= 1 && input.depth <= 160 ? input.depth : DEFAULT_DEPTH;
  // Only an explicit false turns the header off: older apps send no `enabled`.
  return { enabled: input?.enabled !== false, depth, ...BLURS[level(input?.blur)] };
}
const DEFAULT_STYLE = glassHeaderStyle();

export function createGlassHeaderPass(gl, buffer, sourceTexture) {
  const vertex = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x+1.,1.-p.y)*.5;gl_Position=vec4(p,0.,1.);}';
  const weights = `float weight(int i){int a=i<0?-i:i;
    return a==0?.270682:(a==1?.216745:(a==2?.111281:.036633));}`;
  const program = fragment => {
    const result = gl.createProgram();
    for (const [type, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text); gl.compileShader(shader);
      gl.attachShader(result, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(result);
    return { value: result, position: gl.getAttribLocation(result, 'p') };
  };
  const row = program(`precision mediump float;
    varying vec2 uv;uniform sampler2D t;uniform vec2 size;uniform float depth;${weights}
    void main(){
      float inset=min(.06,72./size.x);
      float x=mix(inset,1.-inset,uv.x);vec3 color=vec3(0.);
      for(int j=-3;j<=3;j++)for(int i=-1;i<=1;i++){
        vec2 sampleUV=vec2(x+float(i)*4./size.x,abs(depth/3.+float(j)*depth*2./9.)/size.y);
        float horizontal=i==0?.5:.25;
        color+=texture2D(t,clamp(sampleUV,0.,1.)).rgb*weight(j)*horizontal;
      }
      gl_FragColor=vec4(color,1.);
    }`);
  const frost = program(`precision mediump float;
    varying vec2 uv;uniform sampler2D t;uniform sampler2D colors;
    uniform vec2 band;uniform vec4 box;uniform float rowWidth;uniform float tapStep;${weights}
    void main(){
      float x=(uv.x*band.x-box.x)/box.z;
      if(x<0.||x>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}
      vec3 color=vec3(0.);
      for(int i=-3;i<=3;i++)color+=texture2D(colors,vec2(x+float(i)*tapStep/rowWidth,.5)).rgb*weight(i);
      float distance=(1.-uv.y)*band.y;
      float tint=smoothstep(0.,max(1.,band.y),distance);
      float luminance=dot(color,vec3(.2126,.7152,.0722));
      color=mix(color,vec3(luminance),.08*tint)*(1.-.10*tint);
      // Exact source-edge color at the join, diffuse background further up.
      color=mix(texture2D(t,vec2(x,0.)).rgb,color,smoothstep(0.,12.,distance));
      gl_FragColor=vec4(color,1.);
    }`);
  const uniform = (shader, name) => gl.getUniformLocation(shader.value, name);
  const rowSize = uniform(row, 'size'), rowDepth = uniform(row, 'depth');
  const band = uniform(frost, 'band'), boxUniform = uniform(frost, 'box');
  const rowWidth = uniform(frost, 'rowWidth'), stepUniform = uniform(frost, 'tapStep');
  gl.useProgram(frost.value); gl.uniform1i(uniform(frost, 'colors'), 1);
  const colors = gl.createTexture(), framebuffer = gl.createFramebuffer();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, colors);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  let width = 0;
  const use = shader => {
    gl.useProgram(shader.value); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(shader.position); gl.vertexAttribPointer(shader.position, 2, gl.FLOAT, false, 0, 0);
  };
  return {
    draw(top, box, style = DEFAULT_STYLE) {
      const nextWidth = Math.max(1, Math.min(256, Math.ceil(box.width / style.divisor)));
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, colors);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (width !== nextWidth) {
        width = nextWidth;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colors, 0);
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      use(row); gl.uniform2f(rowSize, box.width, box.height); gl.uniform1f(rowDepth, style.depth);
      gl.viewport(0, 0, width, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      use(frost); gl.uniform2f(band, gl.canvas.width, top);
      gl.uniform4f(boxUniform, box.x, box.y, box.width, box.height); gl.uniform1f(rowWidth, width); gl.uniform1f(stepUniform, style.step);
      gl.viewport(0, gl.canvas.height - top, gl.canvas.width, top);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer); gl.deleteTexture(colors);
      gl.deleteProgram(row.value); gl.deleteProgram(frost.value);
    },
  };
}

const colorRows = new WeakMap();
export function drawGlassHeader2D(context, frame, box, top, style = DEFAULT_STYLE) {
  const width = frame.displayWidth || frame.width, height = frame.displayHeight || frame.height;
  if (!top || !width || !height) return;
  let colors = colorRows.get(context);
  if (!colors) {
    colors = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1)
      : context.canvas.ownerDocument.createElement('canvas');
    colors.height = 1; colorRows.set(context, colors);
  }
  const rowWidth = Math.max(1, Math.min(256, Math.ceil(box.width / style.divisor)));
  if (colors.width !== rowWidth) colors.width = rowWidth;
  const row = colors.getContext('2d');
  const inset = Math.min(.06, 72 / box.width) * width;
  row.imageSmoothingEnabled = true; row.imageSmoothingQuality = 'high';
  row.drawImage(frame, inset, 0, width - 2 * inset, Math.min(height, (style.depth + 8) * height / box.height), 0, 0, rowWidth, 1);
  context.save();
  context.beginPath(); context.rect(box.x, 0, box.width, top); context.clip();
  context.filter = `blur(${style.canvasPx}px) saturate(.92) brightness(.90)`;
  context.drawImage(colors, 0, 0, rowWidth, 1, box.x, -96, box.width, top + 192);
  context.drawImage(colors, 0, 0, 1, 1, box.x - 96, -96, 96, top + 192);
  context.drawImage(colors, rowWidth - 1, 0, 1, 1, box.x + box.width, -96, 96, top + 192);
  context.filter = 'none';
  for (let row = 0; row < Math.min(12, top); row++) {
    const t = row / 12;
    context.globalAlpha = 1 - t * t * (3 - 2 * t);
    context.drawImage(frame, 0, 0, width, 1, box.x, top - row - 1, box.width, 1);
  }
  context.restore();
}
