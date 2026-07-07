/**
 * Toast/snackbar (J11) — tiny pure-RN utility, no dependency. One toast at a
 * time, bottom-anchored, auto-dismisses, tap to dismiss early. Used for async
 * failures (group sync calls, rejected session edits) with honest German copy
 * (CLAUDE.md §7) — never for celebrating; success is visible in the data.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { radius, spacing, typography, useTheme } from '../theme';

export type ToastTone = 'neutral' | 'danger';

export interface ToastApi {
  /** Show a toast (replaces the current one). */
  show(message: string, tone?: ToastTone): void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === undefined) {
    throw new Error('ToastContext missing — wrap the tree in <ToastProvider>.');
  }
  return api;
}

const SHOW_MS = 4_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | undefined>();
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hide = useCallback(() => {
    if (hideTimer.current !== undefined) {
      clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    }
    Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(
      () => setToast(undefined),
    );
  }, [opacity]);

  const show = useCallback(
    (message: string, tone: ToastTone = 'neutral') => {
      if (hideTimer.current !== undefined) clearTimeout(hideTimer.current);
      setToast({ message, tone });
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(hide, SHOW_MS);
    },
    [opacity, hide],
  );

  useEffect(
    () => () => {
      if (hideTimer.current !== undefined) clearTimeout(hideTimer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast !== undefined && (
        <Animated.View pointerEvents="box-none" style={[styles.host, { opacity }]}>
          <Pressable
            accessibilityRole="alert"
            onPress={hide}
            style={[
              styles.toast,
              {
                backgroundColor: colors.action,
                borderColor: toast.tone === 'danger' ? colors.danger : colors.action,
              },
            ]}
          >
            <Text style={[typography.body, { color: colors.onAction }]}>{toast.message}</Text>
          </Pressable>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xxl + 56, // clear of the tab bar
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  toast: {
    maxWidth: 560,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    elevation: 4,
  },
});
