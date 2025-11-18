import { useColorModeValue } from '@chakra-ui/react';

export function useSurfaceTokens() {
  const cardBg = useColorModeValue('white', 'whiteAlpha.100');
  const cardBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const mutedText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const helperText = useColorModeValue('gray.600', 'whiteAlpha.700');
  const strongText = useColorModeValue('gray.900', 'whiteAlpha.900');
  const accentHeading = useColorModeValue('teal.600', 'teal.200');
  const panelBg = useColorModeValue('gray.50', 'blackAlpha.400');
  const headerGradient = useColorModeValue('linear(to-r, teal.50, white)', 'linear(to-r, teal.700, gray.900)');
  const headerBorder = useColorModeValue('gray.200', 'whiteAlpha.200');
  const headerAccent = useColorModeValue('teal.500', 'teal.300');

  return {
    cardBg,
    cardBorder,
    mutedText,
    helperText,
    strongText,
    accentHeading,
    panelBg,
    headerAccent,
    headerBorder,
    headerGradient,
  };
}

export type SurfaceTokens = ReturnType<typeof useSurfaceTokens>;
