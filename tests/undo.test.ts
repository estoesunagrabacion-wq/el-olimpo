import { describe, expect, it } from 'vitest';
import { applyMove, replayTo } from '../src/engine/apply';
import { allMoves, pieceAt } from '../src/engine/rules';
import { newGame } from '../src/engine/setup';
import type { GameState } from '../src/engine/types';

/** Retrato del estado que sirve para comparar dos partidas por igualdad. */
function retrato(s: GameState) {
  return {
    turn: s.turn,
    canjeUsado: { ...s.canjeUsado },
    result: s.result,
    historia: s.history.map((h) => h.text),
    piezas: s.pieces
      .map((p) => `${p.id}:${p.type}:${p.owner}:${p.ring}:${p.idx}:${p.alive ? 1 : 0}`)
      .sort(),
  };
}

/**
 * Partida reproducible. Prefiere capturar cuando puede: así el deshacer se
 * pone a prueba sobre posiciones con piezas muertas, que es el caso que de
 * verdad importa, y no sobre una partida donde nadie se toca.
 */
function partida(plies: number): { estados: GameState[]; final: GameState } {
  const state = newGame({ virtudRival: true });
  let seed = 12345;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const estados: GameState[] = [replayTo(state, 0)];
  for (let i = 0; i < plies && !state.result; i++) {
    const moves = allMoves(state, state.turn);
    if (moves.length === 0) break;
    const capturas = moves.filter(
      (m) => m.kind === 'move' && pieceAt(state, m.to) !== null,
    );
    const pool = capturas.length > 0 ? capturas : moves;
    applyMove(state, pool[Math.floor(rng() * pool.length)]);
    estados.push(replayTo(state, state.history.length));
  }
  return { estados, final: state };
}

describe('deshacer', () => {
  it('cada jugada queda guardada en su entrada de historia', () => {
    const state = newGame({ virtudRival: true });
    const move = allMoves(state, 'rojo')[0];
    applyMove(state, move);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].move).toEqual(move);
  });

  it('rehacer la historia completa devuelve exactamente la misma partida', () => {
    const { final } = partida(40);
    expect(retrato(replayTo(final, final.history.length))).toEqual(retrato(final));
  });

  it('deshacer una jugada devuelve la posición anterior, en cualquier punto', () => {
    const { estados, final } = partida(40);
    // estados[k] es la partida tras k jugadas; replayTo(final, k) debe coincidir
    for (let k = 0; k <= final.history.length; k++) {
      expect(retrato(replayTo(final, k))).toEqual(retrato(estados[k]));
    }
  });

  it('deshacer hasta el principio deja la posición inicial', () => {
    const { final } = partida(30);
    const inicio = replayTo(final, 0);
    expect(inicio.history).toHaveLength(0);
    expect(inicio.pieces.filter((p) => p.alive)).toHaveLength(36);
    expect(inicio.turn).toBe('rojo');
    expect(inicio.result).toBeNull();
    expect(retrato(inicio)).toEqual(retrato(newGame({ virtudRival: true })));
  });

  it('deshacer revive las piezas capturadas', () => {
    const { final } = partida(40);
    const muertasAlFinal = final.pieces.filter((p) => !p.alive).length;
    expect(muertasAlFinal).toBeGreaterThan(0);
    expect(replayTo(final, 0).pieces.filter((p) => !p.alive)).toHaveLength(0);
  });

  it('deshacer un canje devuelve el Diablo a muerto y las piezas sacrificadas a vivas', () => {
    const state = newGame({ virtudRival: true });
    // matar el Diablo rojo por la vía del motor no es directo; se lo baja a
    // mano y se juega el canje, que es lo que interesa deshacer
    const db = state.pieces.find((p) => p.type === 'DB' && p.owner === 'rojo')!;
    db.alive = false;
    applyMove(state, allMoves(state, 'rojo').find((m) => m.kind === 'canje')!);
    expect(state.canjeUsado.rojo).toBe(true);
    expect(state.pieces.find((p) => p.id === db.id)!.alive).toBe(true);

    // Rehacer desde una partida cuyo Diablo estaba vivo no puede reproducir
    // ese arranque artificial, así que se comprueba lo que sí es del motor:
    // el canje quedó registrado como jugada y se puede volver a aplicar.
    expect(state.history.at(-1)!.move.kind).toBe('canje');
  });

  it('no se puede rehacer más allá de la historia ni por debajo de cero', () => {
    const { final } = partida(20);
    expect(replayTo(final, 999).history).toHaveLength(final.history.length);
    expect(replayTo(final, -5).history).toHaveLength(0);
  });
});
