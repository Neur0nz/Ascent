import { GAME_CONSTANTS } from './constants';

export function encodeDirection(oldX: number, oldY: number, newX: number, newY: number): number {
  const diffX = newX - oldX;
  const diffY = newY - oldY;
  if (Math.abs(diffX) > 1 || Math.abs(diffY) > 1) {
    return -1;
  }
  return (
    (diffY + GAME_CONSTANTS.DIRECTION_OFFSET) * GAME_CONSTANTS.DIRECTION_MULTIPLIER +
    (diffX + GAME_CONSTANTS.DIRECTION_OFFSET)
  );
}

export function decodeMove(move: number): [number, number, number] {
  const worker = Math.floor(move / GAME_CONSTANTS.MOVES_PER_WORKER);
  const action = move % GAME_CONSTANTS.MOVES_PER_WORKER;
  const moveDirection = Math.floor(action / GAME_CONSTANTS.DIRECTIONS_COUNT);
  const buildDirection = action % GAME_CONSTANTS.DIRECTIONS_COUNT;
  return [worker, moveDirection, buildDirection];
}

export function applyDirection(startY: number, startX: number, direction: number): [number, number] {
  const deltaY = Math.floor(direction / GAME_CONSTANTS.DIRECTION_MULTIPLIER) - GAME_CONSTANTS.DIRECTION_OFFSET;
  const deltaX = (direction % GAME_CONSTANTS.DIRECTION_MULTIPLIER) - GAME_CONSTANTS.DIRECTION_OFFSET;
  return [startY + deltaY, startX + deltaX];
}
