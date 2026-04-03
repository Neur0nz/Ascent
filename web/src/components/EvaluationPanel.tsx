import {
  Box,
  Button,
  Collapse,
  Flex,
  Heading,
  HStack,
  Link,
  Progress,
  Select,
  Stack,
  Text,
  useDisclosure,
  useColorModeValue,
} from '@chakra-ui/react';
import { ChevronDownIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { EvaluationState, EvaluationStatus, TopMove } from '@hooks/useSantorini';

interface EvaluationPanelProps {
  loading: boolean;
  evaluation: EvaluationState;
  evaluationStatus: EvaluationStatus;
  topMoves: TopMove[];
  calcOptionsBusy: boolean;
  evaluationDepth: number | null;
  optionsDepth: number | null;
  refreshEvaluation: () => Promise<EvaluationState | null>;
  calculateOptions: () => Promise<void>;
  updateEvaluationDepth: (depth: number | null) => void;
  updateOptionsDepth: (depth: number | null) => void;
}

const DEPTH_OPTIONS = [
  { label: 'Use AI setting', value: 'ai' },
  { label: 'Easy (50)', value: '50' },
  { label: 'Medium (200)', value: '200' },
  { label: 'Native (800)', value: '800' },
  { label: 'Boosted (3200)', value: '3200' },
] as const;

const getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const EVAL_PROGRESS_TICK_MS = 2500;

// ── Evaluation Bar (memoized) ──────────────────────────────────────────
const EvaluationBar = memo(function EvaluationBar({ value }: { value: number }) {
  const safeValue = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  const positiveWidth = safeValue > 0 ? safeValue * 50 : 0;
  const negativeWidth = safeValue < 0 ? Math.abs(safeValue) * 50 : 0;
  const trackBg = useColorModeValue('gray.200', 'whiteAlpha.300');
  const centerLineColor = useColorModeValue('gray.500', 'whiteAlpha.700');

  return (
    <Box
      position="relative"
      height="12px"
      borderRadius="full"
      overflow="hidden"
      bg={trackBg}
    >
      <Box
        position="absolute"
        top={0}
        bottom={0}
        left="50%"
        width="1px"
        bg={centerLineColor}
        opacity={0.6}
      />
      {negativeWidth > 0 && (
        <Box
          position="absolute"
          top={0}
          bottom={0}
          right="50%"
          width={`${negativeWidth}%`}
          bgGradient="linear(to-l, red.400, red.500)"
          borderTopLeftRadius="full"
          borderBottomLeftRadius="full"
          transition="width 0.3s ease"
        />
      )}
      {positiveWidth > 0 && (
        <Box
          position="absolute"
          top={0}
          bottom={0}
          left="50%"
          width={`${positiveWidth}%`}
          bgGradient="linear(to-r, green.400, green.500)"
          borderTopRightRadius="full"
          borderBottomRightRadius="full"
          transition="width 0.3s ease"
        />
      )}
    </Box>
  );
});

// ── Top Moves List (memoized) ──────────────────────────────────────────
const TopMovesList = memo(function TopMovesList({
  topMoves,
  panelBorder,
  moveBg,
  mutedText,
  strongText,
}: {
  topMoves: TopMove[];
  panelBorder: string;
  moveBg: string;
  mutedText: string;
  strongText: string;
}) {
  if (topMoves.length === 0) {
    return (
      <Text fontSize="sm" color={mutedText}>
        Run a calculation to see detailed options.
      </Text>
    );
  }

  return (
    <>
      {topMoves.map((move, index) => {
        const clampedProb = Math.max(0, Math.min(move.prob, 1));
        const percentValue = clampedProb * 100;
        const percentLabel =
          percentValue >= 0.1
            ? `${percentValue.toFixed(1)}%`
            : percentValue > 0
            ? '<0.1%'
            : '0%';

        return (
          <Box
            key={`${move.action}-${index}`}
            borderWidth="1px"
            borderRadius="md"
            borderColor={panelBorder}
            p={3}
            bg={moveBg}
          >
            <Text fontWeight="medium">{move.text}</Text>
            <Flex align="center" justify="space-between" mt={2} gap={3}>
              <Progress
                value={percentValue}
                colorScheme="teal"
                borderRadius="full"
                flex="1"
                height="6px"
              />
              <Text fontSize="sm" color={strongText} minW="48px" textAlign="right">
                {percentLabel}
              </Text>
            </Flex>
            {typeof move.eval === 'number' && (
              <Text fontSize="sm" color={mutedText} mt={2}>
                Eval: {move.eval >= 0 ? `+${move.eval.toFixed(2)}` : move.eval.toFixed(2)}
                {typeof move.delta === 'number' && Math.abs(move.delta) >= 0.005
                  ? ` (Δ ${move.delta >= 0 ? '+' : ''}${move.delta.toFixed(2)})`
                  : ''}
              </Text>
            )}
          </Box>
        );
      })}
    </>
  );
});

// ── Progress section (extracted to reduce main component complexity) ───
function useEvaluationProgress(evaluationStatus: EvaluationStatus) {
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | null>(null);
  const runStartedAt = evaluationStatus.state === 'running' ? evaluationStatus.startedAt : null;

  useEffect(() => {
    if (evaluationStatus.state !== 'running' || runStartedAt == null) {
      setLiveElapsedMs(null);
      return;
    }
    const update = () => setLiveElapsedMs(Math.max(0, getNow() - runStartedAt));
    update();
    const interval = setInterval(update, EVAL_PROGRESS_TICK_MS);
    return () => clearInterval(interval);
  }, [evaluationStatus.state, runStartedAt]);

  const statusSims = 'sims' in evaluationStatus ? evaluationStatus.sims : undefined;
  const statusDurationMs =
    evaluationStatus.state === 'running' || evaluationStatus.state === 'success' || evaluationStatus.state === 'error'
      ? evaluationStatus.durationMs
      : undefined;

  const expectedMs = useMemo(
    () => (statusSims && statusSims > 0 ? Math.max(1200, statusSims * 6) : 2000),
    [statusSims],
  );

  const elapsedMs =
    evaluationStatus.state === 'running'
      ? liveElapsedMs ?? (runStartedAt != null ? Math.max(0, getNow() - runStartedAt) : 0)
      : statusDurationMs ?? null;

  // Use asymptotic curve instead of hard cap at 95% for smoother UX
  const progress = useMemo(() => {
    if (evaluationStatus.state === 'success') return 100;
    if (evaluationStatus.state !== 'running') return 0;
    const ratio = (elapsedMs ?? 0) / expectedMs;
    // Asymptotic: approaches 99% but never hits it until complete
    return Math.min(99, ratio <= 1 ? ratio * 90 : 90 + (1 - Math.exp(-(ratio - 1))) * 9);
  }, [evaluationStatus.state, elapsedMs, expectedMs]);

  const statusLabel = useMemo(() => {
    switch (evaluationStatus.state) {
      case 'running':
        return 'Evaluating position...';
      case 'success':
        return 'Evaluation ready';
      case 'error':
        return `Evaluation failed${evaluationStatus.message ? `: ${evaluationStatus.message}` : ''}`;
      default:
        return 'Idle';
    }
  }, [evaluationStatus.state, evaluationStatus.state === 'error' ? evaluationStatus.message : null]);

  return { progress, statusLabel, statusSims, isRunning: evaluationStatus.state === 'running' };
}

// ── Depth selector helper ──────────────────────────────────────────────
function resolveDepthOptions(depth: number | null) {
  const selectValue = depth == null ? 'ai' : String(depth);
  const hasCustom = depth != null && !DEPTH_OPTIONS.some((opt) => opt.value === selectValue);
  const options = hasCustom
    ? [...DEPTH_OPTIONS, { label: `Custom (${depth})`, value: selectValue }]
    : DEPTH_OPTIONS;
  return { selectValue, options };
}

// ── Main Component ─────────────────────────────────────────────────────
function EvaluationPanel({
  loading,
  evaluation,
  evaluationStatus,
  topMoves,
  calcOptionsBusy,
  evaluationDepth,
  optionsDepth,
  refreshEvaluation,
  calculateOptions,
  updateEvaluationDepth,
  updateOptionsDepth,
}: EvaluationPanelProps) {
  const disclosure = useDisclosure({ defaultIsOpen: true });
  const movesDisclosure = useDisclosure({ defaultIsOpen: false });
  const panelGradient = useColorModeValue('linear(to-br, gray.50, white)', 'linear(to-br, blackAlpha.500, blackAlpha.400)');
  const panelBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const mutedText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const strongText = useColorModeValue('gray.800', 'whiteAlpha.800');
  const moveBg = useColorModeValue('gray.50', 'whiteAlpha.100');

  const { progress, statusLabel, statusSims, isRunning } = useEvaluationProgress(evaluationStatus);
  const evalDepth = resolveDepthOptions(evaluationDepth);
  const optDepth = resolveDepthOptions(optionsDepth);

  const handleEvalDepthChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      updateEvaluationDepth(value === 'ai' ? null : Number(value));
    },
    [updateEvaluationDepth],
  );

  const handleOptionsDepthChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      updateOptionsDepth(value === 'ai' ? null : Number(value));
    },
    [updateOptionsDepth],
  );

  const panelMinHeight = disclosure.isOpen
    ? movesDisclosure.isOpen ? '360px' : 'auto'
    : 'auto';

  const creditLink = (
    <Link
      href="https://github.com/cestpasphoto/alpha-zero-general"
      isExternal
      color="teal.500"
      fontWeight="medium"
      _hover={{ textDecoration: 'underline' }}
    >
      cestpasphoto
    </Link>
  );

  return (
    <Box
      borderRadius="lg"
      borderWidth="1px"
      borderColor={panelBorder}
      bgGradient={panelGradient}
      px={disclosure.isOpen ? { base: 5, md: 6 } : 3}
      py={disclosure.isOpen ? { base: 4, md: 5 } : 3}
      minH={panelMinHeight}
      boxShadow="dark-lg"
      transition="all 0.3s ease"
    >
      {disclosure.isOpen ? (
        <>
          <Flex
            direction={{ base: 'column', md: 'row' }}
            align={{ base: 'flex-start', md: 'center' }}
            justify="space-between"
            gap={{ base: 3, md: 0 }}
            mb={4}
          >
            <Box>
              <Heading size="md">AI Evaluation</Heading>
              <Text fontSize="xs" color={mutedText} mt={1}>
                by {creditLink}
              </Text>
            </Box>
            <Flex
              flexWrap="wrap"
              justify={{ base: 'flex-start', md: 'flex-end' }}
              rowGap={2}
              columnGap={3}
              minW={0}
            >
              <Select
                size="sm"
                maxW="160px"
                width={{ base: '100%', sm: 'auto' }}
                value={evalDepth.selectValue}
                onChange={handleEvalDepthChange}
                aria-label="Evaluation depth"
                title="Evaluation depth"
              >
                {evalDepth.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" onClick={disclosure.onToggle}>
                Hide
              </Button>
              <Button
                size="sm"
                colorScheme="teal"
                onClick={refreshEvaluation}
                isLoading={loading || isRunning}
                isDisabled={isRunning}
              >
                Refresh
              </Button>
            </Flex>
          </Flex>
          <Collapse in={disclosure.isOpen} animateOpacity>
            <Stack spacing={5}>
              <Box>
                <Text fontSize="xs" color={mutedText}>
                  {statusLabel}
                  {isRunning && statusSims ? ` • ~${statusSims} sims` : ''}
                </Text>
                {(isRunning || evaluationStatus.state === 'success') && (
                  <Progress
                    mt={2}
                    size="xs"
                    colorScheme="teal"
                    value={progress}
                    isIndeterminate={isRunning && !statusSims}
                    transition="value 0.5s ease"
                  />
                )}
              </Box>
              <Box>
                <EvaluationBar value={evaluation.value} />
                <Flex mt={2} align={{ base: 'flex-start', sm: 'center' }} gap={3} flexWrap="wrap">
                  <Text fontSize="2xl" fontWeight="bold">
                    {evaluation.label}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={movesDisclosure.onToggle}
                    leftIcon={movesDisclosure.isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  >
                    {movesDisclosure.isOpen ? 'Hide Best Moves' : 'Show Best Moves'}
                  </Button>
                </Flex>
              </Box>
              <Box mt={movesDisclosure.isOpen ? 0 : -6}>
                <Collapse in={movesDisclosure.isOpen} animateOpacity>
                  <Box mt={2} maxH="240px" overflowY="auto" pr={1}>
                    <Stack spacing={3}>
                      <HStack spacing={2} align="center" flexWrap="wrap">
                        <Select
                          size="sm"
                          maxW="180px"
                          value={optDepth.selectValue}
                          onChange={handleOptionsDepthChange}
                          aria-label="Best move analysis depth"
                          title="Best move analysis depth"
                        >
                          {optDepth.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                        <Button size="sm" colorScheme="purple" onClick={calculateOptions} isLoading={calcOptionsBusy}>
                          Run analysis
                        </Button>
                      </HStack>
                      <TopMovesList
                        topMoves={topMoves}
                        panelBorder={panelBorder}
                        moveBg={moveBg}
                        mutedText={mutedText}
                        strongText={strongText}
                      />
                    </Stack>
                  </Box>
                </Collapse>
              </Box>
            </Stack>
          </Collapse>
        </>
      ) : (
        <Flex justify="space-between" align="center">
          <Box>
            <Heading size="sm" color={strongText}>
              AI Evaluation
            </Heading>
            <Text fontSize="xs" color={mutedText} mt={0.5}>
              by {creditLink}
            </Text>
          </Box>
          <Button size="sm" colorScheme="teal" onClick={disclosure.onToggle}>
            Show
          </Button>
        </Flex>
      )}
    </Box>
  );
}

export default EvaluationPanel;
