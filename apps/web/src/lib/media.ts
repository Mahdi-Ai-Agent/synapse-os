import { useSyncExternalStore } from 'react';

/** Below this width the app switches to the phone layout (docs/UI-DESIGN.md "Phone layout"). */
export const MOBILE_QUERY = '(max-width: 767px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/** Touch screens get larger hit targets on the graph canvas. */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}
