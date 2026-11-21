// the picture behind, bent by the surface (host group "refract"), the sky's light and the sun (group "light")
uniform vec3 uTint;
uniform sampler2D uTop;
uniform sampler2D uBack;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec2 uv = gl_FragCoord.xy / fcScreen;
  // how thick the glass is here: the back faces' depth (a refract-stage pass) less this face's
  float back = texture(uBack, uv).r;
  float thick = clamp(back - dot(vW - cameraPosition, fcCamFwd), 0.0, 6.0);
  vec3 behind = vec3(0.0);
  for (int i = 0; i < 3; i++) behind += texture(fcScene, uv + n.xz * (0.02 + 0.01 * float(i))).rgb;
  behind /= 3.0;
  vec3 col = behind * mix(vec3(1.0), uTint, clamp(thick / 4.0, 0.0, 1.0));
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col = mix(col, fcEnv(reflect(-v, n), 0.05) * fcEnvI * 3.0, fres);
  col += fcSunCol * pow(max(dot(reflect(-fcSunDir, n), v), 0.0), 80.0);
  // (the top-down map, a frame-stage pass: a faint ring where the ball is highest)
  vec2 q = (fcToLocal * vec4(vW, 1.0)).xz / 8.0 + 0.5;
  col += vec3(0.02) * step(0.5, texture(uTop, q).r) * (1.0 - fcNight);
  gl_FragColor = vec4(col, 1.0);
}
