/** Web Worker: corre el minimax sin congelar la UI. */

import { bestMove } from '../engine/ai';
import type { GameState } from '../engine/types';

self.onmessage = (e: MessageEvent<{ state: GameState; depth: number }>) => {
  const { state, depth } = e.data;
  const move = bestMove(state, depth);
  self.postMessage(move);
};
