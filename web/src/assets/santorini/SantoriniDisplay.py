import numpy as np
try:
        from colorama import Style, Fore, Back
except Exception:
        class _DummyStyle:
                RESET_ALL = ''
                DIM = ''
        class _DummyFore:
                WHITE = ''
                BLUE = ''
                CYAN = ''
                YELLOW = ''
                MAGENTA = ''
                GREEN = ''
                RED = ''
        Style = _DummyStyle()
        Fore = _DummyFore()
        class _DummyBack:
                BLACK = ''
        Back = _DummyBack()

# Try package-relative first (when imported as module), then absolute (when loaded flat in Pyodide)
try:
        from .SantoriniConstants import _decode_action
except Exception:
        from SantoriniConstants import _decode_action

my_workers_color    = [Fore.WHITE, Fore.BLUE  , Fore.CYAN]
other_workers_color = [Fore.WHITE, Fore.YELLOW, Fore.MAGENTA]
levels_char = ['◎', '▂', '▅', '█', 'X']
directions_char = ['↖', '↑', '↗', '←', 'Ø', '→', '↙', '↓', '↘']

# Global variable to store evaluation values
_current_eval = None

def set_eval(eval_values):
        """Set the current evaluation values to be displayed."""
        global _current_eval
        _current_eval = eval_values

def get_eval_bar(value, width=40):
        """Create a visual evaluation bar.

        Args:
                value: Evaluation value from -1 to 1 (perspective of current player)
                width: Total width of the bar

        Returns:
                Colored string representation of the evaluation
        """
        normalized = (value + 1) / 2
        filled = int(normalized * width)
        empty = width - filled

        if value > 0.6:
                color = Fore.GREEN
        elif value > 0.2:
                color = Fore.CYAN
        elif value > -0.2:
                color = Fore.YELLOW
        elif value > -0.6:
                color = Fore.MAGENTA
        else:
                color = Fore.RED

        bar = color + '█' * filled + Style.DIM + '░' * empty + Style.RESET_ALL
        percentage = int(normalized * 100)

        return f'[{bar}] {value:+.3f} ({percentage}%)'

def move_to_str(move, player):
        worker, power, move_direction, build_direction = _decode_action(move)
        worker_color = my_workers_color[worker+1] if player == 0 else other_workers_color[worker+1]
        return (
                f"Move {worker_color}worker {worker+1}{Style.RESET_ALL} to "
                f"{directions_char[move_direction]} and then build {directions_char[build_direction]}"
        )

############################# PRINT GAME ######################################

def _print_colors(board):
        message  = f'Player 0: '
        message += f'{my_workers_color[1]}worker 1  {my_workers_color[2]}worker 2{Style.RESET_ALL} '
        message += '(no god powers)    '
        message += f'Player 1: '
        message += f'{other_workers_color[1]}worker 1  {other_workers_color[2]}worker 2{Style.RESET_ALL} '
        message += '(no god powers)'
        print(message)

def _print_main(board):
        print(f'-'*11)
        for y in range(5):
                for x in range(5):
                        worker, level = board.workers[y, x], board.levels[y, x]
                        worker_color = my_workers_color[worker] if worker >= 0 else other_workers_color[-worker]
                        if worker != 0 or level > 0:
                                print(f'|{worker_color}{levels_char[level]}{Style.RESET_ALL}', end='')
                        else:
                                print(f'| ', end='')
                print('|')
                print(f'-'*11)

def print_board(board):
        global _current_eval
        print()

        if _current_eval is not None:
                print('╔═══════════════════════════════════════════════════════════════════════════╗')
                print('║ AI EVALUATION                                                             ║')
                print('╠═══════════════════════════════════════════════════════════════════════════╣')

                player0_eval = _current_eval[0] if isinstance(_current_eval, (list, np.ndarray)) else _current_eval

                eval_str = get_eval_bar(player0_eval, width=50)
                print(f'║ Player 0 (You):     {eval_str}    ║')

                if isinstance(_current_eval, (list, np.ndarray)) and len(_current_eval) > 1:
                        player1_eval = _current_eval[1]
                        eval_str = get_eval_bar(player1_eval, width=50)
                        print(f'║ Player 1 (Opponent): {eval_str}   ║')

                print('╚═══════════════════════════════════════════════════════════════════════════╝')
                print()

        _print_colors(board)
        _print_main(board)
