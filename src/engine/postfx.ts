import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Subtle cinematic grade: vignette, film grain, slight chromatic aberration and a
 * very light lift in the shadows. Applied after bloom, before tone-mapping output.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.95 },
    uGrain: { value: 0.03 },
    uAberration: { value: 0.0016 },
    uSaturation: { value: 1.06 },
    uLift: { value: 0.012 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uLift;
    varying vec2 vUv;

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float r2 = dot( dir, dir );

      // chromatic aberration grows towards the edges
      vec3 col;
      col.r = texture2D( tDiffuse, uv + dir * uAberration * ( 0.4 + r2 ) ).r;
      col.g = texture2D( tDiffuse, uv ).g;
      col.b = texture2D( tDiffuse, uv - dir * uAberration * ( 0.4 + r2 ) ).b;

      // saturation + shadow lift
      float luma = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( luma ), col, uSaturation );
      col += uLift * ( 1.0 - smoothstep( 0.0, 0.35, luma ) );

      // vignette
      float vig = 1.0 - uVignette * r2 * 0.55;
      col *= clamp( vig, 0.0, 1.0 );

      // animated grain
      float g = hash( uv * vec2( 1024.0, 768.0 ) + fract( uTime ) * 91.7 ) - 0.5;
      col += g * uGrain * ( 0.4 + 0.6 * ( 1.0 - luma ) );

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

export type PostFx = {
  composer: EffectComposer;
  setSize: (w: number, h: number) => void;
  update: (t: number) => void;
  setQuality: (low: boolean) => void;
  dispose: () => void;
};

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.72, 0.72);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const output = new OutputPass();
  composer.addPass(output);

  return {
    composer,
    setSize: (w, h) => {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    update: (t) => {
      grade.uniforms.uTime.value = t;
    },
    setQuality: (low) => {
      bloom.enabled = !low;
      grade.uniforms.uGrain.value = low ? 0.016 : 0.03;
    },
    dispose: () => {
      composer.dispose();
      bloom.dispose();
    },
  };
}
