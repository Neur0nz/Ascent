import { useCallback, useEffect, useReducer } from 'react';
import {
  Alert,
  AlertIcon,
  Button,
  FormControl,
  FormLabel,
  FormHelperText,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Text,
  Tooltip,
  useToast,
} from '@chakra-ui/react';
import type { CreateMatchPayload, LobbyMatch, StartingPlayer, MatchOpponentType } from '@hooks/useMatchLobby';
import { useSurfaceTokens } from '@/theme/useSurfaceTokens';

const ALLOW_ONLINE_AI_MATCHES = true;
const MIN_AI_DEPTH = 1;
const MAX_AI_DEPTH = 5000;

// ── Form state reducer ─────────────────────────────────────────────────
interface MatchFormState {
  visibility: 'public' | 'private';
  rated: boolean;
  hasClock: boolean;
  minutes: string;
  increment: string;
  startingPlayer: StartingPlayer;
  opponentType: MatchOpponentType;
  aiDepth: number;
  submitting: boolean;
}

type MatchFormAction =
  | { type: 'SET_FIELD'; field: keyof MatchFormState; value: MatchFormState[keyof MatchFormState] }
  | { type: 'SET_AI_MODE'; enabled: boolean }
  | { type: 'SET_SUBMITTING'; value: boolean }
  | { type: 'RESET' };

const initialFormState: MatchFormState = {
  visibility: 'public',
  rated: true,
  hasClock: true,
  minutes: '10',
  increment: '5',
  startingPlayer: 'random',
  opponentType: 'human',
  aiDepth: 200,
  submitting: false,
};

function formReducer(state: MatchFormState, action: MatchFormAction): MatchFormState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_AI_MODE':
      if (action.enabled) {
        return { ...state, opponentType: 'ai', rated: false, hasClock: false };
      }
      return { ...state, opponentType: 'human' };
    case 'SET_SUBMITTING':
      return { ...state, submitting: action.value };
    case 'RESET':
      return initialFormState;
    default:
      return state;
  }
}

// ── Props ──────────────────────────────────────────────────────────────
export interface MatchCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: CreateMatchPayload) => Promise<LobbyMatch | void>;
  loading: boolean;
}

// ── Component ──────────────────────────────────────────────────────────
export function MatchCreationModal({ isOpen, onClose, onCreate, loading }: MatchCreationModalProps) {
  const [form, dispatch] = useReducer(formReducer, initialFormState);
  const isAiMatch = form.opponentType === 'ai';
  const toast = useToast();
  const { mutedText } = useSurfaceTokens();

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      dispatch({ type: 'RESET' });
    }
  }, [isOpen]);

  // Enforce AI constraints via reducer instead of cascading effects
  useEffect(() => {
    if (!ALLOW_ONLINE_AI_MATCHES && form.opponentType === 'ai') {
      dispatch({ type: 'SET_AI_MODE', enabled: false });
    }
  }, [form.opponentType]);

  const buildPayload = useCallback((): CreateMatchPayload => {
    const clampedDepth = Math.max(MIN_AI_DEPTH, Math.min(MAX_AI_DEPTH, Math.round(form.aiDepth)));
    const resolvedMinutes = Math.max(1, Math.round(Number(form.minutes) || 0));
    const resolvedIncrement = Math.max(0, Math.round(Number(form.increment) || 0));
    return {
      visibility: isAiMatch ? 'private' : form.visibility,
      rated: isAiMatch ? false : form.rated,
      hasClock: isAiMatch ? false : form.hasClock,
      clockInitialMinutes: isAiMatch ? 0 : resolvedMinutes,
      clockIncrementSeconds: isAiMatch ? 0 : resolvedIncrement,
      startingPlayer: form.startingPlayer,
      opponentType: form.opponentType,
      aiDepth: isAiMatch ? clampedDepth : undefined,
    };
  }, [form, isAiMatch]);

  const handleSubmit = useCallback(async () => {
    if (form.submitting) return;
    dispatch({ type: 'SET_SUBMITTING', value: true });
    try {
      await onCreate(buildPayload());
      toast({
        title: isAiMatch ? 'AI match started!' : 'Match created successfully!',
        status: 'success',
      });
      onClose();
    } catch (error) {
      toast({
        title: 'Unable to create match',
        status: 'error',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      dispatch({ type: 'SET_SUBMITTING', value: false });
    }
  }, [form.submitting, buildPayload, onCreate, onClose, toast, isAiMatch]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Create New Match</ModalHeader>
        <ModalCloseButton />
        <ModalBody as={Stack} spacing={4}>
          {/* Opponent type */}
          <FormControl as={Stack} spacing={2}>
            <FormLabel fontSize="sm">Opponent</FormLabel>
            <RadioGroup
              value={form.opponentType}
              onChange={(value) =>
                dispatch({ type: 'SET_AI_MODE', enabled: value === 'ai' })
              }
            >
              <HStack spacing={4}>
                <Radio value="human">Real player</Radio>
                <Tooltip
                  label="Play an unrated match against the built-in Santorini AI (no clock)."
                  hasArrow
                >
                  <Radio value="ai" isDisabled={!ALLOW_ONLINE_AI_MATCHES}>
                    Santorini AI
                  </Radio>
                </Tooltip>
              </HStack>
            </RadioGroup>
          </FormControl>

          {!ALLOW_ONLINE_AI_MATCHES && (
            <Alert status="warning" borderRadius="md">
              <AlertIcon />
              <Text fontSize="sm">
                AI opponents for online matches are disabled while we fix some issues. Try the Practice tab for AI play.
              </Text>
            </Alert>
          )}
          {ALLOW_ONLINE_AI_MATCHES && isAiMatch && (
            <Alert status="info" borderRadius="md">
              <AlertIcon />
              <Text fontSize="sm">
                AI matches are unrated, have no clock, and let you pick the search depth.
              </Text>
            </Alert>
          )}

          {/* Visibility */}
          <FormControl as={Stack} spacing={2} isDisabled={isAiMatch}>
            <FormLabel fontSize="sm">Visibility</FormLabel>
            <RadioGroup
              value={form.visibility}
              onChange={(value) =>
                dispatch({ type: 'SET_FIELD', field: 'visibility', value: value as 'public' | 'private' })
              }
            >
              <HStack spacing={4}>
                <Radio value="public">Public lobby</Radio>
                <Radio value="private">Private code</Radio>
              </HStack>
            </RadioGroup>
            {isAiMatch && <FormHelperText>AI games always use a private slot.</FormHelperText>}
          </FormControl>

          {/* Starting player */}
          <FormControl as={Stack} spacing={2}>
            <FormLabel fontSize="sm">Starting player</FormLabel>
            <RadioGroup
              value={form.startingPlayer}
              onChange={(value) =>
                dispatch({ type: 'SET_FIELD', field: 'startingPlayer', value: value as StartingPlayer })
              }
            >
              <HStack spacing={4}>
                <Radio value="creator">You</Radio>
                <Radio value="opponent">Opponent</Radio>
                <Radio value="random">Random</Radio>
              </HStack>
            </RadioGroup>
          </FormControl>

          {/* Rated */}
          <FormControl display="flex" alignItems="center" justifyContent="space-between" isDisabled={isAiMatch}>
            <FormLabel htmlFor="rated-switch" mb="0">
              Rated game (affects ELO)
            </FormLabel>
            <Switch
              id="rated-switch"
              isChecked={form.rated}
              onChange={(e) =>
                dispatch({ type: 'SET_FIELD', field: 'rated', value: e.target.checked })
              }
            />
            {isAiMatch && <FormHelperText>AI matches never affect rating.</FormHelperText>}
          </FormControl>

          {/* Clock */}
          <FormControl display="flex" flexDir="column" gap={3} isDisabled={isAiMatch}>
            <HStack justify="space-between">
              <FormLabel htmlFor="clock-switch" mb="0">
                Enable clock
              </FormLabel>
              <Switch
                id="clock-switch"
                isChecked={form.hasClock}
                onChange={(e) =>
                  dispatch({ type: 'SET_FIELD', field: 'hasClock', value: e.target.checked })
                }
              />
            </HStack>
            {form.hasClock && !isAiMatch && (
              <Stack direction={{ base: 'column', md: 'row' }} spacing={3}>
                <FormControl>
                  <FormLabel fontSize="sm">Initial time (minutes)</FormLabel>
                  <NumberInput
                    min={1}
                    precision={0}
                    step={1}
                    clampValueOnBlur
                    value={form.minutes}
                    onChange={(valueString) =>
                      dispatch({ type: 'SET_FIELD', field: 'minutes', value: valueString })
                    }
                  >
                    <NumberInputField inputMode="numeric" />
                    <NumberInputStepper>
                      <NumberIncrementStepper />
                      <NumberDecrementStepper />
                    </NumberInputStepper>
                  </NumberInput>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="sm">Increment (seconds)</FormLabel>
                  <NumberInput
                    min={0}
                    precision={0}
                    step={1}
                    clampValueOnBlur
                    value={form.increment}
                    onChange={(valueString) =>
                      dispatch({ type: 'SET_FIELD', field: 'increment', value: valueString })
                    }
                  >
                    <NumberInputField inputMode="numeric" />
                    <NumberInputStepper>
                      <NumberIncrementStepper />
                      <NumberDecrementStepper />
                    </NumberInputStepper>
                  </NumberInput>
                </FormControl>
              </Stack>
            )}
            {isAiMatch && (
              <FormHelperText>Clocks are disabled when playing against the AI.</FormHelperText>
            )}
          </FormControl>

          {/* AI depth */}
          {isAiMatch && (
            <FormControl>
              <FormLabel fontSize="sm">AI depth (simulations)</FormLabel>
              <NumberInput
                value={form.aiDepth}
                min={MIN_AI_DEPTH}
                max={MAX_AI_DEPTH}
                step={10}
                onChange={(_, valueNumber) => {
                  if (Number.isFinite(valueNumber)) {
                    dispatch({ type: 'SET_FIELD', field: 'aiDepth', value: Math.round(valueNumber) });
                  }
                }}
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
              <FormHelperText>
                Higher values make the AI slower but stronger. 200 is a good starting point.
              </FormHelperText>
            </FormControl>
          )}

          <Button
            colorScheme="teal"
            onClick={handleSubmit}
            isDisabled={loading || form.submitting}
            isLoading={loading || form.submitting}
            w="full"
            loadingText={isAiMatch ? 'Starting…' : 'Creating…'}
          >
            {isAiMatch ? 'Start AI Match' : 'Create Match'}
          </Button>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} w="full">
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default MatchCreationModal;
