import {
  AspectRatio,
  Box,
  Button,
  Flex,
  Grid,
  GridItem,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Text,
  useColorModeValue,
  useBreakpointValue,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState } from 'react';
import type { ButtonsState } from '@hooks/useSantorini';
import { useBoardPreferences } from '@hooks/useBoardPreferences';
import type { BoardCell } from '@game/boardView';

export interface GameBoardProps {
  board: BoardCell[][];
  selectable: boolean[][];
  cancelSelectable?: boolean[][];
  onCellClick: (y: number, x: number) => void;
  onCellHover: (y: number, x: number) => void;
  onCellLeave: (y: number, x: number) => void;
  buttons: ButtonsState;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  undoLabel?: string;
  hideRedoButton?: boolean;
  undoDisabledOverride?: boolean;
  showBoardSizeControl?: boolean;
  showPrimaryControls?: boolean;
  undoIsLoading?: boolean;
  isTurnActive?: boolean;
  turnHighlightColor?: string;
  showCoordinates?: boolean;
}

const getColumnLabel = (index: number) => {
  let position = index;
  let label = '';
  while (position >= 0) {
    label = String.fromCharCode(65 + (position % 26)) + label;
    position = Math.floor(position / 26) - 1;
  }
  return label;
};

function GameBoard({
  board,
  selectable,
  cancelSelectable,
  onCellClick,
  onCellHover,
  onCellLeave,
  buttons,
  undo,
  redo,
  undoLabel,
  hideRedoButton,
  undoDisabledOverride,
  showBoardSizeControl = true,
  showPrimaryControls = true,
  undoIsLoading = false,
  isTurnActive = false,
  turnHighlightColor,
  showCoordinates,
}: GameBoardProps) {
  const { showCoordinateLabels: contextCoordinatePreference } = useBoardPreferences();
  const coordinateOverlayEnabled =
    typeof showCoordinates === 'boolean' ? showCoordinates : contextCoordinatePreference;
  const cellBg = useColorModeValue('gray.50', 'gray.700');
  const selectableBg = useColorModeValue('teal.100', 'teal.700');
  const cancelSelectableBg = useColorModeValue('orange.200', 'orange.700');
  const setupSelectableBg = useColorModeValue('green.100', 'green.700');
  const labelColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const subtleLabelColor = useColorModeValue('gray.600', 'whiteAlpha.700');
  const boardFrameBg = useColorModeValue('gray.100', 'blackAlpha.500');
  const defaultBorderColor = useColorModeValue('gray.300', 'whiteAlpha.300');
  const buildingColor = useColorModeValue('gray.900', 'whiteAlpha.900');
  const coordinateLabelColor = useColorModeValue('gray.700', 'whiteAlpha.800');
  const coordinateLabelBg = useColorModeValue('whiteAlpha.800', 'blackAlpha.600');
  const coordinateLabelShadow = useColorModeValue(
    '0 0 4px rgba(255, 255, 255, 0.8)',
    '0 0 4px rgba(0, 0, 0, 0.9)',
  );
  const boardSizeControlVisible = useBreakpointValue({ base: false, md: true });
  const [boardPixels, setBoardPixels] = useState<number>(() => {
    if (typeof window === 'undefined') {
      return 600;
    }
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem('santorini:boardSize');
    } catch (error) {
      if (import.meta.env?.DEV) {
        console.warn('GameBoard: Failed to read stored board size', error);
      }
    }
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= 320 && parsed <= 960) {
      return parsed;
    }
    const viewportWidth = window.innerWidth || 0;
    if (viewportWidth <= 0) {
      return 720;
    }
    const preferred = Math.round(viewportWidth - 96);
    return Math.min(960, Math.max(360, preferred));
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      try {
        window.localStorage.setItem('santorini:boardSize', String(boardPixels));
      } catch (error) {
        if (import.meta.env?.DEV) {
          console.warn('GameBoard: Failed to persist board size', error);
        }
      }
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [boardPixels]);

  const boardRows = Math.max(1, board.length);
  const boardColumns = Math.max(1, board[0]?.length ?? boardRows);
  const gridTemplateColumns = `repeat(${boardColumns}, 1fr)`;

  // Use 100% instead of 100vw to prevent horizontal overflow on mobile.
  // 100vw includes scrollbar width and ignores parent container padding.
  const boardMaxWidth = useMemo(() => `min(${boardPixels}px, 100%)`, [boardPixels]);
  const approxCellSize = useMemo(() => {
    if (!boardColumns) {
      return boardPixels / 5;
    }
    return boardPixels / boardColumns;
  }, [boardPixels, boardColumns]);
  const coordinateFontSize = useMemo(() => {
    const base = approxCellSize * 0.2;
    const clamped = Math.max(9, Math.min(base, 16));
    return `${Math.round(clamped * 10) / 10}px`;
  }, [approxCellSize]);
  const coordinateOffset = useMemo(() => {
    const base = approxCellSize * 0.04;
    const clamped = Math.max(2, Math.min(base, 6));
    return `${Math.round(clamped * 10) / 10}px`;
  }, [approxCellSize]);
  const defaultGlowColor = useColorModeValue('teal.400', 'teal.200');
  const activeGlowColor = turnHighlightColor ?? defaultGlowColor;
  const boardBoxShadow = isTurnActive
    ? `0 0 0 3px ${activeGlowColor}, 0 0 30px ${activeGlowColor}66`
    : '2xl';
  const responsiveBoardShadow = useBreakpointValue({ base: 'none', md: boardBoxShadow });
  const responsiveBorderRadius = useBreakpointValue({ base: 'none', md: 'xl' });
  const responsiveBorderWidth = useBreakpointValue({ base: '0px', md: isTurnActive ? '2px' : '0px' });
  const responsiveFrameBg = useBreakpointValue({ base: 'transparent', md: boardFrameBg });

  return (
    <Flex
      direction="column"
      gap={{ base: 6, md: 7 }}
      w="100%"
      maxW="100%"
      mx="auto"
      overflow="hidden"
    >
      <Flex direction="column" gap={3} w="100%">
        {showBoardSizeControl && boardSizeControlVisible && (
          <Flex align="center" gap={3} w="100%" px={{ base: 0, sm: 1 }}>
            <Text fontSize="sm" color={labelColor} whiteSpace="nowrap">
              Board size
            </Text>
            <Slider
              aria-label="Board size"
              value={boardPixels}
              onChange={setBoardPixels}
              min={320}
              max={960}
              step={10}
              colorScheme="teal"
              flex={1}
            >
              <SliderTrack bg={defaultBorderColor}>
                <SliderFilledTrack />
              </SliderTrack>
              <SliderThumb boxSize={5} />
            </Slider>
            <Text fontSize="sm" color={subtleLabelColor} w="64px" textAlign="right">
              {Math.round(boardPixels)}px
            </Text>
          </Flex>
        )}
        <AspectRatio ratio={1} w="100%" maxW={boardMaxWidth} mx="auto">
          <Flex
            direction="column"
            w="100%"
            h="100%"
            bg={responsiveFrameBg ?? boardFrameBg}
            p={{ base: 0, md: 6 }}
            borderRadius={responsiveBorderRadius ?? 'xl'}
            boxShadow={responsiveBoardShadow ?? boardBoxShadow}
            borderWidth={responsiveBorderWidth ?? (isTurnActive ? '2px' : '0px')}
            borderColor={isTurnActive ? activeGlowColor : 'transparent'}
            transition="box-shadow 0.3s ease, border-color 0.3s ease"
          >
            <Grid
              templateColumns={gridTemplateColumns}
              gap={{ base: 1, sm: 2, md: 3 }}
              w="100%"
              h="100%"
              flex={1}
            >
              {board.map((row, y) =>
                row.map((cell, x) => {
                  const isSelectable = selectable[y]?.[x];
                  const isCancelSelectable = cancelSelectable?.[y]?.[x];
                  const isSetupSelectable = buttons.setupMode && cell.worker === 0; // Empty cells during setup
                  const canClick = isSelectable || isCancelSelectable || isSetupSelectable;
                  const columnLabel = getColumnLabel(x);
                  const rowLabel = String(y + 1);
                  const isBottomRow = y === boardRows - 1;
                  const isRightmostColumn = x === boardColumns - 1;
                  return (
                    <GridItem key={`${y}-${x}`}>
                      <AspectRatio ratio={1} w="100%">
                        <Box
                          role="button"
                          tabIndex={0}
                          aria-label={`Cell ${y},${x}`}
                          onClick={() => onCellClick(y, x)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onCellClick(y, x);
                            }
                          }}
                          onMouseEnter={() => onCellHover(y, x)}
                          onMouseLeave={() => onCellLeave(y, x)}
                          cursor={canClick ? 'pointer' : 'default'}
                          borderRadius="lg"
                          borderWidth="1px"
                          borderColor={defaultBorderColor}
                          bg={
                            isSetupSelectable
                              ? setupSelectableBg
                              : isCancelSelectable
                                ? cancelSelectableBg
                                : isSelectable
                                  ? selectableBg
                                  : cellBg
                          }
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          transition="all 0.2s ease"
                          position="relative"
                          _hover={{ boxShadow: canClick ? 'dark-lg' : undefined }}
                        >
                          <Box
                            pointerEvents="none"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            w="100%"
                            h="100%"
                            color={buildingColor}
                            sx={{
                              '& svg': {
                                width: '88%',
                                height: '88%',
                                maxWidth: '88%',
                                maxHeight: '88%',
                              },
                            }}
                            dangerouslySetInnerHTML={{ __html: cell.svg }}
                          />
                          {coordinateOverlayEnabled && isBottomRow && (
                            <Text
                              pointerEvents="none"
                              position="absolute"
                              bottom={coordinateOffset}
                              left={coordinateOffset}
                              fontSize={coordinateFontSize}
                              fontWeight="semibold"
                              color={coordinateLabelColor}
                              bg={coordinateLabelBg}
                              px="2px"
                              py="1px"
                              borderRadius="sm"
                              lineHeight="shorter"
                              textShadow={coordinateLabelShadow}
                            >
                              {columnLabel}
                            </Text>
                          )}
                          {coordinateOverlayEnabled && isRightmostColumn && (
                            <Text
                              pointerEvents="none"
                              position="absolute"
                              top={coordinateOffset}
                              right={coordinateOffset}
                              fontSize={coordinateFontSize}
                              fontWeight="semibold"
                              color={coordinateLabelColor}
                              bg={coordinateLabelBg}
                              px="2px"
                              py="1px"
                              borderRadius="sm"
                              lineHeight="shorter"
                              textShadow={coordinateLabelShadow}
                            >
                              {rowLabel}
                            </Text>
                          )}
                        </Box>
                      </AspectRatio>
                    </GridItem>
                  );
                }),
              )}
            </Grid>
          </Flex>
        </AspectRatio>
      </Flex>
      {showPrimaryControls && (
        <Flex
          gap={3}
          direction={{ base: 'column', sm: 'row' }}
          w="100%"
          align="stretch"
        >
        <Button
          flex="1"
          w={{ base: '100%', sm: 'auto' }}
          size="lg"
          py={{ base: 5, sm: 6 }}
          onClick={undo}
          isDisabled={undoDisabledOverride ?? !buttons.canUndo}
          isLoading={undoIsLoading}
          colorScheme="green"
          boxShadow="lg"
        >
            {undoLabel ?? 'Undo'}
          </Button>
          {!hideRedoButton && (
            <Button
              flex="1"
              w={{ base: '100%', sm: 'auto' }}
              size="lg"
              py={{ base: 5, sm: 6 }}
              onClick={redo}
              isDisabled={!buttons.canRedo}
              colorScheme="purple"
              boxShadow="lg"
            >
              Redo
            </Button>
          )}
        </Flex>
      )}
    </Flex>
  );
}

export default GameBoard;
