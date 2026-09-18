import { useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
}

/**
 * Runs an async fetcher whenever `deps` change, tracking loading/error state.
 * Guards against setting state from a stale (superseded) request.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, isLoading: true, error: undefined });
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));

    fetcher()
      .then((data) => {
        if (requestId.current === currentRequest) {
          setState({ data, isLoading: false, error: undefined });
        }
      })
      .catch((error: Error) => {
        if (requestId.current === currentRequest) {
          setState({ data: undefined, isLoading: false, error });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
