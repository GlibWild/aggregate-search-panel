/**
 * 站点管理页：按搜索分组折叠展示，支持分组重命名、解散与站点换组。
 */
import { useState } from 'react';
import type { LoginFlowState, SiteConfig, SiteSession } from '../../shared/types';
import type { VaultStatusResult } from '../../shared/messages';
import { EmptyState, Icon } from './Ui';
import { SiteCard } from './SiteCard';

const UNGROUPED = '未分组';
const NEW_GROUP = '__new__';

interface SitesViewProps {
  sites: SiteConfig[];
  sessions: Record<string, SiteSession>;
  flows: Record<string, LoginFlowState>;
  granted: Record<string, boolean>;
  busy: Record<string, boolean>;
  vaults: Record<string, VaultStatusResult>;
  onAdd: () => void;
  onImport: () => void;
  onExport: () => void;
  onLogin: (siteId: string) => void;
  onCancelLogin: (siteId: string) => void;
  onRefreshQr: (siteId: string) => void;
  onFocusLogin: (siteId: string) => void;
  onCheck: (siteId: string) => void;
  onEdit: (site: SiteConfig) => void;
  onDelete: (site: SiteConfig) => void;
  onToggle: (site: SiteConfig) => void;
  onGrant: (site: SiteConfig) => void;
  onOpen: (url: string) => void;
  onDiagnose: (siteId: string) => void;
  onSaveVault: (siteId: string) => void;
  onRestoreVault: (siteId: string) => void;
  onDeleteVault: (siteId: string) => void;
  onSetGroups: (updates: Array<{ siteId: string; group?: string }>) => void;
}

export function SitesView(props: SitesViewProps) {
  const { sites, onAdd, onImport, onExport, onSetGroups } = props;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groupMap = new Map<string, SiteConfig[]>();
  sites.forEach((site) => {
    const name = site.group?.trim() || UNGROUPED;
    groupMap.set(name, [...(groupMap.get(name) ?? []), site]);
  });
  const groupNames = [...groupMap.keys()].filter((name) => name !== UNGROUPED);
  const sections: Array<[string, SiteConfig[]]> = [
    ...groupNames.map((name) => [name, groupMap.get(name) ?? []] as [string, SiteConfig[]]),
    ...(groupMap.has(UNGROUPED) ? [[UNGROUPED, groupMap.get(UNGROUPED) ?? []] as [string, SiteConfig[]]] : []),
  ];

  const renameGroup = (name: string, members: SiteConfig[]): void => {
    const next = window.prompt(`重命名分组「${name}」为：`, name)?.trim();
    if (!next || next === name) {
      return;
    }
    if (next === UNGROUPED) {
      window.alert(`“${UNGROUPED}”是保留名称，请换一个`);
      return;
    }
    onSetGroups(members.map((site) => ({ siteId: site.id, group: next })));
  };

  const dissolveGroup = (name: string, members: SiteConfig[]): void => {
    if (!window.confirm(`解散分组「${name}」？其中 ${members.length} 个站点会移到“${UNGROUPED}”，站点本身不会删除。`)) {
      return;
    }
    onSetGroups(members.map((site) => ({ siteId: site.id, group: undefined })));
  };

  const moveSite = (site: SiteConfig, value: string): void => {
    let group: string | undefined = value;
    if (value === NEW_GROUP) {
      const input = window.prompt('新分组名称：')?.trim();
      if (!input || input === UNGROUPED) {
        return;
      }
      group = input;
    } else if (value === UNGROUPED) {
      group = undefined;
    }
    onSetGroups([{ siteId: site.id, group }]);
  };

  return (
    <div className="sites-view">
      <div className="toolbar">
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          <Icon name="plus" size={15} />
          添加站点
        </button>
        <button type="button" className="btn btn-ghost" onClick={onImport}>
          <Icon name="upload" size={15} />
          导入
        </button>
        <button type="button" className="btn btn-ghost" onClick={onExport} disabled={sites.length === 0}>
          <Icon name="download" size={15} />
          导出
        </button>
      </div>

      {sites.length === 0 ? (
        <EmptyState
          icon="layers"
          title="还没有添加站点"
          description="从内置模板快速开始，或手动填写站点主页、登录页与搜索地址。"
          action={
            <button type="button" className="btn btn-primary" onClick={onAdd}>
              <Icon name="plus" size={15} />
              添加第一个站点
            </button>
          }
        />
      ) : (
        <div className="site-groups">
          {sections.map(([name, members]) => {
            const isCollapsed = Boolean(collapsed[name]);
            const isUngrouped = name === UNGROUPED;
            return (
              <section className="site-group" key={name}>
                <header className="site-group-head">
                  <button
                    type="button"
                    className="site-group-toggle"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }))}
                    title={isCollapsed ? '展开' : '折叠'}
                  >
                    <span className="site-group-caret">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="site-group-name">{name}</span>
                    <span className="site-group-count">{members.length}</span>
                  </button>
                  {!isUngrouped ? (
                    <span className="site-group-actions">
                      <button type="button" className="text-btn" onClick={() => renameGroup(name, members)}>
                        重命名
                      </button>
                      <button type="button" className="text-btn" onClick={() => dissolveGroup(name, members)}>
                        解散
                      </button>
                    </span>
                  ) : null}
                </header>
                {isCollapsed ? null : (
                  <div className="site-list">
                    {members.map((site) => (
                      <div className="site-group-item" key={site.id}>
                        <label className="site-group-move">
                          <span>分组</span>
                          <select
                            className="input input-sm"
                            value={site.group?.trim() || UNGROUPED}
                            onChange={(event) => moveSite(site, event.target.value)}
                          >
                            {groupNames.map((groupName) => (
                              <option key={groupName} value={groupName}>
                                {groupName}
                              </option>
                            ))}
                            <option value={UNGROUPED}>{UNGROUPED}</option>
                            <option value={NEW_GROUP}>+ 新建分组…</option>
                          </select>
                        </label>
                        <SiteCard
                          site={site}
                          session={props.sessions[site.id]}
                          flow={props.flows[site.id]}
                          granted={props.granted[site.id] !== false}
                          busy={Boolean(props.busy[site.id])}
                          vault={props.vaults[site.id]}
                          onLogin={() => props.onLogin(site.id)}
                          onCancelLogin={() => props.onCancelLogin(site.id)}
                          onRefreshQr={() => props.onRefreshQr(site.id)}
                          onFocusLogin={() => props.onFocusLogin(site.id)}
                          onCheck={() => props.onCheck(site.id)}
                          onEdit={() => props.onEdit(site)}
                          onDelete={() => props.onDelete(site)}
                          onToggleEnabled={() => props.onToggle(site)}
                          onGrant={() => props.onGrant(site)}
                          onOpen={() => props.onOpen(site.homepage)}
                          onDiagnose={() => props.onDiagnose(site.id)}
                          onSaveVault={() => props.onSaveVault(site.id)}
                          onRestoreVault={() => props.onRestoreVault(site.id)}
                          onDeleteVault={() => props.onDeleteVault(site.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
