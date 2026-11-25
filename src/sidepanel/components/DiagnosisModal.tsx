/**
 * 登录态诊断弹窗：展示权限、读取到的 Cookie 名称与自动识别结果。
 */
import type { SessionStatus, SiteSessionDiagnosis } from '../../shared/types';
import { Icon, Spinner, StatusDot } from './Ui';

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: '已登录',
  expired: '登录已过期',
  unknown: '未登录',
  error: '检测失败',
  checking: '检测中',
};

const STATUS_TONE: Record<SessionStatus, 'ok' | 'danger' | 'warn' | 'muted'> = {
  active: 'ok',
  expired: 'danger',
  unknown: 'muted',
  error: 'warn',
  checking: 'muted',
};

interface DiagnosisModalProps {
  diagnosis: SiteSessionDiagnosis | null;
  loading: boolean;
  fixing: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onFix: (cookieNames: string[]) => void;
}

export function DiagnosisModal({
  diagnosis,
  loading,
  fixing,
  onClose,
  onRefresh,
  onFix,
}: DiagnosisModalProps) {
  const canFix =
    diagnosis !== null &&
    diagnosis.detectedCookies.length > 0 &&
    diagnosis.detectedCookies.some(
      (name) =>
        !diagnosis.configuredCookies.some((configured) => configured.toLowerCase() === name.toLowerCase()),
    );

  return (
    <div className="diagnosis">
      {loading && !diagnosis ? (
        <div className="diagnosis-loading">
          <Spinner size={18} />
          <span>正在读取站点 Cookie…</span>
        </div>
      ) : null}

      {diagnosis ? (
        <>
          <div className="diagnosis-summary">
            <span className={`session-pill tone-${STATUS_TONE[diagnosis.status]}`}>
              <StatusDot tone={STATUS_TONE[diagnosis.status]} />
              {STATUS_LABEL[diagnosis.status]}
            </span>
            <span className="diagnosis-message">{diagnosis.message ?? '—'}</span>
          </div>

          {!diagnosis.granted ? (
            <div className="site-warning">
              <Icon name="shield" size={14} />
              <span>尚未授权访问该站点，Cookie 读取会被浏览器拒绝。请关闭本弹窗，在站点卡片上点击“授权访问”。</span>
            </div>
          ) : null}

          <dl className="diagnosis-grid">
            <dt>站点主页</dt>
            <dd>{diagnosis.homepage}</dd>
            <dt>登录页</dt>
            <dd>{diagnosis.loginUrl}</dd>
            <dt>关键 Cookie</dt>
            <dd>{diagnosis.configuredCookies.join('、') || '未配置'}</dd>
            <dt>已匹配</dt>
            <dd>{diagnosis.matchedCookies.join('、') || '无'}</dd>
            <dt>自动识别</dt>
            <dd>{diagnosis.detectedCookies.join('、') || '无'}</dd>
            <dt>读取名称数</dt>
            <dd>{diagnosis.cookieNames.length} 个</dd>
          </dl>

          {diagnosis.errors.length > 0 ? (
            <div className="form-error" role="alert">
              <Icon name="alert" size={15} />
              <span>{diagnosis.errors.join('；')}</span>
            </div>
          ) : null}

          {canFix ? (
            <div className="diagnosis-fix">
              <Icon name="key" size={14} />
              <span>
                检测到可用的登录 Cookie：{diagnosis.detectedCookies.join('、')}。可将它设为该站点的关键 Cookie，
                之后即可正确检测登录过期。
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={fixing}
                onClick={() => onFix(diagnosis.detectedCookies)}
              >
                {fixing ? <Spinner size={14} /> : <Icon name="check" size={14} />}
                使用自动识别的 Cookie 修复
              </button>
            </div>
          ) : null}

          <details className="diagnosis-cookie-list">
            <summary>
              <Icon name="chevron" size={14} />
              查看读取到的 Cookie 名称（不包含 Cookie 值）
            </summary>
            {diagnosis.cookieNames.length === 0 ? (
              <p className="section-hint">
                没有读取到任何 Cookie。请确认已授权站点、浏览器未开启阻止第三方 Cookie，并已在浏览器中登录该站点。
              </p>
            ) : (
              <div className="cookie-tags">
                {diagnosis.cookieNames.map((name) => (
                  <span
                    key={name}
                    className={`cookie-tag ${
                      diagnosis.detectedCookies.some((item) => item.toLowerCase() === name.toLowerCase())
                        ? 'is-auth'
                        : ''
                    }`}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </details>

          <p className="diagnosis-note">
            诊断只读取当前站点可见的 Cookie 名称，不会读取或上传 Cookie 的值。
            若列表中能看到 SESSDATA 但仍显示未登录，可点击“重新检测”。
          </p>
        </>
      ) : null}

      <div className="diagnosis-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          关闭
        </button>
        <button type="button" className="btn btn-soft" onClick={onRefresh} disabled={loading || fixing}>
          {loading ? <Spinner size={14} /> : <Icon name="refresh" size={14} />}
          重新检测
        </button>
      </div>
    </div>
  );
}
