// 图床（cfimg）前端服务：经本站 Worker 代理调用，Token 只在服务端。
export type ImgbedUploadResult =
  | { ok: true; url: string; name: string }
  | { ok: false; reason: 'unconfigured' | 'error' };

export async function uploadToImgbed(file: File): Promise<ImgbedUploadResult> {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/imgbed/upload', { method: 'POST', body: form });
    const body = (await res.json()) as { configured: boolean; url?: string; name?: string };
    if (!body.configured) return { ok: false, reason: 'unconfigured' };
    if (!res.ok || !body.url) return { ok: false, reason: 'error' };
    return { ok: true, url: body.url, name: body.name ?? file.name };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export function checkImgbedFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return '只能上传图片文件';
  if (file.size > 25 * 1024 * 1024) return '图片超过 25MB，先压缩一下再传';
  return null;
}
