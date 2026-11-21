import { useRef, useState } from 'react';
import { CloudArrowUp, Image as ImageIcon } from '@phosphor-icons/react';
import type { WidgetInstance } from '../../../types/widget';
import { WidgetFrame } from '../common/WidgetFrame';
import { isServerMode } from '../../../services/server-mode';
import { checkImgbedFile, uploadToImgbed } from '../../../services/imgbed';
import { setDesktopWallpaper } from '../../../stores/desktop-store';
import { pushToast } from '../../../stores/ui-store';

interface ImgbedWidgetProps {
  widget: WidgetInstance;
  compact: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

type Phase = 'idle' | 'uploading' | 'done' | 'error' | 'unconfigured';

export function ImgbedWidget({ widget, compact, canvasWidth, canvasHeight }: ImgbedWidgetProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const serverMode = isServerMode();

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    const problem = checkImgbedFile(file);
    if (problem) {
      pushToast(problem, 'error');
      return;
    }
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setPhase('uploading');
    const result = await uploadToImgbed(file);
    if (result.ok) {
      setResultUrl(result.url);
      setPhase('done');
    } else {
      setPhase(result.reason === 'unconfigured' ? 'unconfigured' : 'error');
    }
  }

  function reset() {
    setPhase('idle');
    setResultUrl('');
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return '';
    });
  }

  return (
    <WidgetFrame
      widget={widget}
      title="图床上传"
      icon={<CloudArrowUp size={13} />}
      compact={compact}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
    >
      {!serverMode ? (
        <p style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.6, padding: '6px 2px' }}>
          图床上传只在云端版（desk.aioosi.com）可用。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
          <div
            role="button"
            tabIndex={0}
            aria-label="上传图片到图床"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void handleFile(event.dataTransfer.files?.[0]);
            }}
            style={{
              flex: 1,
              minHeight: 96,
              border: `1.5px dashed ${dragging ? 'rgb(90 120 220 / 75%)' : 'rgb(127 140 180 / 40%)'}`,
              borderRadius: 12,
              background: dragging ? 'rgb(90 120 220 / 10%)' : 'rgb(127 140 180 / 6%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              cursor: 'pointer',
              outline: 'none',
              overflow: 'hidden',
              padding: preview ? 0 : 10,
              textAlign: 'center',
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {preview ? (
              <img
                src={preview}
                alt=""
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <>
                <ImageIcon size={22} style={{ opacity: 0.55 }} />
                <span style={{ fontSize: 12.5 }}>拖图到这里，或点击选择</span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>上传到图床 cfimg · 单张 ≤ 25MB</span>
              </>
            )}
          </div>
          {phase === 'uploading' ? (
            <p style={{ fontSize: 12, opacity: 0.75 }}>上传中…</p>
          ) : null}
          {phase === 'error' ? (
            <p style={{ fontSize: 12, opacity: 0.75 }}>上传失败，稍后重试或换一张图。</p>
          ) : null}
          {phase === 'unconfigured' ? (
            <p style={{ fontSize: 12, opacity: 0.75 }}>图床还没配置好（缺 API Token）。</p>
          ) : null}
          {phase === 'done' && resultUrl ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setDesktopWallpaper(widget.desktopId, `url:${resultUrl}`);
                  pushToast('已设为这个桌面的壁纸', 'success');
                }}
              >
                设为壁纸
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(resultUrl)
                    .then(() => pushToast('链接已复制', 'success'))
                    .catch(() => undefined);
                }}
              >
                复制链接
              </button>
              <button type="button" className="chip" onClick={reset}>
                再传一张
              </button>
            </div>
          ) : null}
        </div>
      )}
    </WidgetFrame>
  );
}
