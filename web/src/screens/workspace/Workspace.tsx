// Espace de travail (commande WS ; bouton « Personnaliser ») : les écrans du terminal en panneaux
// dockview que l'on glisse, divise, redimensionne et empile en onglets ; mises en page nommées et
// disposition en cours gardées dans ce navigateur ; panneaux liés par l'actif (heatmap technique,
// indicateurs, saisonnalité). Sur téléphone, la disposition libre n'a pas de sens : liste des écrans.

import 'dockview-react/dist/styles/dockview.css';
import './workspace.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DockviewReact, themeAbyss, type DockviewApi, type IDockviewPanelProps } from 'dockview-react';
import { Button, Chip } from '../../components/ui';
import { HelpScope } from '../../help/scope';
import { ALL_MODULES } from '../../modules';
import { SubHeader } from '../../shell/SubHeader';
import { deleteLayout, LayoutError, listLayouts, loadCurrent, PRESETS, saveCurrent, saveLayout, type SavedLayout } from '../../workspace/layouts';
import { LinkContext } from '../../workspace/link';

export const LINK_ASSETS = ['BTC', 'ETH', 'QQQ', 'SPY', 'EURUSD', 'USDJPY', 'XAUUSD'] as const;
type Screens = Record<string, () => React.JSX.Element>;
const label = (id: string) => ALL_MODULES.find((m) => m.id === id)?.label ?? id;

function narrow(): boolean { return typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches; }

export function WorkspaceScreen({ screens }: { screens: Screens }) {
  const api = useRef<DockviewApi | null>(null);
  const [asset, setAsset] = useState<string>(() => loadCurrent()?.asset ?? 'BTC');
  const [layouts, setLayouts] = useState<SavedLayout[]>(() => listLayouts());
  const [add, setAdd] = useState('micro');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [count, setCount] = useState(0);
  const [small, setSmall] = useState(narrow);
  const seq = useRef(0);
  const assetRef = useRef(asset);
  assetRef.current = asset;
  useEffect(() => { const m = window.matchMedia('(max-width: 720px)'); const f = () => setSmall(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);

  const choices = useMemo(() => ALL_MODULES.filter((m) => screens[m.id] && m.id !== 'workspace'), [screens]);
  const components = useMemo(() => ({
    screen: (p: IDockviewPanelProps<{ screen: string }>) => {
      const S = screens[p.params.screen];
      return <HelpScope id={p.params.screen}><div className="ws-pane">{S ? <S /> : <p className="ws-missing">{`Écran inconnu : ${p.params.screen}`}</p>}</div></HelpScope>;
    },
  }), [screens]);

  const persist = useCallback(() => { if (api.current) saveCurrent(api.current.toJSON(), assetRef.current); setCount(api.current?.panels.length ?? 0); }, []);
  const addScreen = (screen: string, position?: { referencePanel: string; direction: 'right' | 'below' | 'within' }) => {
    const a = api.current;
    if (!a) return null;
    const id = `${screen}-${Date.now().toString(36)}-${seq.current++}`;
    a.addPanel({ id, component: 'screen', params: { screen }, title: label(screen), ...(position ? { position } : {}) });
    return id;
  };
  const applyPreset = (presetId: string) => {
    const p = PRESETS.find((x) => x.id === presetId); const a = api.current;
    if (!p || !a) return;
    a.clear();
    const ids: string[] = [];
    for (const s of p.panels) ids.push(addScreen(s.screen, s.position ? { referencePanel: ids[s.position.ref], direction: s.position.direction } : undefined)!);
    setMsg({ ok: true, text: `Modèle « ${p.label} » ouvert.` });
    persist();
  };

  const onReady = (e: { api: DockviewApi }) => {
    api.current = e.api;
    const cur = loadCurrent();
    try { if (cur) e.api.fromJSON(cur.layout as Parameters<DockviewApi['fromJSON']>[0]); } catch { e.api.clear(); }
    if (!e.api.panels.length) applyPreset('btc');
    e.api.onDidLayoutChange(() => persist());
    persist();
  };
  useEffect(() => { persist(); }, [asset, persist]);

  const save = () => {
    try {
      setLayouts(saveLayout(name, api.current?.toJSON(), asset, Date.now()));
      setMsg({ ok: true, text: `Mise en page « ${name.trim()} » enregistrée dans ce navigateur.` });
    } catch (x) { setMsg({ ok: false, text: x instanceof LayoutError ? x.message : String(x) }); }
  };
  const open = (n: string) => {
    const l = layouts.find((x) => x.name === n); const a = api.current;
    if (!l || !a) return;
    try { a.fromJSON(l.layout as Parameters<DockviewApi['fromJSON']>[0]); if (l.asset) setAsset(l.asset); setName(l.name); setMsg({ ok: true, text: `Mise en page « ${n} » ouverte.` }); persist(); }
    catch { setMsg({ ok: false, text: `Mise en page « ${n} » illisible (version de dockview ?) : supprimer et recréer.` }); }
  };

  const link = useMemo(() => ({ asset, setAsset }), [asset]);
  return (
    <>
      <SubHeader icon="sliders" title="Espace de travail · disposition libre"
        chips={<Chip variant="hot" round>{`${count} écran${count > 1 ? 's' : ''} · gardé dans ce navigateur`}</Chip>} />
      {small ? (
        <div className="content ws-small" data-screen="workspace">
          <p className="ws-note">La disposition libre se compose sur un écran large. Ouvrir un écran :</p>
          <ul className="ws-list">{choices.map((m) => <li key={m.id}><Link to={m.path}>{m.label}</Link></li>)}</ul>
        </div>
      ) : (
        <div className="ws" data-screen="workspace">
          <div className="ws-bar" role="toolbar" aria-label="Espace de travail">
            <label className="ws-f"><span className="lbl lbl--s">Écran</span>
              <select className="input" value={add} onChange={(e) => setAdd(e.target.value)}>{choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <Button variant="primary" onClick={() => { addScreen(add); persist(); }}>Ajouter</Button>
            <span className="ws-sep" />
            <label className="ws-f"><span className="lbl lbl--s">Modèle</span>
              <select className="input" value="" onChange={(e) => e.target.value && applyPreset(e.target.value)} aria-label="Ouvrir un modèle">
                <option value="">Choisir…</option>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            <span className="ws-sep" />
            <label className="ws-f"><span className="lbl lbl--s">Nom</span>
              <input className="input" value={name} maxLength={40} placeholder="Ma séance" onChange={(e) => setName(e.target.value)} /></label>
            <Button onClick={save}>Enregistrer</Button>
            <label className="ws-f"><span className="lbl lbl--s">Mes mises en page</span>
              <select className="input" value="" onChange={(e) => e.target.value && open(e.target.value)} aria-label="Ouvrir une mise en page">
                <option value="">{layouts.length ? 'Ouvrir…' : 'aucune'}</option>{layouts.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}</select></label>
            {layouts.some((l) => l.name === name.trim()) && <Button onClick={() => { setLayouts(deleteLayout(name.trim())); setMsg({ ok: true, text: `« ${name.trim()} » supprimée.` }); }}>Supprimer</Button>}
            <Button onClick={() => { api.current?.clear(); persist(); }}>Vider</Button>
            <span className="ws-sep" />
            <label className="ws-f" title="Panneaux liés : l’actif choisi ici s’applique à la heatmap technique, aux indicateurs et à la saisonnalité de l’espace"><span className="lbl lbl--s">Actif lié</span>
              <select className="input" value={asset} onChange={(e) => setAsset(e.target.value)} data-testid="ws-asset">{LINK_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
            {msg && <span className={`ws-msg ${msg.ok ? '' : 'dn'}`} role="status">{msg.text}</span>}
          </div>
          <LinkContext.Provider value={link}>
            <DockviewReact className="ws-dock" theme={themeAbyss} components={components} onReady={onReady} />
          </LinkContext.Provider>
        </div>
      )}
    </>
  );
}
