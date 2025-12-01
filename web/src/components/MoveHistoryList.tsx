import { memo, useCallback, useMemo, useState } from 'react';
import {
  Box,
  HStack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Tag,
  TagLabel,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import { renderCellSvg } from '@game/svg';

const COORD_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

const coordinateLabel = (position?: [number, number] | null): string => {
  if (!position) return '—';
  const [y, x] = position;
  if (y < 0 || x < 0 || y >= 5 || x >= 5) return '—';
  return `${COORD_LABELS[x]}${y + 1}`;
};

// SVG cache for mini board cells - shared across all instances
const miniSvgCache = new Map<string, string>();

const getMiniCellSvg = (level: number, worker: number): string => {
  const key = `mini-${level}:${worker}`;
  const cached = miniSvgCache.get(key);
  if (cached) return cached;
  
  const svg = renderCellSvg({ levels: level, worker }, { playerZeroRole: 'creator' });
  miniSvgCache.set(key, svg);
  return svg;
};

// Mini board preview component - optimized for hover use with actual SVG rendering
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
  const cellBg = useColorModeValue('#E2E8F0', '#4A5568'); // gray.200 / gray.600
  const highlightTo = useColorModeValue('#319795', '#4FD1C5'); // teal.600 / teal.300
  const highlightFrom = useColorModeValue('#DD6B20', '#F6AD55'); // orange.600 / orange.300
  const highlightBuild = useColorModeValue('#805AD5', '#B794F4'); // purple.600 / purple.300
  const gridBg = useColorModeValue('#F7FAFC', '#1A202C'); // gray.50 / gray.900
  const borderColor = useColorModeValue('#E2E8F0', '#4A5568'); // gray.200 / gray.600
  const buildingColor = useColorModeValue('#1A202C', '#E2E8F0'); // gray.900 / gray.200

  // Generate the entire board SVG in one go for performance
  const boardSvg = useMemo(() => {
    if (!board) return null;
    
    const cellSize = 28;
    const gap = 2;
    const padding = 4;
    const totalSize = cellSize * 5 + gap * 4 + padding * 2;
    
    let svg = `<svg width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}" xmlns="http://www.w3.org/2000/svg">`;
    
    // Background
    svg += `<rect width="${totalSize}" height="${totalSize}" rx="6" fill="${gridBg}"/>`;
    
    // Border
    svg += `<rect x="0.5" y="0.5" width="${totalSize - 1}" height="${totalSize - 1}" rx="6" fill="none" stroke="${borderColor}" stroke-width="1"/>`;
    
    // Cells
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const cell = board[y]?.[x];
        if (!cell) continue;
        
        const worker = cell[0];
        const level = cell[1];
        const isFrom = from && from[0] === y && from[1] === x;
        const isTo = to && to[0] === y && to[1] === x;
        const isBuild = build && build[0] === y && build[1] === x;
        
        const cellX = padding + x * (cellSize + gap);
        const cellY = padding + y * (cellSize + gap);
        
        // Cell background
        let bgColor = cellBg;
        if (isTo) bgColor = highlightTo;
        else if (isFrom) bgColor = highlightFrom;
        else if (isBuild) bgColor = highlightBuild;
        
        svg += `<rect x="${cellX}" y="${cellY}" width="${cellSize}" height="${cellSize}" rx="3" fill="${bgColor}"/>`;
        
        // Cell content (building levels + worker)
        if (level > 0 || worker !== 0) {
          const cellSvg = getMiniCellSvg(level, worker);
          // Extract the inner content and transform it to fit the cell
          const innerContent = cellSvg
            .replace(/<svg[^>]*>/, '')
            .replace(/<\/svg>/, '');
          
          // Scale factor: original is 240x240, we want it to fit in cellSize
          const scale = (cellSize - 4) / 240;
          const offsetX = cellX + 2;
          const offsetY = cellY + 2;
          
          svg += `<g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" style="color: ${buildingColor}">${innerContent}</g>`;
        }
      }
    }
    
    svg += '</svg>';
    return svg;
  }, [board, from, to, build, cellBg, highlightTo, highlightFrom, highlightBuild, gridBg, borderColor, buildingColor]);

  if (!board || !boardSvg) {
    return (
      <Text fontSize="xs" color="gray.500" textAlign="center" py={2}>
        Board preview unavailable
      </Text>
    );
  }

  return (
    <Box
      w="160px"
      h="160px"
      dangerouslySetInnerHTML={{ __html: boardSvg }}
      sx={{
        '& svg': {
          width: '100%',
          height: '100%',
        },
      }}
    />
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
        maxW="220px"
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
export { MiniBoardPreview, coordinateLabel };

