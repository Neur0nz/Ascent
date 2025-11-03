import numpy as np
from SantoriniConstants import (
    NO_BUILD,
    NO_GOD,
    NO_MOVE,
    NB_GODS,
    _decode_action,
    _encode_action,
    flipLR,
    flipUD,
    rotation,
)

# 0: 2x2 workers set at an arbitrary position before 1st move
# 1: 2x2 workers set at a random position before 1st move
# 2: No worker pre-set, each player has to chose their position
INIT_METHOD = 2


DIRECTIONS = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 0),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
]


def observation_size():
    # True size is 5,5,3 but other functions expect 2-dim answer
    return (25, 3)


def action_size():
    return NB_GODS * 2 * 9 * 9


class Board:
    def __init__(self, num_players):
        self.state = np.zeros((5, 5, 3), dtype=np.int8)
        self.workers = self.state[:, :, 0]
        self.levels = self.state[:, :, 1]
        self.meta = self.state[:, :, 2]
        self.init_game()

    def get_score(self, player):
        highest_level = 0
        comparator = (lambda w: w > 0) if player == 0 else (lambda w: w < 0)
        for i in np.ndindex(5, 5):
            worker, level = self.workers[i], self.levels[i]
            if comparator(worker) and level > highest_level:
                highest_level = level
        return highest_level

    def init_game(self):
        self.state.fill(0)
        if INIT_METHOD == 0:
            self.workers[2, 1], self.workers[2, 3] = 1, 2
            self.workers[1, 2], self.workers[3, 2] = -1, -2
        elif INIT_METHOD == 1:
            init_places = np.random.choice(5 * 5, 4, replace=False)
            workers_list = [1, -1, 2, -2]
            for place, worker in zip(init_places, workers_list):
                self.workers[place // 5, place % 5] = worker
        elif INIT_METHOD == 2:
            pass
        self.meta.fill(0)

    def get_state(self):
        return self.state

    def valid_moves(self, player):
        actions = np.zeros(action_size(), dtype=np.bool_)
        placement = None
        if INIT_METHOD == 2:
            placement = self._next_placement()
            if placement is not None:
                for index, value in np.ndenumerate(self.workers):
                    actions[5 * index[0] + index[1]] = value == 0
                return actions

        for worker in range(2):
            worker_id = (worker + 1) * (1 if player == 0 else -1)
            worker_position = self._get_worker_position(worker_id)
            if worker_position == (-1, -1):
                continue
            for move_direction in range(9):
                if move_direction == NO_MOVE:
                    continue
                worker_new_position = self._apply_direction(worker_position, move_direction)
                if not self._able_to_move_worker_to(worker_position, worker_new_position, player):
                    continue
                for build_direction in range(9):
                    if build_direction == NO_BUILD:
                        continue
                    build_position = self._apply_direction(worker_new_position, build_direction)
                    if not self._able_to_build(build_position, ignore=worker_id):
                        continue
                    actions[_encode_action(worker, NO_GOD, move_direction, build_direction)] = True
        return actions

    def make_move(self, move, player, deterministic):
        placement = None
        if INIT_METHOD == 2:
            placement = self._next_placement()
            if placement is not None:
                placement_player, worker_to_place = placement
                if placement_player != player:
                    raise ValueError('Unexpected player attempting to place a worker')
                y, x = divmod(move, 5)
                if not (0 <= y < 5 and 0 <= x < 5):
                    raise ValueError('Placement move is out of bounds')
                if self.workers[y, x] != 0:
                    raise ValueError('Cannot place a worker on an occupied tile')
                self.workers[y, x] = worker_to_place
                if worker_to_place in (1, -1):
                    next_player = placement_player
                else:
                    next_player = 1 - placement_player
            else:
                placement = None
        if INIT_METHOD != 2 or placement is None:
            worker, power, move_direction, build_direction = _decode_action(move)
            if power != NO_GOD:
                raise ValueError('God powers are disabled in this build')
            worker_id = (worker + 1) * (1 if player == 0 else -1)
            worker_old_position = self._get_worker_position(worker_id)
            worker_new_position = self._apply_direction(worker_old_position, move_direction)
            old_level = self.levels[worker_old_position]
            self.workers[worker_old_position], self.workers[worker_new_position] = 0, worker_id
            if build_direction != NO_BUILD:
                build_position = self._apply_direction(worker_new_position, build_direction)
                self.levels[build_position] = min(4, self.levels[build_position] + 1)
            new_level = self.levels[worker_new_position]
            next_player = 1 - player
            if new_level >= 3 and new_level > old_level:
                # keep round counter capped even if game ends immediately
                pass
        if self.meta.flat[0] < 127:
            self.meta.flat[0] += 1
        return next_player

    def check_end_game(self, next_player):
        if INIT_METHOD == 2 and self._next_placement() is not None:
            return np.array([0, 0], dtype=np.float32)
        if self.get_score(0) == 3:
            return np.array([1, -1], dtype=np.float32)
        if self.get_score(1) == 3:
            return np.array([-1, 1], dtype=np.float32)
        if self.valid_moves(next_player).sum() == 0:
            if next_player == 0:
                return np.array([-1, 1], dtype=np.float32)
            else:
                return np.array([1, -1], dtype=np.float32)
        return np.array([0, 0], dtype=np.float32)

    def swap_players(self, nb_swaps):
        if nb_swaps != 1:
            return
        self.workers[:, :] = -self.workers

    def get_symmetries(self, policy, valid_actions):
        symmetries = [(self.state.copy(), policy.copy(), valid_actions.copy())]
        state_backup = self.state.copy()

        def _apply_permutation(permutation, array, array2):
            array_copy, array2_copy = array.copy(), array2.copy()
            for i, new_i in enumerate(permutation):
                array_copy[new_i], array2_copy[new_i] = array[i], array2[i]
            return array_copy, array2_copy

        rotated_policy, rotated_actions = policy, valid_actions
        for _ in range(3):
            self.workers[:, :] = np.rot90(self.workers)
            self.levels[:, :] = np.rot90(self.levels)
            rotated_policy, rotated_actions = _apply_permutation(rotation, rotated_policy, rotated_actions)
            symmetries.append((self.state.copy(), rotated_policy.copy(), rotated_actions.copy()))
        self.state[:, :, :] = state_backup.copy()

        self.workers[:, :] = np.fliplr(self.workers)
        self.levels[:, :] = np.fliplr(self.levels)
        flipped_policy, flipped_actions = _apply_permutation(flipLR, policy, valid_actions)
        symmetries.append((self.state.copy(), flipped_policy, flipped_actions))
        self.state[:, :, :] = state_backup.copy()

        self.workers[:, :] = np.flipud(self.workers)
        self.levels[:, :] = np.flipud(self.levels)
        flipped_policy, flipped_actions = _apply_permutation(flipUD, policy, valid_actions)
        symmetries.append((self.state.copy(), flipped_policy, flipped_actions))
        self.state[:, :, :] = state_backup.copy()

        if INIT_METHOD == 2 and self._next_placement() is not None:
            return symmetries

        def _swap_workers(array, half_size):
            array_copy = array.copy()
            array_copy[:half_size], array_copy[half_size:] = array[half_size:], array[:half_size]
            return array_copy

        w1, w2 = self._get_worker_position(1), self._get_worker_position(2)
        self.workers[w1], self.workers[w2] = 2, 1
        swapped_policy = _swap_workers(policy, action_size() // 2)
        swapped_actions = _swap_workers(valid_actions, action_size() // 2)
        symmetries.append((self.state.copy(), swapped_policy, swapped_actions))
        self.state[:, :, :] = state_backup.copy()

        wm1, wm2 = self._get_worker_position(-1), self._get_worker_position(-2)
        self.workers[wm1], self.workers[wm2] = -2, -1
        symmetries.append((self.state.copy(), policy.copy(), valid_actions.copy()))
        self.state[:, :, :] = state_backup.copy()

        return symmetries

    def get_round(self):
        return int(self.meta.flat[0])

    def copy_state(self, state, copy_or_not):
        if self.state is state and not copy_or_not:
            return
        self.state = state.copy() if copy_or_not else state
        self.workers = self.state[:, :, 0]
        self.levels = self.state[:, :, 1]
        self.meta = self.state[:, :, 2]

    def _next_placement(self):
        if INIT_METHOD != 2:
            return None
        if self._get_worker_position(1) == (-1, -1):
            return (0, 1)
        if self._get_worker_position(2) == (-1, -1):
            return (0, 2)
        if self._get_worker_position(-1) == (-1, -1):
            return (1, -1)
        if self._get_worker_position(-2) == (-1, -1):
            return (1, -2)
        return None

    def _get_worker_position(self, searched_worker):
        locations = np.argwhere(self.workers == searched_worker)
        if locations.size == 0:
            return (-1, -1)
        return tuple(locations[0])

    def _apply_direction(self, position, direction):
        delta = DIRECTIONS[direction]
        return (position[0] + delta[0], position[1] + delta[1])

    def _able_to_move_worker_to(self, old_position, new_position, player):
        if old_position == new_position:
            return True
        if not (0 <= new_position[0] < 5 and 0 <= new_position[1] < 5):
            return False
        if self.workers[new_position] != 0:
            return False
        new_level = self.levels[new_position]
        if new_level > 3:
            return False
        old_level = self.levels[old_position]
        if new_level > old_level + 1:
            return False
        return True

    def _able_to_build(self, position, ignore=0):
        if not (0 <= position[0] < 5 and 0 <= position[1] < 5):
            return False
        occupant = self.workers[position]
        if occupant != 0 and occupant != ignore:
            return False
        if self.levels[position] >= 4:
            return False
        return True
