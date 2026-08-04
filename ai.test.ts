import { describe, expect, it } from 'vitest';
import { AVERNO, TIEMPO } from '../src/engine/board';
import { bestMove, evaluate } from '../src/engine/ai';
import { applyMove, cloneState } from '../src/engine/apply';
import { newGame } from '../src/engine/setup';
import { isCellThreatened } from '../src/engine/rules';
import { makeState, piece } from './helpers';

describe('IA', () => {
  it('captura una pieza regalada', () => {
    const cu = piece('CU', 'rojo', 3, 5);
    const gift = piece('PU', 'dorado', 4, 6);
    const far = piece('DB', 'dorado', AVERNO, 9);
    const state = makeState([cu, gift, far], 'rojo');
    const move = bestMove(state, 2, () => 0);
    expect(move).toMatchObject({ kind: 'move', to: { ring: 4, idx: 6 } });
  });

  it('no deja su Diablo capturable gratis (criterio de aceptación 3)', () => {
    // Un Ídolo rojo amenaza al Diablo dorado. Con profundidad 2 la IA debe
    // dejar al Diablo en una casilla que rojo no pueda capturar.
    const db = piece('DB', 'dorado', 3, 12);
    const attacker = piece('ID', 'rojo', 3, 14); // lateral hasta 3: llega a 12
    const state = makeState([db, attacker], 'dorado');
    const move = bestMove(state, 2, () => 0)!;
    const after = cloneState(state);
    applyMove(after, move, true);
    const dbAfter = after.pieces.find((p) => p.type === 'DB' && p.owner === 'dorado')!;
    expect(dbAfter.alive).toBe(true);
    expect(isCellThreatened(after, { ring: dbAfter.ring, idx: dbAfter.idx }, 'rojo')).toBe(false);
  });

  it('la evaluación premia ocupar Regiones', () => {
    const inRegion = makeState([piece('VI', 'rojo', 0, 2)]);
    const inTiempo = makeState([piece('VI', 'rojo', TIEMPO, 4)]);
    expect(evaluate(inRegion, 'rojo')).toBeGreaterThan(evaluate(inTiempo, 'rojo'));
  });

  it('juega una partida completa vs sí misma sin errores', () => {
    const state = newGame({ virtudRival: true });
    for (let i = 0; i < 40 && !state.result; i++) {
      const move = bestMove(state, 1, () => 0.5);
      if (!move) break;
      applyMove(state, move);
    }
    expect(state.history.length).toBeGreaterThan(10);
  });

  it('profundidad 2 responde en tiempo razonable desde la apertura', () => {
    const state = newGame({ virtudRival: true });
    const t0 = performance.now();
    const move = bestMove(state, 2, () => 0);
    const dt = performance.now() - t0;
    expect(move).not.toBeNull();
    expect(dt).toBeLessThan(5000);
  });
});
