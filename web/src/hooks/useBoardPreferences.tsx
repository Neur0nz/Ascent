import { createContext, useContext, type ReactNode } from 'react';

export interface BoardPreferences {
  showCoordinateLabels: boolean;
}

const BoardPreferencesContext = createContext<BoardPreferences>({
  showCoordinateLabels: true,
});

export interface BoardPreferencesProviderProps {
  value: BoardPreferences;
  children: ReactNode;
}

export function BoardPreferencesProvider({ value, children }: BoardPreferencesProviderProps) {
  return <BoardPreferencesContext.Provider value={value}>{children}</BoardPreferencesContext.Provider>;
}

export function useBoardPreferences(): BoardPreferences {
  return useContext(BoardPreferencesContext);
}
