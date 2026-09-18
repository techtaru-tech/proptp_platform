import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Modal } from './Modal';
import { Button, type ButtonVariant } from './Button';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ButtonVariant;
  audited?: boolean;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  audited = true,
}: ConfirmationDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={handleConfirm} isLoading={isSubmitting}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {audited && (
        <div className="flex items-start gap-2 rounded-lg bg-surface-subtle px-3 py-2.5 text-xs text-ink-muted">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-ink-faint" />
          <span>This action will be recorded in the audit trail with your admin identity and a timestamp.</span>
        </div>
      )}
    </Modal>
  );
}
