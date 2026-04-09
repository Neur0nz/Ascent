import React, { type ReactNode } from 'react';
import { Box, Button, Heading, Text, VStack } from '@chakra-ui/react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Application error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <Box p={8} textAlign="center" minH="100vh" display="flex" alignItems="center" justifyContent="center">
          <VStack spacing={4}>
            <Heading size="md">Something went wrong</Heading>
            <Text color="gray.500" maxW="400px">
              An unexpected error occurred. You can try reloading the page.
            </Text>
            <Button
              colorScheme="blue"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </Button>
          </VStack>
        </Box>
      );
    }
    return this.props.children;
  }
}
