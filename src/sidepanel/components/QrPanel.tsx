/**
 * 登录二维码展示卡片。
 */
import { useEffect, useMemo, useState } from 'react';
import type { LoginFlowState, SiteConfig } from '../../shared/types';
import { formatRelative, qrScreenshotStyle } from '../utils';
import { Icon, Spinner } from './Ui';

interface QrPanelProps {
  flow: LoginFlowState;
  site: SiteConfig;
  busy?: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onFocus: () => void;
}

export function QrPanel({ flow, site, busy, onRefresh, onCancel, onFocus }: QrPanelProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [, setTick] = useState(0);

  const capturedAt = flow.qr?.capturedAt;
  useEffect(() => {
    setImageFailed(false);
  }, [capturedAt]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  const screenshotStyle = useMemo(() => qrScreenshotStyle(flow, 168), [flow]);
  const imageSrc = flow.qr?.imageSrc;

  const waitingSeconds = Math.max(0, Math.floor((Date.now() - flow.startedAt) / 1_000));

  return (
    <div className="qr-panel">
      <div className="qr-frame">
        {imageSrc && !imageFailed ? (
          <img
            src={imageSrc}
            alt={`${site.name} 登录二维码`}
            className="qr-image"
            onError={() => setImageFailed(true)}
          />
        ) : screenshotStyle ? (
          <div className="qr-screenshot" style={screenshotStyle} role="img" aria-label={`${site.name} 登录二维码`} />
        ) : (
          <div className="qr-placeholder">
            <Icon name="qr" size={28} />
            <span>{flow.status === 'qr-missing' ? '未识别到二维码' : '正在获取二维码…'}</span>
          </div>
        )}
        {flow.status === 'waiting' && flow.qr ? <span className="qr-scanline" aria-hidden="true" /> : null}
      </div>

      <div className="qr-info">
        <div className="qr-heading">
          <Icon name="qr" size={15} />
          <span>{flow.siteName} 扫码登录</span>
        </div>
        <p className={`qr-message ${flow.status === 'qr-missing' ? 'is-warn' : ''}`}>
          {flow.message ?? '等待扫码确认'}
        </p>
        <p className="qr-meta">
          已等待 {waitingSeconds < 60 ? `${waitingSeconds} 秒` : `${Math.floor(waitingSeconds / 60)} 分 ${waitingSeconds % 60} 秒`}
          {capturedAt ? ` · 二维码更新于 ${formatRelative(capturedAt)}` : ''}
        </p>
        <div className="qr-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={busy}>
            {busy ? <Spinner size={14} /> : <Icon name="refresh" size={14} />}
            刷新二维码
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onFocus}>
            <Icon name="external" size={14} />
            打开登录窗口
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            <Icon name="close" size={14} />
            取消
          </button>
        </div>
        <p className="qr-note">
          扫码在弹窗中完成，登录信息由浏览器 Cookie 自动保存；关闭面板不影响登录。
        </p>
      </div>
    </div>
  );
}
