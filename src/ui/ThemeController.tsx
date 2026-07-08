/**
 * ThemeController — the React-side wrapper that reads the persisted theme
 * on boot, holds it in state, and applies it to all children via
 * <ThemeProvider>. The Settings → Appearance screen calls `setTheme` to
 * switch, and the new theme applies instantly across the app.
 */
import React, {useEffect, useState, useCallback} from 'react';
import {ThemeProvider, Theme, ThemeId, DEFAULT_THEME, getTheme} from './theme.tsx';
import {themeStore} from '../api/themeStore';

interface Ctx {
  theme: Theme;
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  loaded: boolean;
}

const ThemeControllerContext = React.createContext<Ctx>({
  theme: getTheme(DEFAULT_THEME),
  themeId: DEFAULT_THEME,
  setTheme: () => {},
  loaded: false,
});

export const useThemeController = (): Ctx => React.useContext(ThemeControllerContext);

export const ThemeController: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const id = await themeStore.load();
      setThemeIdState(id);
      setLoaded(true);
    })();
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    void themeStore.save(id);
  }, []);

  const theme = getTheme(themeId);

  return (
    <ThemeControllerContext.Provider value={{theme, themeId, setTheme, loaded}}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeControllerContext.Provider>
  );
};
