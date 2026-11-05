import { useState } from 'react';
import { AlertTriangle, Check, Copy, Play } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../context/ToastContext';
import { simulateConnection, type SimulateConnectionResult } from '../../services/integrationService';
import type { LeadSourceConnection } from '../../types';

/** Deliberately uses awkward key names — it shows the auto-detection doing its job. */
const SAMPLE_PAYLOAD = {
  'your-name': 'Test Visitor',
  mobile: '9000000001',
  email: 'test.visitor@example.com',
  city: 'Jaipur',
  message: 'Sample payload from the Integrations page.',
};

interface WebhookTestModalProps {
  connection: LeadSourceConnection;
  onClose: () => void;
}

/**
 * Runs a payload through the real mapping pipeline in dry-run mode, so a field mapping can be
 * checked before a live platform is pointed at the URL. Nothing is written to the database.
 */
export function WebhookTestModal({ connection, onClose }: WebhookTestModalProps) {
  const { toast } = useToast();
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(SAMPLE_PAYLOAD, null, 2));
  const [result, setResult] = useState<SimulateConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const run = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      setError('That is not valid JSON.');
      setResult(null);
      return;
    }

    setIsRunning(true);
    setError(null);
    try {
      setResult(await simulateConnection(connection.id, parsed));
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  };

  const curl = `curl -X POST '${connection.webhookUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${payloadText.replace(/\s+/g, ' ')}'`;

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curl);
      toast({ title: 'curl command copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', description: 'Select the text and copy it manually.', variant: 'error' });
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Send test payload"
      description={`Dry run against "${connection.name}" — nothing is saved.`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" leftIcon={<Play size={13} />} onClick={run} isLoading={isRunning}>
            Run test
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="webhook-payload" className="text-sm font-medium text-ink">
            Payload (JSON)
          </label>
          <textarea
            id="webhook-payload"
            rows={8}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            spellCheck={false}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink focus-ring"
          />
          <p className="text-xs text-ink-faint">
            Paste a real payload from the platform to check it maps correctly before going live.
          </p>
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-xs text-danger-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-subtle p-3.5">
            <div className="flex items-start gap-2">
              <Badge tone={result.success ? 'success' : 'danger'} dot>
                {result.success ? 'Would create a lead' : 'Would fail'}
              </Badge>
              {result.wouldFlagDuplicate && <Badge tone="warning">Duplicate phone</Badge>}
            </div>
            <p className="text-xs text-ink-muted">{result.message}</p>

            {Object.keys(result.mappedFields).length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Lead fields</p>
                <ul className="space-y-0.5">
                  {Object.entries(result.mappedFields).map(([field, value]) => (
                    <li key={field} className="flex items-start gap-2 text-xs text-ink">
                      <Check size={12} className="mt-0.5 shrink-0 text-success-600" />
                      <span className="text-ink-muted">{field}:</span> {value}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.extras.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Saved as a note on the lead</p>
                <ul className="space-y-0.5">
                  {result.extras.map((extra) => (
                    <li key={extra.label} className="text-xs text-ink-muted">
                      {extra.label}: {extra.value}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.unmappedKeys.length > 0 && (
              <p className="rounded-md bg-warning-50 px-2.5 py-2 text-xs text-warning-700">
                Not recognised as lead fields: <span className="font-medium">{result.unmappedKeys.join(', ')}</span>. Add a
                field mapping below if any of these should become a lead field.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5 border-t border-line pt-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Or post it yourself</span>
            <Button variant="ghost" size="sm" leftIcon={<Copy size={12} />} onClick={copyCurl}>
              Copy curl
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-shell-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-shell-100">
            {curl}
          </pre>
          <p className="text-xs text-ink-faint">This one is real — it creates a lead, unlike the dry run above.</p>
        </div>
      </div>
    </Modal>
  );
}
