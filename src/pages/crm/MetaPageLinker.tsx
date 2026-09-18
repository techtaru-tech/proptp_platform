import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../context/ToastContext';
import { linkMetaPage } from '../../services/integrationService';

/**
 * Turns a user access token into a permanent Page token.
 *
 * Doing this by hand is where Meta setups usually break: the token Graph API Explorer gives
 * you is short-lived, and a Page token derived from it expires with it. The server exchanges
 * for a long-lived user token first, which is what makes the Page token permanent, then
 * subscribes the Page to `leadgen`.
 */
export function MetaPageLinker({ connectionId, onLinked }: { connectionId: string; onLinked: () => void }) {
  const { toast } = useToast();
  const [userToken, setUserToken] = useState('');
  const [pages, setPages] = useState<{ id: string; name: string }[] | null>(null);
  const [pageId, setPageId] = useState('');
  const [busy, setBusy] = useState(false);

  const loadPages = async () => {
    setBusy(true);
    try {
      const result = await linkMetaPage(connectionId, { userAccessToken: userToken.trim() });
      setPages(result.pages ?? []);
      if ((result.pages ?? []).length === 1) setPageId(result.pages![0].id);
      toast({ title: `${result.pages?.length ?? 0} Page(s) found`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not read Pages', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    setBusy(true);
    try {
      const result = await linkMetaPage(connectionId, { userAccessToken: userToken.trim(), pageId });
      toast({
        title: `Linked ${result.page?.name}`,
        description: 'The Page is subscribed to leadgen. New form submissions will arrive from now on.',
        variant: 'success',
      });
      setUserToken('');
      setPages(null);
      setPageId('');
      onLinked();
    } catch (err) {
      toast({ title: 'Could not link the Page', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface-subtle p-3">
      <p className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-ink">
        <Link2 size={14} /> Link a Page
      </p>

      <div className="space-y-2.5">
        <div className="flex items-end gap-2">
          <Input
            label="User access token"
            type="password"
            secret
            value={userToken}
            onChange={(e) => {
              setUserToken(e.target.value);
              setPages(null);
            }}
            placeholder="EAA..."
            hint="Needs leads_retrieval + pages_manage_metadata."
            wrapperClassName="flex-1"
          />
          <Button variant="outline" isLoading={busy} disabled={!userToken.trim()} onClick={loadPages}>
            Find Pages
          </Button>
        </div>

        {pages === null ? null : pages.length === 0 ? (
          <p className="text-xs text-danger-600">
            This login does not manage any Facebook Page. Make yourself an admin of the Page first.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <Select
              label="Page"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              options={[{ value: '', label: 'Select a Page' }, ...pages.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` }))]}
              wrapperClassName="flex-1"
            />
            <Button variant="primary" size="sm" isLoading={busy} disabled={!pageId} onClick={link}>
              Link &amp; Subscribe
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
