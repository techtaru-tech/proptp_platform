import { api } from './apiClient';

/** Site cameras (server/src/routes/admin/cameras.ts): a name, a site, where it points, and the address its live picture is served from. */

export interface CameraRow {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  placement: string | null;
  liveUrl: string | null;
  active: boolean;
}

export interface CameraInput {
  name: string;
  projectId: string;
  placement?: string;
  liveUrl?: string;
}

export const listCameras = () => api.get<CameraRow[]>('/cameras');
export const createCamera = (input: CameraInput) => api.post<CameraRow>('/cameras', input);
export const updateCamera = (id: string, input: Partial<CameraInput>) => api.patch<CameraRow>(`/cameras/${id}`, input);
export const deleteCamera = (id: string) => api.delete(`/cameras/${id}`);
