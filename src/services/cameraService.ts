import { api } from './apiClient';

/** Site cameras (server/src/routes/admin/cameras.ts). Health arrives already derived from when the camera last delivered. */

export type Health = 'live' | 'stale' | 'offline' | 'never' | 'off';
export interface CameraRow {
  id: string; name: string; projectId: string; projectName: string; placement: string | null; liveUrl: string | null;
  active: boolean; expectedEveryMinutes: number; keyPrefix: string; lastImageAt: string | null; lastSeenAt: string | null;
  health: Health; silentMinutes: number | null; imagesToday: number; flagged: number; latestUrl: string | null;
}
export interface CameraImage {
  id: string; cameraId: string; cameraName: string; projectName: string; url: string; capturedAt: string; receivedAt: string;
  review: 'unreviewed' | 'ok' | 'flagged'; flagNote: string | null; flaggedAt: string | null; issueId: string | null;
}
export interface ImagePage { items: CameraImage[]; total: number; page: number; pageSize: number }

export const HEALTH: Record<Health, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  live: { label: 'Live', tone: 'success' }, stale: { label: 'Late', tone: 'warning' }, offline: { label: 'Offline', tone: 'danger' },
  never: { label: 'Waiting for first picture', tone: 'neutral' }, off: { label: 'Switched off', tone: 'neutral' },
};

export const listCameras = () => api.get<CameraRow[]>('/cameras');
export const createCamera = (input: { name: string; projectId: string; placement?: string; expectedEveryMinutes: number }) =>
  api.post<CameraRow & { key: string }>('/cameras', input);
export const updateCamera = (id: string, input: Record<string, unknown>) => api.patch<CameraRow>(`/cameras/${id}`, input);
export const deletePicture = (id: string) => api.delete(`/cameras/images/${id}`);
export const deletePictures = (ids: string[]) => api.post<{ deleted: number }>('/cameras/images/delete', { ids });
export const deleteAllPictures = (cameraId: string) => api.post<{ deleted: number }>(`/cameras/${cameraId}/images/delete-all`, {});
export const rotateCameraKey = (id: string) => api.post<{ key: string }>(`/cameras/${id}/rotate-key`);
export const deleteCamera = (id: string) => api.delete(`/cameras/${id}`);
export const listImages = (q: { cameraId?: string; review?: string; date?: string; page?: number }) =>
  api.get<ImagePage>(`/cameras/images?cameraId=${q.cameraId ?? ''}&review=${q.review ?? 'all'}&date=${q.date ?? ''}&page=${q.page ?? 1}`);
export const reviewImage = (id: string, input: { decision: 'ok' | 'flag' | 'clear'; note?: string; raiseIssue?: boolean; dueDate?: string }) =>
  api.post<{ review: string; issueId: string | null }>(`/cameras/images/${id}/review`, input);
