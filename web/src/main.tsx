import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider, ColorModeScript } from '@chakra-ui/react';
import App from './App';
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
    <ChakraProvider theme={theme}>
      <ColorModeScript initialColorMode={theme.config.initialColorMode} />
      <App />
    </ChakraProvider>
  </React.StrictMode>,
);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const serviceWorkerUrl = new URL(`${import.meta.env.BASE_URL}notification-sw.js`, window.location.href);
  const registerNotificationWorker = () => {
    navigator.serviceWorker
      .register(serviceWorkerUrl.href, { scope: import.meta.env.BASE_URL })
      .catch((error) => {
        console.warn('Failed to register notification service worker', error);
      });
  };

  if (document.readyState === 'complete') {
    registerNotificationWorker();
  } else {
    window.addEventListener('load', registerNotificationWorker, { once: true });
  }
}
