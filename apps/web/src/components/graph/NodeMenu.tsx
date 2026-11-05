import { Archive, ArchiveRestore, CheckCircle2, Copy, Crosshair, Link2, Orbit, PanelRightOpen, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import type { UiGraphNode } from '../../lib/types';
import { useStore } from '../../state/store';
import { ARCHIVABLE_KINDS, ARCHIVED, closeStatus, DONE, openStatus } from '../../kinds/meta';

export interface MenuState { id: string; x: number; y: number }

/** Right-click (long-press on touch) menu of a graph node, anchored where the pointer was. */
export function NodeMenu({ menu, node, pinned, onClose, onRelease, onFocus, onShowGroup, onLink }: {
  menu: MenuState; node: UiGraphNode | null; pinned: boolean; onClose: () => void; onRelease: () => void; onFocus: () => void; onShowGroup: () => void; onLink: (title: string) => void;
}) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const select = useStore((s) => s.select);
  const openDialog = useStore((s) => s.openDialog);
  const setToast = useStore((s) => s.setToast);
  if (!node) return null;
  const real = !node.ghost;
  const finished = DONE.has(node.status);
  const archived = ARCHIVED.has(node.status);
  const closeAs = closeStatus(node.type);
  const set = async (status: string): Promise<void> => {
    try { await api.updateNode(node.id, { frontmatter: { status } }); } catch (e) { setToast((e as Error).message); }
  };
  return (
    <DropdownMenu.Root open onOpenChange={(o) => { if (!o) onClose(); }} dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
      <DropdownMenu.Trigger asChild>
        <span className="pointer-events-none absolute h-px w-px" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" sideOffset={4} align="start" collisionPadding={10} onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="menu-title"><bdi>{node.title}</bdi></div>
          <Item icon={<PanelRightOpen size={14} />} label={t('menu.open')} onSelect={() => select(node.id)} />
          <Item icon={<Crosshair size={14} />} label={t('menu.focus')} onSelect={onFocus} />
          <Item icon={<Orbit size={14} />} label={t('menu.showCategory')} onSelect={onShowGroup} />
          {real && !finished && !archived && closeAs !== 'archived' && <Item icon={<CheckCircle2 size={14} />} label={t(node.type === 'goal' ? 'menu.achieved' : 'menu.markDone')} onSelect={() => void set(closeAs)} />}
          {real && !archived && ARCHIVABLE_KINDS.has(node.type) && <Item icon={<Archive size={14} />} label={t('menu.archive')} onSelect={() => void set('archived')} />}
          {real && (finished || archived) && <Item icon={node.status === 'archived' ? <ArchiveRestore size={14} /> : <RotateCcw size={14} />} label={t(node.status === 'archived' ? 'menu.unarchive' : 'menu.reopen')} onSelect={() => void set(openStatus(node.type))} />}
          {real && <Item icon={<Link2 size={14} />} label={t('menu.linkTo')} onSelect={() => onLink(node.title)} />}
          {pinned && <Item icon={<PinOff size={14} />} label={t('menu.release')} onSelect={onRelease} />}
          <Item icon={<Copy size={14} />} label={t('menu.copy')} onSelect={() => void navigator.clipboard.writeText(node.title)} />
          {real && (
            <>
              <DropdownMenu.Separator className="menu-sep" />
              <Item icon={<Trash2 size={14} />} label={t('menu.delete')} danger onSelect={() => openDialog({ kind: 'delete', id: node.id })} />
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({ icon, label, onSelect, danger = false }: { icon: React.ReactNode; label: string; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className={`menu-item ${danger ? 'is-danger' : ''}`}>
      {icon}<span>{label}</span>
    </DropdownMenu.Item>
  );
}
