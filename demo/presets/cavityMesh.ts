import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { float, normalView, positionView } from 'three/tsl';
import { BallisticShot, GEL_CENTER, GEL_LENGTH } from './ballisticShot.js';

/** An explicit gel/air interface. Its rings use the same passage law as the GPU particles. */
export class CavityMesh extends Mesh<BufferGeometry, MeshPhysicalNodeMaterial> {
  private readonly rings = 160;
  private readonly sides = 36;
  private readonly vertices: Float32Array;

  constructor() {
    const geometry = new BufferGeometry();
    const material = new MeshPhysicalNodeMaterial({
      color: 0xe8fbff,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.13,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      envMapIntensity: 1.3,
    });
    const facing = normalView.dot(positionView.negate().normalize()).abs();
    material.opacityNode = float(0.06).add(float(1).sub(facing).pow(2).mul(0.58));
    super(geometry, material);
    this.name = 'ballistic-cavity';
    // Keep the internal interface out of the shell's screen-space refraction buffer.
    this.renderOrder = 3;
    this.frustumCulled = false;
    this.vertices = new Float32Array((this.rings + 1) * (this.sides + 1) * 3);
    const positions = new BufferAttribute(this.vertices, 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positions);
    const indices: number[] = [];
    for (let i = 0; i < this.rings; i++) {
      for (let j = 0; j < this.sides; j++) {
        const a = i * (this.sides + 1) + j,
          b = a + this.sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    geometry.setIndex(indices);
    this.visible = false;
  }

  update(shot: BallisticShot, time: number, reach: number): void {
    const length = Math.max(0, Math.min(GEL_LENGTH, reach, shot.flight.stopDistance));
    this.visible = length > 0.001;
    let maxRadius = 0;
    for (let i = 0; i <= this.rings; i++) {
      const station = (length * i) / this.rings;
      let radius = shot.radiusAt(time, station);
      // Close the terminal cap of a lodged round. A perforated channel stays open.
      if (reach < GEL_LENGTH && i === this.rings) radius = 0;
      maxRadius = Math.max(maxRadius, radius);
      for (let j = 0; j <= this.sides; j++) {
        const angle = (j / this.sides) * Math.PI * 2;
        const index = (i * (this.sides + 1) + j) * 3;
        const ripple =
          1 +
          0.009 * Math.sin(station * 110 + angle * 5) +
          0.006 * Math.sin(station * 67 - angle * 3);
        this.vertices[index] = -GEL_LENGTH / 2 + station;
        this.vertices[index + 1] = GEL_CENTER.y + radius * ripple * Math.cos(angle);
        this.vertices[index + 2] = radius * ripple * Math.sin(angle);
      }
    }
    this.geometry.attributes['position']!.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.userData['maxRadius'] = maxRadius;
    this.userData['length'] = length;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
