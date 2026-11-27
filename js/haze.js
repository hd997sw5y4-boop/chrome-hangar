// Aerial perspective for every material that uses scene fog: a thin blue haze whose density falls off with
// height (scale height HAZE_H), integrated along the view ray. Low views get soft blue distance; from altitude
// the ground stays crisp under a faint veil. Replaces three's FogExp2 maths (fogDensity = sea-level extinction, 1/m).
import * as THREE from 'three';

export const HAZE_H = 1800.0;   // m
// optical depth -> haze amount for a ray from c to p (metres, y up, haze base at y = 0)
export const HAZE_GLSL = `
float hazeAmount(vec3 c, vec3 p, float beta) {
  float d = length(p - c), h0 = max(c.y, 0.0), h1 = max(p.y, 0.0), dh = h1 - h0;
  float e0 = exp(-h0 / ${HAZE_H.toFixed(1)}), e1 = exp(-h1 / ${HAZE_H.toFixed(1)});
  float m = abs(dh) > 1.0 ? (e0 - e1) * ${HAZE_H.toFixed(1)} / dh : e0;   // mean density along the ray
  return 1.0 - exp(-beta * d * m);
}`;

const C = THREE.ShaderChunk;
C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vHazeW;\n#endif';
// world position from the view-space one, so any shader with an mvPosition gets it (points, sprites, instancing)
C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvHazeW = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );\n#endif';
C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vHazeW;
	#ifdef FOG_EXP2
		uniform float fogDensity;
		${HAZE_GLSL}
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = hazeAmount( cameraPosition, vHazeW, fogDensity );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
