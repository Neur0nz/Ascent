import { Box, Center, Spinner, Text, VStack, useColorModeValue, Progress } from '@chakra-ui/react';

interface AuthLoadingScreenProps {
  message?: string;
  showProgress?: boolean;
  isTemporary?: boolean;
}

export function AuthLoadingScreen({ 
  message = 'Signing you in...', 
  showProgress = true,
  isTemporary = false 
}: AuthLoadingScreenProps) {
  const bgGradient = useColorModeValue(
    'linear(to-br, teal.50, blue.50)',
    'linear(to-br, gray.900, gray.800)'
  );
  const textColor = useColorModeValue('gray.700', 'whiteAlpha.900');
  const subtleTextColor = useColorModeValue('gray.600', 'whiteAlpha.800');

  return (
    <Center 
      minH="100vh" 
      bgGradient={bgGradient}
      position="fixed"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={9999}
    >
      <VStack spacing={6} p={8}>
        <Spinner
          thickness="4px"
          speed="0.8s"
          emptyColor="gray.200"
          color="teal.500"
          size="xl"
        />
        
        <VStack spacing={2}>
          <Text fontSize="xl" fontWeight="semibold" color={textColor}>
            {message}
          </Text>
          
          {isTemporary && (
            <Text fontSize="sm" color={subtleTextColor}>
              Network is a bit slow, but we're getting you in...
            </Text>
          )}
          
          <Text fontSize="xs" color={subtleTextColor}>
            This usually takes just a moment
          </Text>
        </VStack>

        {showProgress && (
          <Box w="250px">
            <Progress 
              size="xs" 
              isIndeterminate 
              colorScheme="teal" 
              borderRadius="full"
            />
          </Box>
        )}
      </VStack>
    </Center>
  );
}

