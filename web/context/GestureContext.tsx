'use client';

import React, { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createGesture,
  createGesturesBatch,
  fetchGestures,
  gestureKeys,
  type GestureRecord,
} from '@/features/gestures/queries';

export type { GestureRecord } from '@/features/gestures/queries';

interface GestureContextValue {
  gestures: GestureRecord[];
  gestureLabels: string[];
  isLoading: boolean;
  refreshGestures: () => Promise<void>;
  addCustomGesture: (name: string) => Promise<{ success: true; gesture: GestureRecord } | { success: false; error: string }>;
  addCustomGesturesBatch: (names: string[]) => Promise<{ success: true; gestures: GestureRecord[] } | { success: false; error: string }>;
}

const DEFAULT_GESTURE_LABELS = ['Pointing', 'Fist', 'Peace', 'Open Palm', 'Rock', 'Thumb'];
const DEFAULT_GESTURES: GestureRecord[] = DEFAULT_GESTURE_LABELS.map((name, labelIndex) => ({
  _id: String(labelIndex),
  name,
  labelIndex,
  isCustom: false,
}));

const GestureContext = createContext<GestureContextValue | null>(null);

export function useGestures(): GestureContextValue {
  const context = useContext(GestureContext);
  if (!context) throw new Error('useGestures must be used within a GestureProvider');
  return context;
}

export function GestureProvider({ children }: { children: ReactNode }): React.ReactElement {
  const queryClient = useQueryClient();
  const gesturesQuery = useQuery({
    queryKey: gestureKeys.all,
    queryFn: fetchGestures,
  });
  const createMutation = useMutation({ mutationFn: createGesture });
  const batchMutation = useMutation({ mutationFn: createGesturesBatch });

  const gestures = gesturesQuery.data?.length ? gesturesQuery.data : DEFAULT_GESTURES;
  const gestureLabels = useMemo(() => {
    const maxLabelIndex = Math.max(...gestures.map((gesture) => gesture.labelIndex), 5);
    const labels = Array<string>(maxLabelIndex + 1).fill('Unknown');
    DEFAULT_GESTURE_LABELS.forEach((label, index) => { labels[index] = label; });
    gestures.forEach((gesture) => { labels[gesture.labelIndex] = gesture.name; });
    return labels;
  }, [gestures]);

  const refreshGestures = useCallback(async (): Promise<void> => {
    await gesturesQuery.refetch();
  }, [gesturesQuery]);

  const addCustomGesture = useCallback(async (
    name: string
  ): Promise<{ success: true; gesture: GestureRecord } | { success: false; error: string }> => {
    try {
      const gesture = await createMutation.mutateAsync(name);
      await queryClient.invalidateQueries({ queryKey: gestureKeys.all });
      return { success: true, gesture };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [createMutation, queryClient]);

  const addCustomGesturesBatch = useCallback(async (
    names: string[]
  ): Promise<{ success: true; gestures: GestureRecord[] } | { success: false; error: string }> => {
    try {
      const nextGestures = await batchMutation.mutateAsync(names);
      queryClient.setQueryData(gestureKeys.all, nextGestures);
      return { success: true, gestures: nextGestures };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [batchMutation, queryClient]);

  const value = useMemo(() => ({
    gestures,
    gestureLabels,
    isLoading: gesturesQuery.isPending,
    refreshGestures,
    addCustomGesture,
    addCustomGesturesBatch,
  }), [gestures, gestureLabels, gesturesQuery.isPending, refreshGestures, addCustomGesture, addCustomGesturesBatch]);

  return <GestureContext.Provider value={value}>{children}</GestureContext.Provider>;
}

export default GestureContext;
