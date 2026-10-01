import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import type { CameraRow } from '../../services/cameraService';

/** Shows a camera key exactly once, with the command to run on the PC. The CRM keeps only a hash of it. */
export function KeyReveal({ camera, secret, onClose }: { camera: Pick<CameraRow, 'name'>; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = window.location.origin;
  const command = `python3 rosium-camera-uploader.py --folder "<folder the camera saves to>" --url ${origin} --key ${secret}`;
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch { /* the text is selectable anyway */ }
  };
  return (
    <Modal isOpen onClose={onClose} size="lg" title={`Set up ${camera.name}`} footer={<Button variant="primary" onClick={onClose}>I have saved the key</Button>}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="rounded-lg bg-warning-50 px-3 py-2.5 text-warning-700">This key is shown <strong>only now</strong>. Save it; if it is lost, rotate the key from the camera’s page.</p>
        <div>
          <p className="mb-1 font-medium text-ink">Camera key</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-surface-muted px-3 py-2 font-mono text-xs">{secret}</code>
            <Button variant="outline" size="sm" leftIcon={copied === 'key' ? <Check size={13} /> : <Copy size={13} />} onClick={() => copy('key', secret)}>{copied === 'key' ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
        <div>
          <p className="mb-1 font-medium text-ink">On the PC that stores the camera’s pictures</p>
          <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
            <li>Install Python 3 if it is not there. Nothing else is needed.</li>
            <li><a className="font-medium text-brand-700" href="/downloads/rosium-camera-uploader.py" download>Download the uploader</a> and put it anywhere on the PC.</li>
            <li>Run this once to test, then schedule it every hour (Task Scheduler on Windows, cron on Mac/Linux — steps are in the camera’s page).</li>
          </ol>
          <div className="mt-2 flex items-start gap-2">
            <code className="flex-1 break-all rounded-lg bg-surface-muted px-3 py-2 font-mono text-xs">{command}</code>
            <Button variant="outline" size="sm" leftIcon={copied === 'cmd' ? <Check size={13} /> : <Copy size={13} />} onClick={() => copy('cmd', command)}>{copied === 'cmd' ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
