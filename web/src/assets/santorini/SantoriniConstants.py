import numpy as np

NO_MOVE = 4
NO_BUILD = 4

NO_GOD = 0
NB_GODS = 1


def _decode_action(action):
    worker, action_ = divmod(action, NB_GODS * 9 * 9)
    power, action_ = divmod(action_, 9 * 9)
    move_direction, build_direction = divmod(action_, 9)
    return worker, power, move_direction, build_direction


def _encode_action(worker, power, move_direction, build_direction):
    action = NB_GODS * 9 * 9 * worker + 9 * 9 * power + 9 * move_direction + build_direction
    return action


def _generate_permutation(permutation):
    result = []
    for i in range(NB_GODS * 2 * 9 * 9):
        worker, power, move_direction, build_direction = _decode_action(i)
        new_move_direction = permutation[move_direction]
        new_build_direction = permutation[build_direction]
        new_i = _encode_action(worker, power, new_move_direction, new_build_direction)
        result.append(new_i)
    return result


rotation_core = np.array([6, 3, 0, 7, 4, 1, 8, 5, 2], dtype=np.int16)
rotation = np.array(_generate_permutation(rotation_core), dtype=np.int16)

flipLR_core = np.array([2, 1, 0, 5, 4, 3, 8, 7, 6], dtype=np.int16)
flipLR = np.array(_generate_permutation(flipLR_core), dtype=np.int16)

flipUD_core = np.array([6, 7, 8, 3, 4, 5, 0, 1, 2], dtype=np.int16)
flipUD = np.array(_generate_permutation(flipUD_core), dtype=np.int16)
