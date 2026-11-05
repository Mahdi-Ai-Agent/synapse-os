import type { CategoryInfo } from '@synapse/core';
import { useMemo } from 'react';
import { autoTone, categoryHue, familyBaseRgb, familyRgb, forLight, groupRgb, rgbToHex, zoneHue, type Rgb, type Tone } from '../graph/colors';
import { CLOSED, familyTones, groupKey, rgbCss, withColorDraft } from '../graph/model';
import { INBOX_GROUP, JOURNAL_GROUP, MAP_GROUP } from '../graph/layout';
import { useStore } from '../state/store';
import type { UiGraphNode } from './types';

export interface Palette {
  /** Signature colour of a category, a map's centre group (`map:<id>`) or a special group id. */
  group(id: string | null | undefined): string;
  /** Colour of a node: its shade inside its category family (a map's centre in the map's family). */
  node(n: (Pick<UiGraphNode, 'category' | 'type' | 'status' | 'ghost'> & { id?: string }) | undefined): string;
  category(id: string | null | undefined): CategoryInfo | undefined;
  categories: CategoryInfo[];
  /** A category's or a map's base colour as hex, a colour being picked included (the colour picker's mark). */
  base(id: string): string;
  /** What a category or a map is drawn in without an own colour (the picker's Automatic): a map's categories follow the map. */
  auto(id: string): string;
}

function specialRgb(group: string, type: string, closed: boolean): Rgb {
  return groupRgb(group === INBOX_GROUP ? 'inbox' : group === JOURNAL_GROUP ? 'journal' : 'unsorted', type, closed);
}

/**
 * Category colours for chips, cards and panels, consistent with the graph (spec: docs/UI-DESIGN.md "Colour"): the
 * categories of a map share the map's tone unless they have their own, as on the canvas (UI-DESIGN "Maps"); a colour
 * being picked (`store.colorDraft`) shows everywhere at once.
 */
export function usePalette(): Palette {
  const categories = useStore((s) => s.graph?.categories);
  const maps = useStore((s) => s.graph?.maps);
  const draft = useStore((s) => s.colorDraft);
  const theme = useStore((s) => s.theme);
  return useMemo(() => {
    const list = withColorDraft([...(categories ?? [])].sort((a, b) => a.order - b.order), draft);
    const mapList = withColorDraft(maps ?? [], draft);
    const tone = familyTones(list, mapList);
    const byId = new Map(list.map((c) => [c.id, c]));
    const mapById = new Map(mapList.map((m) => [m.id, m]));
    const hex = (t: Tone): string => rgbToHex(familyBaseRgb(t));
    // On the light theme names, orbs and icons take the darker shade the map uses (graph/colors.ts forLight).
    const ui = (c: Rgb): string => rgbCss(theme === 'light' ? forLight(c) : c);
    return {
      categories: list,
      category: (id) => (id ? byId.get(id) : undefined),
      group: (id) => {
        const t = id ? tone.get(id) : undefined;
        return ui(t ? familyBaseRgb(t) : specialRgb(id ?? '', 'area', false));
      },
      node: (n) => {
        if (!n) return ui(specialRgb('', 'note', false));
        const g = groupKey(n);
        const t = tone.get(g);
        const kind = n.ghost ? 'ghost' : n.type === 'map' || n.type === 'core' ? 'area' : n.type;
        const closed = CLOSED.has(n.status);
        return ui(t ? familyRgb(t, kind, closed) : specialRgb(g, kind, closed));
      },
      base: (id) => {
        const t = tone.get(id) ?? tone.get(MAP_GROUP + id);
        return t ? hex(t) : hex(autoTone(categoryHue(0)));
      },
      auto: (id) => {
        const c = byId.get(id);
        if (c) return hex((c.map ? tone.get(MAP_GROUP + c.map) : undefined) ?? autoTone(categoryHue(c.order)));
        const m = mapById.get(id);
        return hex(autoTone(m ? zoneHue(m.order, m.role) : categoryHue(0)));
      },
    };
  }, [categories, maps, draft, theme]);
}
