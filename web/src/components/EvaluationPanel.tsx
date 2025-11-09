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

const depthOptions = [
  { label: 'Use AI setting', value: 'ai' },
  { label: 'Easy (50)', value: '50' },
  { label: 'Medium (200)', value: '200' },
  { label: 'Native (800)', value: '800' },
  { label: 'Boosted (3200)', value: '3200' },
];

function EvaluationBar({ value }: { value: number }) {
  const safeValue = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  const positiveWidth = safeValue > 0 ? safeValue * 50 : 0;
  const negativeWidth = safeValue < 0 ? Math.abs(safeValue) * 50 : 0;
  const trackBg = useColorModeValue('gray.200', 'whiteAlpha.300');
  const centerLineColor = useColorModeValue('gray.400', 'whiteAlpha.600');

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
}

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
  const subtleText = useColorModeValue('gray.500', 'whiteAlpha.600');
  const strongText = useColorModeValue('gray.800', 'whiteAlpha.800');
  const moveBg = useColorModeValue('gray.50', 'whiteAlpha.100');
  const evalSelectValue = evaluationDepth == null ? 'ai' : String(evaluationDepth);
  const resolvedEvalOptions =
    evaluationDepth != null && !depthOptions.some((option) => option.value === evalSelectValue)
      ? [...depthOptions, { label: `Custom (${evaluationDepth})`, value: evalSelectValue }]
      : depthOptions;
  const optionsSelectValue = optionsDepth == null ? 'ai' : String(optionsDepth);
  const resolvedOptionsDepth =
    optionsDepth != null && !depthOptions.some((option) => option.value === optionsSelectValue)
      ? [...depthOptions, { label: `Custom (${optionsDepth})`, value: optionsSelectValue }]
      : depthOptions;
  const panelMinHeight = disclosure.isOpen
    ? movesDisclosure.isOpen
      ? '360px'
      : 'auto'
    : 'auto';
  const runningEval = evaluationStatus.state === 'running';
  const statusSims = 'sims' in evaluationStatus ? evaluationStatus.sims : undefined;
  const statusDurationMs =
    evaluationStatus.state === 'running' || evaluationStatus.state === 'success' || evaluationStatus.state === 'error'
      ? evaluationStatus.durationMs
      : undefined;
  const expectedMs =
    statusSims && statusSims > 0
      ? Math.max(1200, statusSims * 6)
      : 2000;
  const elapsedMs = statusDurationMs;
  const elapsedLabel =
    elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : evaluationStatus.state === 'success' ? 'Just updated' : null;
  const evaluationProgress =
    evaluationStatus.state === 'success'
      ? 100
      : evaluationStatus.state === 'running'
        ? Math.min(95, ((statusDurationMs ?? 0) / expectedMs) * 100)
        : 0;
  const statusLabel = (() => {
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
  })();

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
          <Flex justify="space-between" align="center" mb={4}>
            <Box>
              <Heading size="md">AI Evaluation</Heading>
              <Text fontSize="xs" color={mutedText} mt={1}>
                by{' '}
                <Link
                  href="https://github.com/cestpasphoto/alpha-zero-general"
                  isExternal
                  color="teal.500"
                  fontWeight="medium"
                  _hover={{ textDecoration: 'underline' }}
                >
                  cestpasphoto
                </Link>
              </Text>
            </Box>
            <HStack spacing={3}>
              <Select
                size="sm"
                maxW="160px"
                value={evalSelectValue}
                onChange={(event) => {
                  const value = event.target.value;
                  updateEvaluationDepth(value === 'ai' ? null : Number(value));
                }}
                aria-label="Evaluation depth"
                title="Evaluation depth"
              >
                {resolvedEvalOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" onClick={disclosure.onToggle}>
                Hide
              </Button>
              <Button size="sm" colorScheme="teal" onClick={refreshEvaluation} isLoading={loading || runningEval} isDisabled={runningEval}>
                Refresh
              </Button>
            </HStack>
          </Flex>
          <Collapse in={disclosure.isOpen} animateOpacity>
            <Stack spacing={5}>
              <Box>
                <Text fontSize="xs" color={subtleText}>
                  {statusLabel}
                  {elapsedLabel ? ` • ${elapsedLabel}` : ''}
                  {evaluationStatus.state === 'running' && statusSims ? ` • ~${statusSims} sims` : ''}
                </Text>
                {(evaluationStatus.state === 'running' || evaluationStatus.state === 'success') && (
                  <Progress
                    mt={2}
                    size="xs"
                    colorScheme="teal"
                    value={evaluationProgress}
                    isIndeterminate={runningEval && !statusSims}
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
          <Box>
            <Collapse in={movesDisclosure.isOpen} animateOpacity>
              <Stack spacing={3} mt={2}>
                <HStack spacing={2} align="center" flexWrap="wrap">
                  <Select
                    size="sm"
                    maxW="180px"
                    value={optionsSelectValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateOptionsDepth(value === 'ai' ? null : Number(value));
                    }}
                    aria-label="Best move analysis depth"
                    title="Best move analysis depth"
                  >
                    {resolvedOptionsDepth.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" colorScheme="purple" onClick={calculateOptions} isLoading={calcOptionsBusy}>
                    Analyze
                  </Button>
                </HStack>
                {topMoves.length === 0 && (
                  <Text fontSize="sm" color={subtleText}>
                    Run a calculation to see detailed options.
                  </Text>
                )}
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
              </Stack>
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
            <Text fontSize="xs" color={subtleText} mt={0.5}>
              by{' '}
              <Link
                href="https://github.com/cestpasphoto/alpha-zero-general"
                isExternal
                color="teal.500"
                fontWeight="medium"
                _hover={{ textDecoration: 'underline' }}
              >
                cestpasphoto
              </Link>
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
