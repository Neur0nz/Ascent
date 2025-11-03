import gamePyUrl from '@/assets/santorini/Game.py?url';
import proxyPyUrl from '@/assets/santorini/proxy.py?url';
import santoriniGamePyUrl from '@/assets/santorini/SantoriniGame.py?url';
import santoriniDisplayPyUrl from '@/assets/santorini/SantoriniDisplay.py?url';
import santoriniLogicNumbaPyUrl from '@/assets/santorini/SantoriniLogicNumba.py?url';
import santoriniConstantsPyUrl from '@/assets/santorini/SantoriniConstants.py?url';
import mctsPyUrl from '@/assets/santorini/MCTS.py?url';
import modelUrl from '@/assets/santorini/model_no_god.onnx?url';

export interface SantoriniPythonModule {
  url: string;
  filename: string;
}

export const SANTORINI_PY_MODULES: SantoriniPythonModule[] = [
  { url: gamePyUrl, filename: 'Game.py' },
  { url: proxyPyUrl, filename: 'proxy.py' },
  { url: mctsPyUrl, filename: 'MCTS.py' },
  { url: santoriniDisplayPyUrl, filename: 'SantoriniDisplay.py' },
  { url: santoriniGamePyUrl, filename: 'SantoriniGame.py' },
  { url: santoriniLogicNumbaPyUrl, filename: 'SantoriniLogicNumba.py' },
  { url: santoriniConstantsPyUrl, filename: 'SantoriniConstants.py' },
];

export const SANTORINI_MODEL_URL = modelUrl;
