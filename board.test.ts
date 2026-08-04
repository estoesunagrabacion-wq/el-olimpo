import { describe, expect, it } from 'vitest';
import {
  AVERNO,
  NUM_RINGS,
  REGIONES,
  RING_SIZES,
  TIEMPO,
  diagonalStep,
  lateral,
  radialReach,
  radialStep,
} from '../src/engine/board';

describe('topología del tablero', () => {
  it('tiene 126 casillas en 7 anillos', () => {
    expect(NUM_RINGS).toBe(7);
    expect(RING_SIZES.reduce((a, b) => a + b, 0)).toBe(126);
  });

  it('lateral envuelve el anillo', () => {
    expect(lateral({ ring: REGIONES, idx: 0 }, -1)).toEqual({ ring: 0, idx: 5 });
    expect(lateral({ ring: 2, idx: 23 }, 1)).toEqual({ ring: 2, idx: 0 });
  });

  it('radial expande hacia afuera (6→12, 12→24) y contrae hacia adentro', () => {
    // Regiones (6) → Tiempo (12): 2 hijas
    expect(radialStep({ ring: 0, idx: 2 }, 1)).toEqual([
      { ring: 1, idx: 4 },
      { ring: 1, idx: 5 },
    ]);
    // Tiempo (12) → Regiones (6): 1 madre
    expect(radialStep({ ring: 1, idx: 5 }, -1)).toEqual([{ ring: 0, idx: 2 }]);
    // Tiempo (12) → Pasiones (24): 2 hijas
    expect(radialStep({ ring: 1, idx: 0 }, 1)).toEqual([
      { ring: 2, idx: 0 },
      { ring: 2, idx: 1 },
    ]);
    // Pasiones (24) → Pasiones (24): identidad
    expect(radialStep({ ring: 2, idx: 7 }, 1)).toEqual([{ ring: 3, idx: 7 }]);
    // Pasiones (24) → Averno (12): contrae
    expect(radialStep({ ring: 5, idx: 7 }, 1)).toEqual([{ ring: AVERNO, idx: 3 }]);
    // Averno (12) → Pasiones (24): expande
    expect(radialStep({ ring: AVERNO, idx: 3 }, -1)).toEqual([
      { ring: 5, idx: 6 },
      { ring: 5, idx: 7 },
    ]);
  });

  it('no hay radial hacia adentro desde Regiones ni hacia afuera desde Averno', () => {
    expect(radialStep({ ring: REGIONES, idx: 0 }, -1)).toEqual([]);
    expect(radialStep({ ring: AVERNO, idx: 0 }, 1)).toEqual([]);
  });

  it('radialReach acumula casillas intermedias y ramifica en expansiones', () => {
    // Desde Pasiones II (ring 3) hacia adentro 2 pasos: ring 2 y ring 1
    const inward = radialReach({ ring: 3, idx: 8 }, -1, 2);
    expect(inward).toContainEqual({ ring: 2, idx: 8 });
    expect(inward).toContainEqual({ ring: TIEMPO, idx: 4 });
    expect(inward).toHaveLength(2);
    // Desde Tiempo hacia afuera 2 pasos: 2 en ring 2, 2 en ring 3
    const outward = radialReach({ ring: TIEMPO, idx: 0 }, 1, 2);
    expect(outward).toHaveLength(4);
  });

  it('diagonal en anillos iguales da 2 casillas, en expansión también 2', () => {
    expect(diagonalStep({ ring: 2, idx: 5 }, 1)).toEqual([
      { ring: 3, idx: 4 },
      { ring: 3, idx: 6 },
    ]);
    // Tiempo (12) → Pasiones (24): imágenes 0,1 → diagonales 23 y 2
    expect(diagonalStep({ ring: 1, idx: 0 }, 1)).toEqual(
      expect.arrayContaining([
        { ring: 2, idx: 23 },
        { ring: 2, idx: 2 },
      ]),
    );
    expect(diagonalStep({ ring: 1, idx: 0 }, 1)).toHaveLength(2);
  });
});
