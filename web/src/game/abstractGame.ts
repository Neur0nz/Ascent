export type GameInitTuple = [number, [number, number], boolean[]];

function toPlain<T>(value: T): T {
  if (value && typeof value === 'object') {
    const candidate = value as unknown as { toJs?: (options?: { create_proxies?: boolean }) => unknown };
    if (typeof candidate.toJs === 'function') {
      const plain = candidate.toJs({ create_proxies: false });
      return toPlain(plain as T);
    }
  }
  return value;
}

export abstract class AbstractGame {
  protected backend: any;
  py: any;
  nextPlayer: number;
  previousPlayer: number | null;
  gameEnded: [number, number];
  gameMode: 'P0' | 'P1' | 'Human' | 'AI';
  numMCTSSims: number;
  validMoves: boolean[];

  constructor(backend: any = null) {
    this.backend = backend;
    this.py = null;
    this.nextPlayer = 0;
    this.previousPlayer = null;
    this.gameEnded = [0, 0];
    this.gameMode = 'P0';
    this.numMCTSSims = 25;
    this.validMoves = [];
  }

  setPyodide(backend: any) {
    this.backend = backend;
    this.py = backend ?? null;
  }

  init_game() {
    if (!this.py) {
      this.py = this.backend;
    }
    if (!this.py) {
      throw new Error('Santorini backend is not initialised');
    }

    this.nextPlayer = 0;
    this.previousPlayer = null;
    this.gameEnded = [0, 0];

    if (!this.validMoves || this.validMoves.length === 0) {
      this.validMoves = [];
    } else {
      this.validMoves.fill(false);
    }

    const dataTuple = toPlain<GameInitTuple>(this.py.init_game(this.numMCTSSims));
    [this.nextPlayer, this.gameEnded, this.validMoves] = dataTuple;
    this.post_init_game();
  }

  move(action: number, isManualMove: boolean) {
    if (this.is_ended()) {
      return;
    }
    if (!this.validMoves[action]) {
      return;
    }

    this.pre_move(action, isManualMove);

    this.previousPlayer = this.nextPlayer;
    const dataTuple = toPlain<GameInitTuple>(this.py.getNextState(action));
    [this.nextPlayer, this.gameEnded, this.validMoves] = dataTuple;
    this.post_move(action, isManualMove);
  }

  async ai_guess_and_move() {
    if (this.is_ended()) {
      return;
    }
    const bestAction = await this.py.guessBestAction();
    this.move(bestAction, false);
  }

  change_difficulty(numMCTSSims: number) {
    this.numMCTSSims = Number(numMCTSSims);
    if (this.py && typeof this.py.changeDifficulty === 'function') {
      this.py.changeDifficulty(this.numMCTSSims);
    }
  }

  revert_to_previous_human_move() {
    let dataTuple: any;
    if (this.gameMode === 'Human') {
      dataTuple = toPlain(this.py.revert_last_move());
    } else {
      const player = this.who_is_human();
      dataTuple = toPlain(this.py.revert_to_previous_move(player));
    }
    const [nextPlayer, gameEnded, validMoves, removedActions = []] = dataTuple as [number, [number, number], boolean[], number[]];
    this.nextPlayer = nextPlayer;
    this.gameEnded = gameEnded;
    this.validMoves = validMoves;
    this.previousPlayer = null;
    this.post_set_data();
    return removedActions as number[];
  }

  is_ended() {
    return this.gameEnded.some((x) => !!x);
  }

  is_human_player(player: number | 'next' | 'previous') {
    if (this.gameMode === 'AI') {
      return false;
    }
    if (this.gameMode === 'Human') {
      return true;
    }
    let playerIndex = player;
    if (player === 'next') {
      playerIndex = this.nextPlayer;
    } else if (player === 'previous') {
      playerIndex = this.previousPlayer ?? 0;
    }
    return playerIndex === (this.gameMode === 'P0' ? 0 : 1);
  }

  who_is_human() {
    return this.gameMode === 'P0' ? 0 : 1;
  }

  post_init_game() {}
  pre_move(action: number, isManualMove: boolean) {}
  post_move(action: number, isManualMove: boolean) {}
  post_set_data() {}
  has_changed_on_last_move(itemVector: [number, number]) {
    return false;
  }
}
