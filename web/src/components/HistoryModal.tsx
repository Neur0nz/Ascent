import {
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  HStack,
  SimpleGrid,
  Stack,
  Tag,
  TagLabel,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import type { MoveSummary } from '@hooks/useSantorini';

const COORD_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

const coordinateLabel = (position?: [number, number] | null): string => {
  if (!position) return '—';
  const [y, x] = position;
  if (y < 0 || x < 0 || y >= 5 || x >= 5) return '—';
  return `${COORD_LABELS[x]}${y + 1}`;
};

const workerSymbol = (worker: number, level: number): string => {
  if (worker === 0) {
    return level > 0 ? `L${level}` : '·';
  }
  const playerPrefix = worker > 0 ? 'B' : 'R';
  const index = Math.abs(worker) === 1 ? '1' : '2';
  return `${playerPrefix}${index}`;
};

function HistoryBoardPreview({
  board,
  from,
  to,
  build,
}: {
  board: number[][][] | null;
  from?: [number, number];
  to?: [number, number];
  build?: [number, number] | null;
}) {
  const cellBg = useColorModeValue('gray.100', 'gray.700');
  const cellColor = useColorModeValue('gray.800', 'whiteAlpha.900');
  const highlightTo = useColorModeValue('teal.500', 'teal.300');
  const highlightFrom = useColorModeValue('orange.500', 'orange.300');
  const highlightBuild = useColorModeValue('purple.500', 'purple.400');
  const gridBg = useColorModeValue('gray.50', 'blackAlpha.500');
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.200');

  if (!board) {
    return null;
  }

  return (
    <SimpleGrid
      columns={5}
      spacing={1}
      p={2}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="md"
      bg={gridBg}
    >
      {board.map((row, y) =>
        row.map((cell, x) => {
          const worker = cell[0];
          const level = cell[1];
          const isFrom = from && from[0] === y && from[1] === x;
          const isTo = to && to[0] === y && to[1] === x;
          const isBuild = build && build[0] === y && build[1] === x;
          const background = isTo ? highlightTo : isFrom ? highlightFrom : isBuild ? highlightBuild : cellBg;
          const color = isTo || isFrom || isBuild ? 'white' : cellColor;
          return (
            <Box
              key={`${y}-${x}`}
              borderRadius="sm"
              textAlign="center"
              py={2}
              bg={background}
              color={color}
            >
              <Text fontWeight="bold" fontSize="sm">
                {workerSymbol(worker, level)}
              </Text>
              <Text fontSize="xs" opacity={0.75}>
                {coordinateLabel([y, x])}
              </Text>
            </Box>
          );
        }),
      )}
    </SimpleGrid>
  );
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: MoveSummary[];
  jumpToMove: (index: number) => Promise<void>;
}

function HistoryModal({ isOpen, onClose, history, jumpToMove }: HistoryModalProps) {
  const handleJump = async (index: number) => {
    await jumpToMove(index);
    onClose();
  };

  const drawerBg = useColorModeValue('white', 'gray.800');
  const secondaryTextColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const cardBorder = useColorModeValue('gray.200', 'whiteAlpha.200');

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right" size="md">
      <DrawerOverlay />
      <DrawerContent bg={drawerBg}>
        <DrawerCloseButton />
        <DrawerHeader fontWeight="bold">Move history</DrawerHeader>
        <DrawerBody>
          <Stack spacing={4}>
            {history.length === 0 && <Text color={secondaryTextColor}>No moves recorded yet.</Text>}
            {history.map((move, index) => {
              const playerLabel = move.player === 0 ? 'Green' : 'Red';
              const phaseLabel = move.phase === 'placement' ? 'Placement' : move.phase === 'move' ? 'Move' : 'State';
              const metadata: string[] = [];
              if (move.phase === 'placement') {
                metadata.push(`Placed on ${coordinateLabel(move.to)}`);
              } else if (move.phase === 'move') {
                metadata.push(`From ${coordinateLabel(move.from)}`);
                metadata.push(`To ${coordinateLabel(move.to)}`);
                if (move.build) {
                  metadata.push(`Build ${coordinateLabel(move.build)}`);
                }
              }

              return (
                <Box key={`history-${index}`} borderWidth="1px" borderColor={cardBorder} borderRadius="md" p={4}>
                  <Stack spacing={2}>
                    <HStack justify="space-between">
                      <Text fontWeight="semibold">Move {index + 1}</Text>
                      <Tag colorScheme={move.player === 0 ? 'green' : 'red'}>
                        <TagLabel>{playerLabel}</TagLabel>
                      </Tag>
                    </HStack>
                    <Text>{move.description}</Text>
                    <HStack spacing={3} flexWrap="wrap" fontSize="sm" color={secondaryTextColor}>
                      <Text>{phaseLabel}</Text>
                      {metadata.map((entry) => (
                        <Text key={entry}>{entry}</Text>
                      ))}
                    </HStack>
                    <HistoryBoardPreview
                      board={move.boardAfter ?? move.boardBefore ?? null}
                      from={move.phase === 'move' ? move.from : undefined}
                      to={move.to}
                      build={move.build}
                    />
                    <Button
                      size="sm"
                      alignSelf="flex-start"
                      onClick={() => handleJump(index)}
                    >
                      Jump to this move
                    </Button>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </DrawerBody>
        <DrawerFooter>
          <HStack spacing={3} w="100%" justify="space-between">
            <Button variant="ghost" onClick={() => history.length > 0 && handleJump(0)} isDisabled={history.length === 0}>
              Go to start
            </Button>
            <Button
              colorScheme="teal"
              onClick={() => history.length > 0 && handleJump(history.length - 1)}
              isDisabled={history.length === 0}
            >
              Go to end
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export default HistoryModal;
