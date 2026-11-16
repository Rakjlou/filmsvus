import { useCallback, useEffect, useState } from 'react';

export const sessionExpiredMessage = 'Votre session a expiré, reconnectez-vous.';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
    });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new Error('Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    const authRequest = path.startsWith('/auth/');
    if (response.status === 401 && !authRequest) {
      window.dispatchEvent(new Event('filmsvus-session-expired'));
      throw new Error(sessionExpiredMessage);
    }
    const errorMessage = body.error === 'BudgetExceeded'
      ? 'Le budget OMDb du jour est atteint. Vos données sont conservées ; réessayez demain.'
      : body.error === 'Validation' ? authRequest ? 'Vérifiez votre identifiant et votre mot de passe.'
        : 'Vérifiez les champs : le titre, la date, les notes et les liens doivent être valides.'
      : body.message ?? `La requête a échoué (${response.status}).`;
    throw new Error(errorMessage);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}
export const json = (method: string, data?: unknown): RequestInit => ({ method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
export const message = (error: unknown) => error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez.';

export function useResource<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  const setData = useCallback((data: T) => setState({ data, loading: false }), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    void api<T>(path, { signal: controller.signal }).then(data => setState({ data, loading: false }))
      .catch(error => { if (!controller.signal.aborted) setState({ error: message(error), loading: false }); });
    return () => controller.abort();
  }, [path, revision]);
  return { ...state, reload, setData };
}
