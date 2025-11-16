import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider, ColorModeScript } from '@chakra-ui/react';
import App from './App';
import { EvaluationJobsProvider } from '@hooks/useEvaluationJobs';
import theme from '@theme';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found');
}

if (import.meta.env.VITE_APP_TITLE) {
  document.title = import.meta.env.VITE_APP_TITLE as string;
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ChakraProvider
      theme={theme}
      toastOptions={{
        defaultOptions: {
          containerStyle: {
            minWidth: 'min(360px, calc(100vw - 32px))',
            maxWidth: 'min(420px, calc(100vw - 32px))',
            wordBreak: 'break-word',
          },
        },
      }}
    >
      <ColorModeScript initialColorMode={theme.config.initialColorMode} />
      <EvaluationJobsProvider>
        <App />
      </EvaluationJobsProvider>
    </ChakraProvider>
  </React.StrictMode>,
);
