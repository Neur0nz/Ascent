import { memo, useCallback, useMemo, useState } from 'react';
import {
  Box,
  HStack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  SimpleGrid,
  Stack,
  Tag,
  TagLabel,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';

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

// Mini board preview component - optimized for hover use
const MiniBoardPreview = memo(function MiniBoardPreview({
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
  const gridBg = useColorModeValue('gray.50', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'whiteAlpha.200');

  if (!board) {
    return (
      <Text fontSize="xs" color="gray.500" textAlign="center" py={2}>
        Board preview unavailable
      </Text>
    );
  }

  return (
    <SimpleGrid
      columns={5}
      spacing="2px"
      p={1}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="md"
      bg={gridBg}
      w="140px"
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
              py={1}
              bg={background}
              color={color}
              minW="24px"
              minH="24px"
            >
              <Text fontWeight="bold" fontSize="2xs" lineHeight="1">
                {workerSymbol(worker, level)}
              </Text>
            </Box>
          );
        }),
      )}
    </SimpleGrid>
  );
});

export interface MoveHistoryItem {
  id: string;
  index: number;
  label: string;
  description?: string;
  player?: number; // 0 = green, 1 = red
  timestamp?: string;
  board?: number[][][] | null;
  from?: [number, number];
  to?: [number, number];
  build?: [number, number] | null;
}

interface MoveHistoryListItemProps {
  item: MoveHistoryItem;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
  showPlayerTag?: boolean;
  showPreviewOnHover?: boolean;
  compact?: boolean;
}

const MoveHistoryListItem = memo(function MoveHistoryListItem({
  item,
  isSelected,
  isDisabled,
  onClick,
  showPlayerTag = true,
  showPreviewOnHover = true,
  compact = false,
}: MoveHistoryListItemProps) {
  const cardBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const highlightBorder = useColorModeValue('teal.500', 'teal.300');
  const highlightBg = useColorModeValue('teal.50', 'whiteAlpha.100');
  const mutedText = useColorModeValue('gray.500', 'whiteAlpha.600');
  const popoverBg = useColorModeValue('white', 'gray.800');
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  const hasBoard = Boolean(item.board);
  const showPreview = showPreviewOnHover && hasBoard;

  const content = (
    <Box
      borderWidth="2px"
      borderColor={isSelected ? highlightBorder : cardBorder}
      bg={isSelected ? highlightBg : 'transparent'}
      borderRadius="md"
      px={compact ? 2 : 3}
      py={compact ? 1.5 : 2}
      cursor={isDisabled ? 'not-allowed' : 'pointer'}
      onClick={isDisabled ? undefined : onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      transition="all 0.15s"
      _hover={isDisabled ? undefined : { borderColor: highlightBorder, bg: highlightBg }}
      opacity={isDisabled ? 0.6 : 1}
    >
      <HStack justify="space-between" align="center" spacing={2}>
        <HStack spacing={2} flex={1} minW={0}>
          <Text
            fontWeight={isSelected ? 'bold' : 'semibold'}
            fontSize="sm"
            noOfLines={1}
          >
            {item.label}
          </Text>
          {showPlayerTag && typeof item.player === 'number' && (
            <Tag
              size="sm"
              colorScheme={item.player === 0 ? 'green' : 'red'}
              variant="subtle"
              flexShrink={0}
            >
              <TagLabel>{item.player === 0 ? 'G' : 'R'}</TagLabel>
            </Tag>
          )}
        </HStack>
        {item.timestamp && (
          <Text fontSize="2xs" color={mutedText} flexShrink={0}>
            {item.timestamp}
          </Text>
        )}
      </HStack>
      {item.description && !compact && (
        <Text fontSize="xs" color={mutedText} mt={1} noOfLines={1}>
          {item.description}
        </Text>
      )}
    </Box>
  );

  if (!showPreview) {
    return content;
  }

  return (
    <Popover
      isOpen={isHovered && !isDisabled}
      placement="auto"
      trigger="hover"
      isLazy
      lazyBehavior="unmount"
      gutter={12}
      modifiers={[
        {
          name: 'preventOverflow',
          options: {
            boundary: 'viewport',
            padding: 8,
          },
        },
        {
          name: 'flip',
          options: {
            fallbackPlacements: ['left', 'right', 'top', 'bottom'],
          },
        },
      ]}
    >
      <PopoverTrigger>{content}</PopoverTrigger>
      <PopoverContent 
        w="auto" 
        bg={popoverBg} 
        shadow="xl"
        borderRadius="lg"
        maxW="200px"
      >
        <PopoverArrow bg={popoverBg} />
        <PopoverBody p={3}>
          <Stack spacing={2}>
            <Text fontSize="xs" fontWeight="bold" textAlign="center" color={mutedText}>
              After {item.label}
            </Text>
            <MiniBoardPreview
              board={item.board ?? null}
              from={item.from}
              to={item.to}
              build={item.build}
            />
            {item.to && (
              <HStack spacing={2} justify="center" fontSize="2xs" color={mutedText} flexWrap="wrap">
                {item.from && <Text>From: {coordinateLabel(item.from)}</Text>}
                <Text>To: {coordinateLabel(item.to)}</Text>
                {item.build && <Text>Build: {coordinateLabel(item.build)}</Text>}
              </HStack>
            )}
          </Stack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
});

export interface MoveHistoryListProps {
  items: MoveHistoryItem[];
  currentIndex: number;
  onSelectMove: (index: number) => void;
  disabled?: boolean;
  maxHeight?: string;
  showPlayerTags?: boolean;
  showPreviewOnHover?: boolean;
  compact?: boolean;
  includeInitialPosition?: boolean;
  initialPositionLabel?: string;
  onSelectInitialPosition?: () => void;
}

function MoveHistoryList({
  items,
  currentIndex,
  onSelectMove,
  disabled = false,
  maxHeight = '400px',
  showPlayerTags = true,
  showPreviewOnHover = true,
  compact = false,
  includeInitialPosition = false,
  initialPositionLabel = '0. Initial position',
  onSelectInitialPosition,
}: MoveHistoryListProps) {
  const cardBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const highlightBorder = useColorModeValue('teal.500', 'teal.300');
  const highlightBg = useColorModeValue('teal.50', 'whiteAlpha.100');

  const handleInitialClick = useCallback(() => {
    if (onSelectInitialPosition) {
      onSelectInitialPosition();
    } else {
      onSelectMove(-1);
    }
  }, [onSelectInitialPosition, onSelectMove]);

  return (
    <Stack spacing={2} maxH={maxHeight} overflowY="auto" pr={2}>
      {includeInitialPosition && (
        <Box
          borderWidth="2px"
          borderColor={currentIndex === -1 ? highlightBorder : cardBorder}
          bg={currentIndex === -1 ? highlightBg : 'transparent'}
          borderRadius="md"
          px={compact ? 2 : 3}
          py={compact ? 1.5 : 2}
          cursor={disabled ? 'not-allowed' : 'pointer'}
          onClick={disabled ? undefined : handleInitialClick}
          transition="all 0.15s"
          _hover={disabled ? undefined : { borderColor: highlightBorder, bg: highlightBg }}
          opacity={disabled ? 0.6 : 1}
        >
          <Text fontWeight={currentIndex === -1 ? 'bold' : 'semibold'} fontSize="sm">
            {initialPositionLabel}
          </Text>
        </Box>
      )}
      {items.map((item) => (
        <MoveHistoryListItem
          key={item.id}
          item={item}
          isSelected={currentIndex === item.index}
          isDisabled={disabled}
          onClick={() => onSelectMove(item.index)}
          showPlayerTag={showPlayerTags}
          showPreviewOnHover={showPreviewOnHover}
          compact={compact}
        />
      ))}
    </Stack>
  );
}

export default memo(MoveHistoryList);

// Export the mini board preview for use in other components
export { MiniBoardPreview, coordinateLabel, workerSymbol };

