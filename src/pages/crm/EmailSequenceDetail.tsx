import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mail, Pencil, Square } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/ui/StatCard';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getEmailSequence, listSequenceEnrollments, listSequenceSends, stopSequenceEnrollment,
  ENROLLMENT_STATUS_TONE, SEQUENCE_STATUS_TONE,
} from '../../services/emailSequenceService';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import type { EmailSequenceEnrollment } from '../../types';

export function EmailSequenceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [threadFor, setThreadFor] = useState<EmailSequenceEnrollment | null>(null);

  const { data: sequence, isLoading, error } = useAsync(() => getEmailSequence(id ?? ''), [id, reloadKey]);
  const { data: enrollments, isLoading: enrollmentsLoading } = useAsync(
    () => listSequenceEnrollments(id ?? ''),
    [id, reloadKey]
  );
  const { data: sends } = useAsync(
    () => (threadFor ? listSequenceSends(threadFor.id) : Promise.resolve([])),
    [threadFor?.id]
  );

  if (isLoading) return <CardSkeleton />;
  if (error || !sequence) {
    return <ErrorState title="Sequence not found" description={error?.message ?? 'This sequence may have been deleted.'} />;
  }

  const handleStop = async (enrollment: EmailSequenceEnrollment) => {
    await stopSequenceEnrollment(enrollment.id);
    toast({ title: 'Enrollment stopped', description: `${enrollment.leadName} will receive no further steps.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<EmailSequenceEnrollment>[] = [
    {
      key: 'lead',
      header: 'Lead',
      render: (e) => (
        <div>
          <p className="font-medium text-ink">{e.leadName}</p>
          <p className="text-xs text-ink-faint">{e.leadEmail ?? 'No email on file'}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (e) => <Badge tone={ENROLLMENT_STATUS_TONE[e.status]}>{e.status}</Badge> },
    {
      key: 'progress',
      header: 'Progress',
      align: 'center',
      render: (e) => (
        <span className="text-sm text-ink">
          {e.sendCount}
          <span className="text-ink-faint"> / {sequence.stepCount} sent</span>
        </span>
      ),
    },
    {
      key: 'next',
      header: 'Next step',
      render: (e) =>
        e.status !== 'active' ? (
          <span className="text-xs text-ink-faint">{e.stoppedReason ?? '—'}</span>
        ) : e.nextSendAt ? (
          <span className="text-sm text-ink-muted">{formatRelativeTime(e.nextSendAt)}</span>
        ) : (
          '—'
        ),
    },
    { key: 'enrolled', header: 'Enrolled', render: (e) => formatDateTime(e.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (e) => (
        <div className="flex justify-end gap-1" onClick={(evt) => evt.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<Mail size={13} />} onClick={() => setThreadFor(e)}>
            Emails
          </Button>
          {e.status === 'active' && (
            <Button variant="ghost" size="sm" leftIcon={<Square size={13} />} onClick={() => handleStop(e)}>
              Stop
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={sequence.name}
        description={sequence.description}
        breadcrumb={[
          { label: 'CRM', to: '/crm' },
          { label: 'Email Sequences', to: '/crm/email-sequences' },
          { label: sequence.name },
        ]}
        actions={
          <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={() => navigate(`/crm/email-sequences/${sequence.id}/edit`)}>
            Edit Sequence
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Status" value={sequence.status} tone={SEQUENCE_STATUS_TONE[sequence.status] === 'success' ? 'success' : 'neutral'} />
        <StatCard label="Steps" value={String(sequence.stepCount)} />
        <StatCard label="Active" value={String(sequence.activeEnrollments)} tone="info" />
        <StatCard label="Completed" value={String(sequence.completedEnrollments)} tone="success" />
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={enrollments ?? []}
          rowKey={(e) => e.id}
          isLoading={enrollmentsLoading}
          emptyTitle="No leads enrolled"
          emptyDescription="Enrol leads from the leads list (select them, then Enroll in sequence) or with an automation action."
        />
      </Card>

      <Modal
        isOpen={!!threadFor}
        onClose={() => setThreadFor(null)}
        title={threadFor ? `Emails to ${threadFor.leadName}` : ''}
        size="lg"
      >
        {(sends ?? []).length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing has gone out for this lead yet.</p>
        ) : (
          <div className="space-y-3">
            {(sends ?? []).map((send) => (
              <div key={send.id} className="rounded-lg border border-line p-3">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink">
                    Step {send.stepIndex + 1} · {send.subject}
                  </p>
                  <Badge tone={send.status === 'sent' ? 'success' : 'danger'}>{send.status}</Badge>
                </div>
                <div
                  className="text-sm text-ink-muted [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                  // First-party content: the body is HTML an admin authored in the sequence
                  // builder, stored as rendered at send time. Not lead-supplied input.
                  dangerouslySetInnerHTML={{ __html: send.body }}
                />
                <p className="mt-2 text-xs text-ink-faint">
                  {formatDateTime(send.sentAt)}
                  {send.message ? ` · ${send.message}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
