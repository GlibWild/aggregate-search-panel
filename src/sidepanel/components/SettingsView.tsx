/**
 * 设置页。
 */
import type { SearchStrategy, Settings } from '../../shared/types';
import { Icon, Switch } from './Ui';

interface SettingsViewProps {
  settings: Settings;
  historyCount: number;
  onChange: (patch: Partial<Settings>) => void;
  onClearHistory: () => void;
}

export function SettingsView({ settings, historyCount, onChange, onClearHistory }: SettingsViewProps) {
  return (
    <div className="settings-view">
      <section className="settings-section">
        <h3>
          <Icon name="search" size={16} />
          搜索引擎
        </h3>
        <div className="field-row">
          <label className="field">
            <span className="field-label">每站结果数</span>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={settings.maxResultsPerSite}
              onChange={(event) =>
                onChange({ maxResultsPerSite: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">并发站点数</span>
            <select
              className="input"
              value={settings.concurrency}
              onChange={(event) => onChange({ concurrency: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">默认抓取策略</span>
          <select
            className="input"
            value={settings.defaultStrategy}
            onChange={(event) => onChange({ defaultStrategy: event.target.value as SearchStrategy })}
          >
            <option value="auto">自动：后台请求优先，失败回退隐藏标签页</option>
            <option value="fetch">仅后台请求（最快）</option>
            <option value="tab">仅隐藏标签页（兼容性最好）</option>
          </select>
          <span className="field-hint">
            隐藏标签页会在后台真实加载搜索页，适用于依赖脚本渲染的站点；可能短暂出现在标签栏。
          </span>
        </label>
        <Switch
          label="在新标签页打开结果"
          description="关闭后会在当前标签页跳转"
          checked={settings.openLinksInNewTab}
          onChange={(value) => onChange({ openLinksInNewTab: value })}
        />
      </section>

      <section className="settings-section">
        <h3>
          <Icon name="shield" size={16} />
          登录与安全
        </h3>
        <label className="field">
          <span className="field-label">登录态检测间隔（分钟）</span>
          <input
            className="input"
            type="number"
            min={1}
            max={120}
            value={settings.sessionCheckMinutes}
            onChange={(event) =>
              onChange({ sessionCheckMinutes: Math.max(1, Math.min(120, Number(event.target.value) || 1)) })
            }
          />
          <span className="field-hint">
            定期检查关键 Cookie 是否仍然存在；过期后会弹出系统通知并在面板标红。
          </span>
        </label>
        <Switch
          label="登录过期后发送系统通知"
          description="点击通知可直接打开面板重新扫码"
          checked={settings.notifyOnExpire}
          onChange={(value) => onChange({ notifyOnExpire: value })}
        />
        <Switch
          label="登录成功后自动关闭登录窗口"
          checked={settings.closeLoginWindowOnSuccess}
          onChange={(value) => onChange({ closeLoginWindowOnSuccess: value })}
        />
        <Switch
          label="登录后自动备份登录凭证"
          description="使用 AES-GCM 加密保存 Cookie 快照，便于在失效后快速恢复；密钥保存在本地，默认关闭"
          checked={settings.vaultEnabled}
          onChange={(value) => onChange({ vaultEnabled: value })}
        />
        <div className="settings-note">
          <Icon name="key" size={14} />
          <span>
            登录状态本身由浏览器 Cookie 维护，扩展只记录登录时间与过期时间。凭证快照为可选功能，
            需要时可单独备份/恢复；扩展不会把任何 Cookie 上传到网络。
          </span>
        </div>
      </section>

      <section className="settings-section">
        <h3>
          <Icon name="shield" size={16} />
          屏蔽的域名
        </h3>
        {(settings.blockedDomains ?? []).length === 0 ? (
          <div className="settings-note">
            <span>暂无。在搜索结果右侧点击“屏蔽”即可添加，该域名及其子域名的结果将不再显示。</span>
          </div>
        ) : (
          (settings.blockedDomains ?? []).map((domain) => (
            <div className="settings-row" key={domain}>
              <span>{domain}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  onChange({ blockedDomains: (settings.blockedDomains ?? []).filter((item) => item !== domain) })
                }
              >
                解除
              </button>
            </div>
          ))
        )}
      </section>

      <section className="settings-section">
        <h3>
          <Icon name="clock" size={16} />
          数据
        </h3>
        <div className="settings-row">
          <span>搜索历史（{historyCount} 条）</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearHistory} disabled={historyCount === 0}>
            <Icon name="trash" size={14} />
            清空历史
          </button>
        </div>
        <div className="settings-note">
          <Icon name="alert" size={14} />
          <span>
            站点配置与登录元数据保存在扩展本地存储中。卸载扩展会同时删除这些数据，但不会影响浏览器
            自身的站点 Cookie；如需迁移，可使用站点页的“导出”功能。
          </span>
        </div>
      </section>

      <section className="settings-section">
        <h3>
          <Icon name="layers" size={16} />
          工作原理
        </h3>
        <ol className="how-list">
          <li>在弹窗中打开站点登录页，扩展自动定位二维码并在面板中显示，扫码后由 Cookie 变化确认登录成功。</li>
          <li>搜索时按站点配置抓取搜索页：优先后台请求解析；需要登录态或前端渲染时回退到隐藏标签页。</li>
          <li>点击结果由扩展打开目标页面，不会修改目标站点内容。</li>
          <li>登录过期由关键 Cookie 检查与兜底有效期共同判定，过期后提示重新扫码。</li>
        </ol>
        <p className="about-line">聚合搜索 · 多站点扫码登录面板 v1.0.5</p>
      </section>
    </div>
  );
}
