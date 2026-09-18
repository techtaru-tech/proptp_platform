import { useEffect, useRef, type ReactNode } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Link2, List, ListOrdered, Quote, Redo2, Undo2,
} from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * A small HTML editor for email bodies — no dependency, no CDN.
 *
 * It drives a contentEditable with `document.execCommand`, which is formally deprecated but is
 * the only zero-dependency route every browser still implements, and is enough for the handful
 * of marks an email client will actually honour. Deliberately narrower than a document editor:
 * no tables, no images, no super/subscript, because those either break in email or need an
 * upload pipeline that has nothing to do with composing a message.
 */

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}

interface ToolProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

function Tool({ icon, label, onClick }: ToolProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Keeps the caret in the editor: a mousedown that moves focus would collapse the selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-ring"
    >
      {icon}
    </button>
  );
}

export function RichTextEditor({ value, onChange, placeholder, ariaLabel, className }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const empty = !value || value === '<br>';

  // Only write into the DOM when the value came from outside (loading a template, resetting the
  // form). Writing on every keystroke would reset the caret to the start of the line.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  const emit = () => onChange(ref.current?.innerHTML ?? '');

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt('Link URL', 'https://')?.trim();
    if (!url) return;
    // Only schemes an email client would follow. Without this an admin could paste a
    // `javascript:` URL that then runs wherever the body is rendered back.
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      window.alert('Links must start with https://, http://, mailto: or tel:');
      return;
    }
    exec('createLink', url);
  };

  return (
    <div className={cn('overflow-hidden rounded-lg border border-line-strong bg-white', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface-subtle px-1.5 py-1">
        <Tool icon={<Bold size={14} />} label="Bold" onClick={() => exec('bold')} />
        <Tool icon={<Italic size={14} />} label="Italic" onClick={() => exec('italic')} />
        <Tool icon={<Underline size={14} />} label="Underline" onClick={() => exec('underline')} />
        <Tool icon={<Strikethrough size={14} />} label="Strikethrough" onClick={() => exec('strikeThrough')} />
        <span className="mx-1 h-4 w-px bg-line" />
        <Tool icon={<span className="text-xs font-semibold">H2</span>} label="Heading 2" onClick={() => exec('formatBlock', 'h2')} />
        <Tool icon={<span className="text-xs font-semibold">H3</span>} label="Heading 3" onClick={() => exec('formatBlock', 'h3')} />
        <Tool icon={<Quote size={14} />} label="Quote" onClick={() => exec('formatBlock', 'blockquote')} />
        <span className="mx-1 h-4 w-px bg-line" />
        <Tool icon={<List size={14} />} label="Bulleted list" onClick={() => exec('insertUnorderedList')} />
        <Tool icon={<ListOrdered size={14} />} label="Numbered list" onClick={() => exec('insertOrderedList')} />
        <Tool icon={<Link2 size={14} />} label="Insert link" onClick={addLink} />
        <span className="mx-1 h-4 w-px bg-line" />
        <Tool icon={<Undo2 size={14} />} label="Undo" onClick={() => exec('undo')} />
        <Tool icon={<Redo2 size={14} />} label="Redo" onClick={() => exec('redo')} />
      </div>
      <div className="relative">
        {empty && placeholder && (
          <span className="pointer-events-none absolute left-3 top-2 text-sm text-ink-faint">{placeholder}</span>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          className="min-h-[7rem] w-full px-3 py-2 text-sm text-ink outline-none [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        />
      </div>
    </div>
  );
}
