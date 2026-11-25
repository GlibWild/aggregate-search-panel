/**
 * 站点新增 / 编辑表单。
 */
import { useMemo, useState } from 'react';
import { SITE_PRESETS, type SitePreset } from '../../shared/presets';
import type { SearchStrategy, SiteApiConfig, SiteConfig, SiteDraft } from '../../shared/types';
import { getOriginPatterns, isHttpUrl, normalizeKeyword } from '../../shared/url-utils';
import { Field, Icon, Spinner } from './Ui';

interface SiteEditorProps {
  mode: 'create' | 'edit';
  initial?: SiteConfig;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: SiteDraft) => Promise<void>;
  onRequestPermission: (origins: string[]) => Promise<boolean>;
  onNotice: (level: 'info' | 'warn' | 'error', message: string) => void;
}

interface FormState {
  name: string;
  homepage: string;
  iconUrl: string;
  enabled: boolean;
  group: string;
  notes: string;
  loginUrl: string;
  qrSelector: string;
  refreshButtonSelector: string;
  successUrlPattern: string;
  successCookieName: string;
  successSelector: string;
  sessionCookieNames: string;
  sessionTtlMinutes: string;
  autoDetectAuthCookie: boolean;
  searchTemplate: string;
  strategy: SearchStrategy;
  requiresLogin: boolean;
  sameSiteOnly: boolean;
  allowedDomains: string;
  maxResults: string;
  resultSelector: string;
  titleSelector: string;
  linkSelector: string;
  snippetSelector: string;
  apiEnabled: boolean;
  apiUrl: string;
  apiMethod: 'GET' | 'POST';
  apiBody: string;
  apiHeaders: string;
  apiListPath: string;
  apiTitlePath: string;
  apiLinkPath: string;
  apiSnippetPath: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  homepage: '',
  iconUrl: '',
  enabled: true,
  group: '',
  notes: '',
  loginUrl: '',
  qrSelector: '',
  refreshButtonSelector: '',
  successUrlPattern: '',
  successCookieName: '',
  successSelector: '',
  sessionCookieNames: '',
  sessionTtlMinutes: '',
  autoDetectAuthCookie: true,
  searchTemplate: '',
  strategy: 'auto',
  requiresLogin: true,
  sameSiteOnly: true,
  allowedDomains: '',
  maxResults: '',
  resultSelector: '',
  titleSelector: '',
  linkSelector: '',
  snippetSelector: '',
  apiEnabled: false,
  apiUrl: '',
  apiMethod: 'GET',
  apiBody: '',
  apiHeaders: '',
  apiListPath: '',
  apiTitlePath: '',
  apiLinkPath: '',
  apiSnippetPath: '',
};

function formFromSite(site: SiteConfig): FormState {
  return {
    ...EMPTY_FORM,
    name: site.name,
    homepage: site.homepage,
    iconUrl: site.iconUrl ?? '',
    enabled: site.enabled,
    group: site.group ?? '',
    notes: site.notes ?? '',
    loginUrl: site.login.loginUrl,
    qrSelector: site.login.qrSelector ?? '',
    refreshButtonSelector: site.login.refreshButtonSelector ?? '',
    successUrlPattern: site.login.successUrlPattern ?? '',
    successCookieName: site.login.successCookieName ?? '',
    successSelector: site.login.successSelector ?? '',
    sessionCookieNames: site.login.sessionCookieNames.join(', '),
    sessionTtlMinutes: site.login.sessionTtlMinutes ? String(site.login.sessionTtlMinutes) : '',
    autoDetectAuthCookie: site.login.autoDetectAuthCookie,
    searchTemplate: site.search.urlTemplate,
    strategy: site.search.strategy ?? 'auto',
    requiresLogin: site.search.requiresLogin,
    sameSiteOnly: site.search.sameSiteOnly !== false,
    allowedDomains: (site.search.allowedDomains ?? []).join(', '),
    maxResults: site.search.maxResults ? String(site.search.maxResults) : '',
    resultSelector: site.search.resultSelector ?? '',
    titleSelector: site.search.titleSelector ?? '',
    linkSelector: site.search.linkSelector ?? '',
    snippetSelector: site.search.snippetSelector ?? '',
    apiEnabled: Boolean(site.search.api),
    apiUrl: site.search.api?.urlTemplate ?? '',
    apiMethod: site.search.api?.method ?? 'GET',
    apiBody: site.search.api?.bodyTemplate ?? '',
    apiHeaders: site.search.api?.headers ? JSON.stringify(site.search.api.headers, null, 2) : '',
    apiListPath: site.search.api?.listPath ?? '',
    apiTitlePath: site.search.api?.titlePath ?? '',
    apiLinkPath: site.search.api?.linkPath ?? '',
    apiSnippetPath: site.search.api?.snippetPath ?? '',
  };
}

function formFromPreset(preset: SitePreset): FormState {
  return {
    ...EMPTY_FORM,
    name: preset.draft.name,
    homepage: preset.draft.homepage,
    group: preset.draft.group ?? '',
    notes: preset.draft.notes ?? '',
    loginUrl: preset.draft.login.loginUrl,
    qrSelector: preset.draft.login.qrSelector ?? '',
    successUrlPattern: preset.draft.login.successUrlPattern ?? '',
    successCookieName: preset.draft.login.successCookieName ?? '',
    successSelector: preset.draft.login.successSelector ?? '',
    sessionCookieNames: preset.draft.login.sessionCookieNames.join(', '),
    sessionTtlMinutes: preset.draft.login.sessionTtlMinutes
      ? String(preset.draft.login.sessionTtlMinutes)
      : '',
    autoDetectAuthCookie: preset.draft.login.autoDetectAuthCookie,
    searchTemplate: preset.draft.search.urlTemplate,
    strategy: preset.draft.search.strategy ?? 'auto',
    requiresLogin: preset.draft.search.requiresLogin,
    sameSiteOnly: preset.draft.search.sameSiteOnly !== false,
    allowedDomains: (preset.draft.search.allowedDomains ?? []).join(', '),
  };
}

export function SiteEditor({
  mode,
  initial,
  saving,
  onClose,
  onSave,
  onRequestPermission,
  onNotice,
}: SiteEditorProps) {
  const [form, setForm] = useState<FormState>(initial ? formFromSite(initial) : EMPTY_FORM);
  const [error, setError] = useState('');

  const origins = useMemo(() => {
    const candidates = [
      form.homepage,
      form.loginUrl,
      form.searchTemplate,
      form.apiEnabled ? form.apiUrl : '',
    ];
    return [...new Set(candidates.flatMap((candidate) => getOriginPatterns(candidate)))];
  }, [form.homepage, form.loginUrl, form.searchTemplate, form.apiEnabled, form.apiUrl]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(preset: SitePreset): void {
    setForm(formFromPreset(preset));
    setError('');
    onNotice('info', `已载入模板：${preset.name}`);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError('');

    if (!normalizeKeyword(form.name)) {
      setError('站点名称不能为空');
      return;
    }
    if (!isHttpUrl(form.homepage)) {
      setError('站点主页必须是合法的 http/https 地址');
      return;
    }
    if (!isHttpUrl(form.loginUrl)) {
      setError('登录页地址必须是合法的 http/https 地址');
      return;
    }
    if (!isHttpUrl(form.searchTemplate.replace(/\{q\}|\{query\}|\{keyword\}/gi, 'query'))) {
      setError('搜索地址模板不是合法地址');
      return;
    }
    if (!/\{q\}|\{query\}|\{keyword\}/i.test(form.searchTemplate)) {
      setError('搜索地址模板必须包含 {q} 占位符');
      return;
    }

    let headers: Record<string, string> | undefined;
    if (form.apiEnabled) {
      if (!form.apiUrl.trim() || !form.apiListPath.trim() || !form.apiTitlePath.trim() || !form.apiLinkPath.trim()) {
        setError('接口模式下，接口地址、列表路径、标题路径、链接路径不能为空');
        return;
      }
      if (form.apiHeaders.trim()) {
        try {
          const parsed: unknown = JSON.parse(form.apiHeaders);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('必须是 JSON 对象');
          }
          headers = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
          );
        } catch (parseError) {
          setError(`请求头 JSON 格式错误：${(parseError as Error).message}`);
          return;
        }
      }
    }

    const api: SiteApiConfig | undefined = form.apiEnabled
      ? {
          urlTemplate: form.apiUrl.trim(),
          method: form.apiMethod,
          bodyTemplate: form.apiBody.trim() || undefined,
          headers,
          listPath: form.apiListPath.trim(),
          titlePath: form.apiTitlePath.trim(),
          linkPath: form.apiLinkPath.trim(),
          snippetPath: form.apiSnippetPath.trim() || undefined,
        }
      : undefined;

    const draft: SiteDraft = {
      id: initial?.id,
      name: normalizeKeyword(form.name),
      homepage: form.homepage.trim(),
      iconUrl: form.iconUrl.trim() || undefined,
      enabled: form.enabled,
      group: form.group.trim() || undefined,
      notes: form.notes.trim() || undefined,
      login: {
        loginUrl: form.loginUrl.trim(),
        qrSelector: form.qrSelector.trim() || undefined,
        refreshButtonSelector: form.refreshButtonSelector.trim() || undefined,
        successUrlPattern: form.successUrlPattern.trim() || undefined,
        successCookieName: form.successCookieName.trim() || undefined,
        successSelector: form.successSelector.trim() || undefined,
        sessionCookieNames: form.sessionCookieNames
          .split(/[,，;；\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        sessionTtlMinutes: form.sessionTtlMinutes ? Number(form.sessionTtlMinutes) : undefined,
        autoDetectAuthCookie: form.autoDetectAuthCookie,
      },
      search: {
        urlTemplate: form.searchTemplate.trim(),
        resultSelector: form.resultSelector.trim() || undefined,
        titleSelector: form.titleSelector.trim() || undefined,
        linkSelector: form.linkSelector.trim() || undefined,
        snippetSelector: form.snippetSelector.trim() || undefined,
        api,
        maxResults: form.maxResults ? Number(form.maxResults) : undefined,
        strategy: form.strategy,
        requiresLogin: form.requiresLogin,
        sameSiteOnly: form.sameSiteOnly,
        allowedDomains: form.allowedDomains
          .split(/[,，;；\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      },
    };

    if (origins.length > 0) {
      const granted = await onRequestPermission(origins);
      if (!granted) {
        onNotice('warn', '未授予站点访问权限，保存后将无法登录或搜索');
      }
    }

    try {
      await onSave(draft);
    } catch (saveError) {
      setError((saveError as Error).message);
    }
  }

  return (
    <form className="editor" onSubmit={(event) => void handleSubmit(event)}>
      {mode === 'create' ? (
        <section className="editor-section">
          <h3>从模板开始</h3>
          <div className="preset-grid">
            {SITE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="preset-card"
                onClick={() => applyPreset(preset)}
                title={preset.description}
              >
                <span className="preset-name">{preset.name}</span>
                <span className="preset-desc">{preset.description}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="editor-section">
        <h3>基本信息</h3>
        <Field label="站点名称" required>
          <input
            className="input"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="例如：哔哩哔哩"
          />
        </Field>
        <Field label="站点主页" required hint="用于识别站点、读取 Cookie 与拼接结果链接">
          <input
            className="input"
            value={form.homepage}
            onChange={(event) => update('homepage', event.target.value)}
            placeholder="https://www.example.com"
          />
        </Field>
        <Field label="登录页地址" required hint="扩展会在弹窗中打开此页面并尝试识别二维码">
          <input
            className="input"
            value={form.loginUrl}
            onChange={(event) => update('loginUrl', event.target.value)}
            placeholder="https://www.example.com/login"
          />
        </Field>
        <Field label="站点图标 URL" hint="可选，留空时显示站点名称首字母">
          <input
            className="input"
            value={form.iconUrl}
            onChange={(event) => update('iconUrl', event.target.value)}
            placeholder="https://www.example.com/favicon.ico"
          />
        </Field>
      </section>

      <section className="editor-section">
        <h3>搜索设置</h3>
        <Field label="搜索地址模板" required hint="使用 {q} 作为关键词占位符，例如 https://site.com/search?q={q}">
          <input
            className="input"
            value={form.searchTemplate}
            onChange={(event) => update('searchTemplate', event.target.value)}
            placeholder="https://www.example.com/search?q={q}"
          />
        </Field>
        <div className="field-row">
          <Field label="抓取策略">
            <select
              className="input"
              value={form.strategy}
              onChange={(event) => update('strategy', event.target.value as SearchStrategy)}
            >
              <option value="auto">自动（后台请求失败时用隐藏标签页）</option>
              <option value="fetch">仅后台请求（快，可能缺登录态）</option>
              <option value="tab">仅隐藏标签页（兼容单页应用）</option>
            </select>
          </Field>
          <Field label="每站结果数">
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={form.maxResults}
              onChange={(event) => update('maxResults', event.target.value)}
              placeholder="跟随全局设置"
            />
          </Field>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.requiresLogin}
            onChange={(event) => update('requiresLogin', event.target.checked)}
          />
          <span>未登录时跳过该站点并提示扫码</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.sameSiteOnly}
            onChange={(event) => update('sameSiteOnly', event.target.checked)}
          />
          <span>只保留本站域名的结果（过滤广告、站外链接）</span>
        </label>
        {form.sameSiteOnly ? (
          <Field
            label="额外允许的域名"
            hint="逗号分隔。站点常用的短链或同公司域名，例如 b23.tv、tmall.com"
          >
            <input
              className="input"
              value={form.allowedDomains}
              onChange={(event) => update('allowedDomains', event.target.value)}
              placeholder="b23.tv, tmall.com"
            />
          </Field>
        ) : null}

        <details className="advanced">
          <summary>
            <Icon name="chevron" size={14} />
            自定义结果选择器
          </summary>
          <p className="section-hint">
            留空时使用通用启发式提取：自动收集页面中的标题链接，并过滤导航元素。
          </p>
          <Field label="结果条目容器">
            <input
              className="input"
              value={form.resultSelector}
              onChange={(event) => update('resultSelector', event.target.value)}
              placeholder="例如 .search-result"
            />
          </Field>
          <Field label="标题选择器">
            <input
              className="input"
              value={form.titleSelector}
              onChange={(event) => update('titleSelector', event.target.value)}
              placeholder="例如 .title"
            />
          </Field>
          <Field label="链接选择器">
            <input
              className="input"
              value={form.linkSelector}
              onChange={(event) => update('linkSelector', event.target.value)}
              placeholder="例如 a.title"
            />
          </Field>
          <Field label="摘要选择器">
            <input
              className="input"
              value={form.snippetSelector}
              onChange={(event) => update('snippetSelector', event.target.value)}
              placeholder="例如 .desc"
            />
          </Field>
        </details>

        <details className="advanced">
          <summary>
            <Icon name="chevron" size={14} />
            JSON 接口模式
          </summary>
          <p className="section-hint">
            站点提供公开搜索接口时可开启。开启后优先调用接口，不使用 HTML 提取。
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.apiEnabled}
              onChange={(event) => update('apiEnabled', event.target.checked)}
            />
            <span>启用 JSON 接口抓取</span>
          </label>
          {form.apiEnabled ? (
            <>
              <Field label="接口地址" hint="支持 {q} 占位符">
                <input
                  className="input"
                  value={form.apiUrl}
                  onChange={(event) => update('apiUrl', event.target.value)}
                  placeholder="https://api.example.com/search?q={q}"
                />
              </Field>
              <div className="field-row">
                <Field label="请求方法">
                  <select
                    className="input"
                    value={form.apiMethod}
                    onChange={(event) => update('apiMethod', event.target.value as 'GET' | 'POST')}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </Field>
                <Field label="列表路径" hint="例如 data.list">
                  <input
                    className="input"
                    value={form.apiListPath}
                    onChange={(event) => update('apiListPath', event.target.value)}
                  />
                </Field>
              </div>
              <div className="field-row">
                <Field label="标题路径">
                  <input
                    className="input"
                    value={form.apiTitlePath}
                    onChange={(event) => update('apiTitlePath', event.target.value)}
                    placeholder="title"
                  />
                </Field>
                <Field label="链接路径">
                  <input
                    className="input"
                    value={form.apiLinkPath}
                    onChange={(event) => update('apiLinkPath', event.target.value)}
                    placeholder="url"
                  />
                </Field>
              </div>
              <Field label="摘要路径" hint="可选">
                <input
                  className="input"
                  value={form.apiSnippetPath}
                  onChange={(event) => update('apiSnippetPath', event.target.value)}
                />
              </Field>
              {form.apiMethod === 'POST' ? (
                <Field label="请求体模板" hint="支持 {q} 占位符">
                  <textarea
                    className="textarea"
                    rows={3}
                    value={form.apiBody}
                    onChange={(event) => update('apiBody', event.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="请求头 JSON" hint="可选，值支持 {q} 占位符">
                <textarea
                  className="textarea code"
                  rows={3}
                  value={form.apiHeaders}
                  onChange={(event) => update('apiHeaders', event.target.value)}
                  placeholder={'{\n  "Referer": "https://www.example.com/"\n}'}
                />
              </Field>
            </>
          ) : null}
        </details>
      </section>

      <section className="editor-section">
        <h3>登录检测</h3>
        <Field
          label="关键 Cookie 名称"
          hint="逗号分隔。登录成功后才会出现的 Cookie，例如 SESSDATA、sessionid、z_c0"
        >
          <input
            className="input"
            value={form.sessionCookieNames}
            onChange={(event) => update('sessionCookieNames', event.target.value)}
            placeholder="SESSDATA"
          />
        </Field>
        <div className="field-row">
          <Field label="登录成功 Cookie" hint="可选，扫码成功时出现的新 Cookie">
            <input
              className="input"
              value={form.successCookieName}
              onChange={(event) => update('successCookieName', event.target.value)}
              placeholder="SESSDATA"
            />
          </Field>
          <Field label="兜底有效期（分钟）" hint="留空则仅依赖 Cookie 判断">
            <input
              className="input"
              type="number"
              min={1}
              value={form.sessionTtlMinutes}
              onChange={(event) => update('sessionTtlMinutes', event.target.value)}
              placeholder="例如 10080（7 天）"
            />
          </Field>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.autoDetectAuthCookie}
            onChange={(event) => update('autoDetectAuthCookie', event.target.checked)}
          />
          <span>无关键 Cookie 时，自动识别扫码后新增的认证 Cookie</span>
        </label>

        <details className="advanced">
          <summary>
            <Icon name="chevron" size={14} />
            自定义二维码与成功判定
          </summary>
          <Field label="二维码元素选择器" hint="留空时自动识别页面中的二维码图片/画布">
            <input
              className="input"
              value={form.qrSelector}
              onChange={(event) => update('qrSelector', event.target.value)}
              placeholder="例如 .qrcode img"
            />
          </Field>
          <Field label="二维码刷新按钮选择器" hint="可选，二维码过期后点击的页面按钮">
            <input
              className="input"
              value={form.refreshButtonSelector}
              onChange={(event) => update('refreshButtonSelector', event.target.value)}
            />
          </Field>
          <Field label="登录成功 URL 正则" hint="可选，例如 ^https://www\\.example\\.com/$">
            <input
              className="input"
              value={form.successUrlPattern}
              onChange={(event) => update('successUrlPattern', event.target.value)}
            />
          </Field>
          <Field label="登录成功页面选择器" hint="可选，登录后才会出现的元素">
            <input
              className="input"
              value={form.successSelector}
              onChange={(event) => update('successSelector', event.target.value)}
              placeholder="例如 .user-avatar"
            />
          </Field>
        </details>
      </section>

      <section className="editor-section">
        <h3>其他</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => update('enabled', event.target.checked)}
          />
          <span>启用该站点</span>
        </label>
        <Field label="搜索分组" hint="同一分组的站点可在搜索页一键选中，留空则归入“未分组”">
          <input
            className="input"
            value={form.group}
            onChange={(event) => update('group', event.target.value)}
            placeholder="例如 视频、社区、资讯"
          />
        </Field>
        <Field label="备注">
          <textarea
            className="textarea"
            rows={2}
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
          />
        </Field>
        <div className="permission-hint">
          <Icon name="shield" size={14} />
          <span>
            保存时会申请以下访问权限：{origins.length > 0 ? origins.join('、') : '无'}
          </span>
        </div>
      </section>

      {error ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size={15} />
          {error}
        </div>
      ) : null}

      <div className="editor-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
          取消
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <Spinner size={15} /> : <Icon name="check" size={15} />}
          {mode === 'create' ? '添加站点' : '保存修改'}
        </button>
      </div>
    </form>
  );
}
