import { describe, expect, it } from 'vitest';
import { AVERNO, REGIONES, TIEMPO } from '../src/engine/board';
import { initialPieces, newGame } from '../src/engine/setup';
import {
  allMoves,
  canjeOptions,
  canSelect,
  isCellThreatened,
  pieceDests,
} from '../src/engine/rules';
import { applyMove, evaluateEnd, regionCounts, scoreByRegions } from '../src/engine/apply';
import { makeState, piece } from './helpers';

describe('posición inicial', () => {
  it('reparte 36 piezas (18 por bando) según las reglas', () => {
    const pieces = initialPieces();
    expect(pieces).toHaveLength(36);
    const count = (t: string, o: string) => pieces.filter((p) => p.type === t && p.owner === o).length;
    for (const o of ['rojo', 'dorado']) {
      expect(count('DB', o)).toBe(1);
      expect(count('ID', o)).toBe(3);
      expect(count('VI', o)).toBe(3);
      expect(count('PO', o)).toBe(3);
      expect(count('PU', o)).toBe(2);
      expect(count('CU', o)).toBe(6);
    }
  });

  it('cada bando arranca en su mitad, en los anillos correctos', () => {
    const pieces = initialPieces();
    for (const p of pieces) {
      const half = p.idx < [6, 12, 24, 24, 24, 24, 12][p.ring] / 2 ? 'rojo' : 'dorado';
      expect(half).toBe(p.owner);
      if (p.type === 'DB') expect(p.ring).toBe(AVERNO);
      if (p.type === 'VI') expect(p.ring).toBe(TIEMPO);
      if (p.type === 'ID') expect(p.ring).toBe(4);
      if (['PO', 'PU', 'CU'].includes(p.type)) expect(p.ring).toBe(5);
    }
  });

  it('la partida nueva no está terminada y hay jugadas', () => {
    const state = newGame({ virtudRival: true });
    expect(evaluateEnd(state)).toBeNull();
    expect(allMoves(state, 'rojo').length).toBeGreaterThan(0);
  });
});

describe('Virtud', () => {
  it('se mueve 1 en cualquier dirección solo dentro de Regiones y Tiempo, sin capturar', () => {
    const vi = piece('VI', 'rojo', TIEMPO, 3);
    const enemy = piece('CU', 'dorado', TIEMPO, 4);
    const state = makeState([vi, enemy]);
    const dests = pieceDests(state, vi);
    // nunca sale de los anillos 0-1
    expect(dests.every((d) => d.ring === REGIONES || d.ring === TIEMPO)).toBe(true);
    // no captura: la casilla del enemigo no aparece
    expect(dests.some((d) => d.ring === TIEMPO && d.idx === 4)).toBe(false);
    expect(dests.every((d) => !d.capture)).toBe(true);
    // sí llega a Regiones (radial hacia adentro) y lateral libre
    expect(dests.some((d) => d.ring === REGIONES)).toBe(true);
    expect(dests.some((d) => d.ring === TIEMPO && d.idx === 2)).toBe(true);
  });

  it('una Virtud en Regiones circula lateralmente cruzando los rayos', () => {
    const vi = piece('VI', 'rojo', REGIONES, 0);
    const state = makeState([vi]);
    const dests = pieceDests(state, vi);
    expect(dests.some((d) => d.ring === REGIONES && d.idx === 5)).toBe(true);
    expect(dests.some((d) => d.ring === REGIONES && d.idx === 1)).toBe(true);
  });
});

describe('Ídolo', () => {
  it('alcanza hasta 2 radial y hasta 3 lateral', () => {
    const id = piece('ID', 'rojo', 3, 10);
    const state = makeState([id]);
    const dests = pieceDests(state, id);
    // radial: ring 2 y ring 1 (contrae), ring 4 y ring 5
    expect(dests).toContainEqual({ ring: 2, idx: 10, capture: false });
    expect(dests).toContainEqual({ ring: TIEMPO, idx: 5, capture: false });
    expect(dests).toContainEqual({ ring: 4, idx: 10, capture: false });
    expect(dests).toContainEqual({ ring: 5, idx: 10, capture: false });
    // lateral hasta 3
    for (const d of [7, 8, 9, 11, 12, 13]) {
      expect(dests).toContainEqual({ ring: 3, idx: d, capture: false });
    }
    // no más de 3 lateral
    expect(dests.some((d) => d.ring === 3 && d.idx === 6)).toBe(false);
  });

  it('captura en destino y es bloqueado por piezas propias', () => {
    const id = piece('ID', 'rojo', 3, 10);
    const enemy = piece('CU', 'dorado', 3, 12);
    const own = piece('CU', 'rojo', 3, 9);
    const state = makeState([id, enemy, own]);
    const dests = pieceDests(state, id);
    expect(dests).toContainEqual({ ring: 3, idx: 12, capture: true });
    expect(dests.some((d) => d.ring === 3 && d.idx === 9)).toBe(false);
    // el salto: la propia en idx 9 no impide llegar a idx 8
    expect(dests).toContainEqual({ ring: 3, idx: 8, capture: false });
  });

  it('no puede entrar al Averno', () => {
    const id = piece('ID', 'rojo', 5, 4);
    const state = makeState([id]);
    expect(pieceDests(state, id).every((d) => d.ring !== AVERNO)).toBe(true);
  });
});

describe('Pontífice', () => {
  it('1 radial, hasta 2 lateral', () => {
    const po = piece('PO', 'rojo', 3, 5);
    const state = makeState([po]);
    const dests = pieceDests(state, po);
    expect(dests).toContainEqual({ ring: 2, idx: 5, capture: false });
    expect(dests).toContainEqual({ ring: 4, idx: 5, capture: false });
    expect(dests.some((d) => d.ring === TIEMPO)).toBe(false); // radial máx 1
    for (const d of [3, 4, 6, 7]) expect(dests).toContainEqual({ ring: 3, idx: d, capture: false });
    expect(dests.some((d) => d.ring === 3 && d.idx === 8)).toBe(false);
  });
});

describe('Pueblo', () => {
  it('camina recto solo a vacío y captura en cualquier dirección', () => {
    const pu = piece('PU', 'rojo', 3, 5);
    const blockStraight = piece('CU', 'dorado', 3, 6); // enemigo al costado
    const diagEnemy = piece('CU', 'dorado', 4, 6); // enemigo en diagonal
    const state = makeState([pu, blockStraight, diagEnemy]);
    const dests = pieceDests(state, pu);
    // recto vacío: lateral -1 y radiales
    expect(dests).toContainEqual({ ring: 3, idx: 4, capture: false });
    expect(dests).toContainEqual({ ring: 2, idx: 5, capture: false });
    expect(dests).toContainEqual({ ring: 4, idx: 5, capture: false });
    // recto ocupado por enemigo: lo captura (cualquier dirección captura)
    expect(dests).toContainEqual({ ring: 3, idx: 6, capture: true });
    // diagonal: captura sí, caminar no
    expect(dests).toContainEqual({ ring: 4, idx: 6, capture: true });
    expect(dests.some((d) => d.ring === 4 && d.idx === 4)).toBe(false); // diagonal vacía: no camina
  });
});

describe('Cura', () => {
  it('solo diagonal, 1 casilla, mueve o captura', () => {
    const cu = piece('CU', 'rojo', 3, 5);
    const enemy = piece('PU', 'dorado', 4, 6);
    const state = makeState([cu, enemy]);
    const dests = pieceDests(state, cu);
    expect(dests).toContainEqual({ ring: 2, idx: 4, capture: false });
    expect(dests).toContainEqual({ ring: 2, idx: 6, capture: false });
    expect(dests).toContainEqual({ ring: 4, idx: 4, capture: false });
    expect(dests).toContainEqual({ ring: 4, idx: 6, capture: true });
    // nada lateral ni radial puro
    expect(dests.some((d) => d.ring === 3)).toBe(false);
    expect(dests.some((d) => d.ring === 2 && d.idx === 5)).toBe(false);
  });
});

describe('Diablo', () => {
  it('fuera del Averno: hasta 3 radial y 4 lateral', () => {
    const db = piece('DB', 'rojo', 3, 10);
    const state = makeState([db]);
    const dests = pieceDests(state, db);
    // hacia adentro 3: ring 2, Tiempo, Regiones
    expect(dests).toContainEqual({ ring: 2, idx: 10, capture: false });
    expect(dests).toContainEqual({ ring: TIEMPO, idx: 5, capture: false });
    expect(dests).toContainEqual({ ring: REGIONES, idx: 2, capture: false });
    // hacia afuera 3: rings 4, 5 y Averno (el Diablo sí entra)
    expect(dests).toContainEqual({ ring: AVERNO, idx: 5, capture: false });
    // lateral 4
    expect(dests).toContainEqual({ ring: 3, idx: 14, capture: false });
    expect(dests.some((d) => d.ring === 3 && d.idx === 15)).toBe(false);
  });

  it('dentro del Averno: solo 2 y 2', () => {
    const db = piece('DB', 'rojo', AVERNO, 3);
    const state = makeState([db]);
    const dests = pieceDests(state, db);
    // radial hacia adentro 2: ring 5 (2 hijas) y ring 4 (2)
    expect(dests.filter((d) => d.ring === 5)).toHaveLength(2);
    expect(dests.filter((d) => d.ring === 4)).toHaveLength(2);
    expect(dests.some((d) => d.ring === 3)).toBe(false);
    // lateral 2
    expect(dests).toContainEqual({ ring: AVERNO, idx: 5, capture: false });
    expect(dests.some((d) => d.ring === AVERNO && d.idx === 6)).toBe(false);
  });
});

describe('regla de la Virtud rival', () => {
  it('con el toggle activo se puede mover la Virtud rival amenazada', () => {
    const vi = piece('VI', 'dorado', TIEMPO, 3);
    const attacker = piece('DB', 'rojo', 3, 12); // radial 2 adentro llega a Tiempo 6... usemos idx correcto
    // DB en ring 3 idx 6/7 contrae a Tiempo 3: elegimos idx 7
    attacker.ring = 3;
    attacker.idx = 7;
    const state = makeState([vi, attacker], 'rojo');
    expect(isCellThreatened(state, { ring: TIEMPO, idx: 3 })).toBe(true);
    expect(canSelect(state, vi, 'rojo')).toBe(true);
    const moves = allMoves(state, 'rojo');
    expect(moves.some((m) => m.kind === 'move' && m.pieceId === vi.id)).toBe(true);
  });

  it('con el toggle apagado no se puede', () => {
    const vi = piece('VI', 'dorado', TIEMPO, 3);
    const attacker = piece('DB', 'rojo', 3, 7);
    const state = makeState([vi, attacker], 'rojo', { virtudRival: false });
    expect(canSelect(state, vi, 'rojo')).toBe(false);
    expect(allMoves(state, 'rojo').some((m) => m.kind === 'move' && m.pieceId === vi.id)).toBe(false);
  });

  it('una Virtud rival NO amenazada no se puede mover', () => {
    const vi = piece('VI', 'dorado', TIEMPO, 3);
    const far = piece('CU', 'rojo', 5, 20);
    const state = makeState([vi, far], 'rojo');
    expect(canSelect(state, vi, 'rojo')).toBe(false);
  });
});

describe('canje del Diablo', () => {
  function deadDbState() {
    const db = piece('DB', 'rojo', AVERNO, 3, { alive: false });
    const ídolo = piece('ID', 'rojo', 4, 2);
    const cura = piece('CU', 'rojo', 5, 1);
    const cura2 = piece('CU', 'rojo', 5, 2);
    const pont = piece('PO', 'rojo', 5, 3);
    const enemy = piece('DB', 'dorado', AVERNO, 9);
    return makeState([db, ídolo, cura, cura2, pont, enemy], 'rojo');
  }

  it('ofrece ambos combos cuando hay piezas suficientes', () => {
    const opts = canjeOptions(deadDbState(), 'rojo');
    expect(opts.map((o) => o.combo).sort()).toEqual(['2CU+PO', 'ID+CU']);
  });

  it('al aplicarlo, el Diablo revive en su casilla original y los sacrificios mueren', () => {
    const state = deadDbState();
    const opt = canjeOptions(state, 'rojo')[0];
    applyMove(state, { kind: 'canje', combo: opt.combo, sacrificeIds: opt.sacrificeIds });
    const db = state.pieces.find((p) => p.type === 'DB' && p.owner === 'rojo')!;
    expect(db.alive).toBe(true);
    expect({ ring: db.ring, idx: db.idx }).toEqual({ ring: AVERNO, idx: 3 });
    for (const id of opt.sacrificeIds) {
      expect(state.pieces.find((p) => p.id === id)!.alive).toBe(false);
    }
    expect(state.canjeUsado.rojo).toBe(true);
    // una sola vez por partida
    expect(canjeOptions(state, 'rojo')).toEqual([]);
  });

  it('no se ofrece si la casilla original está ocupada o el Diablo vive', () => {
    const state = deadDbState();
    state.pieces.push(piece('DB', 'dorado', AVERNO, 3)); // ocupa el home
    expect(canjeOptions(state, 'rojo')).toEqual([]);
    const state2 = deadDbState();
    state2.pieces[0].alive = true;
    expect(canjeOptions(state2, 'rojo')).toEqual([]);
  });
});

describe('fin de partida', () => {
  it('eliminación total', () => {
    const last = piece('CU', 'dorado', 3, 5);
    const rojoPiece = piece('ID', 'rojo', 3, 7);
    const state = makeState([last, rojoPiece], 'rojo');
    applyMove(state, { kind: 'move', pieceId: rojoPiece.id, to: { ring: 3, idx: 5 } });
    expect(state.result).toEqual({ type: 'eliminacion', winner: 'rojo' });
  });

  it('conteo de Regiones y tablas', () => {
    const state = makeState([
      piece('VI', 'rojo', REGIONES, 0),
      piece('CU', 'rojo', REGIONES, 1),
      piece('ID', 'dorado', REGIONES, 3),
      piece('CU', 'dorado', 5, 20),
    ]);
    expect(regionCounts(state)).toEqual({ rojo: 2, dorado: 1 });
    expect(scoreByRegions(state)).toEqual({ type: 'regiones', winner: 'rojo', rojo: 2, dorado: 1 });
    const empate = makeState([piece('VI', 'rojo', REGIONES, 0), piece('VI', 'dorado', REGIONES, 3)]);
    expect(scoreByRegions(empate).winner).toBeNull();
  });

  it('jugador sin jugadas termina la partida por conteo', () => {
    // dorado solo tiene una VI encerrada... una VI siempre tiene casillas vacías
    // alrededor salvo que esté rodeada; más simple: dorado sin piezas móviles
    // no existe (todas mueven), así que simulamos: dorado solo con su Diablo
    // muerto y sin material para canjear → sin jugadas.
    const db = piece('DB', 'dorado', AVERNO, 9, { alive: false });
    const rojoP = piece('CU', 'rojo', 3, 5);
    const doradoVi = piece('VI', 'dorado', REGIONES, 3);
    // rodear la VI dorada: sus vecinos en Regiones y Tiempo ocupados
    const blockers = [
      piece('VI', 'rojo', REGIONES, 2),
      piece('VI', 'rojo', REGIONES, 4),
      piece('VI', 'rojo', TIEMPO, 6),
      piece('VI', 'rojo', TIEMPO, 7),
      piece('VI', 'rojo', TIEMPO, 5),
      piece('VI', 'rojo', TIEMPO, 8),
    ];
    const state = makeState([db, rojoP, doradoVi, ...blockers], 'rojo', { virtudRival: false });
    // el Cura mueve en diagonal
    applyMove(state, { kind: 'move', pieceId: rojoP.id, to: { ring: 4, idx: 6 } });
    expect(state.result?.type).toBe('regiones');
  });
});

describe('legalidad general', () => {
  it('ninguna jugada generada es ilegal y ninguna captura piezas propias', () => {
    const state = newGame({ virtudRival: true });
    for (const m of allMoves(state, 'rojo')) {
      if (m.kind !== 'move') continue;
      const target = state.pieces.find(
        (p) => p.alive && p.ring === m.to.ring && p.idx === m.to.idx,
      );
      if (target) expect(target.owner).not.toBe('rojo');
      expect(m.to.ring).toBeGreaterThanOrEqual(0);
      expect(m.to.ring).toBeLessThan(7);
    }
  });

  it('partida sintética: 60 medio-turnos aleatorios sin jugadas ilegales ni estado corrupto', () => {
    const state = newGame({ virtudRival: true });
    let rngSeed = 42;
    const rng = () => {
      rngSeed = (rngSeed * 1103515245 + 12345) % 2 ** 31;
      return rngSeed / 2 ** 31;
    };
    for (let i = 0; i < 60 && !state.result; i++) {
      const moves = allMoves(state, state.turn);
      expect(moves.length).toBeGreaterThan(0);
      applyMove(state, moves[Math.floor(rng() * moves.length)]);
      // ninguna casilla con dos piezas vivas
      const seen = new Set<string>();
      for (const p of state.pieces) {
        if (!p.alive) continue;
        const k = p.ring + ':' + p.idx;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });
});
