// 豆豆书签（fork）：Worker 在页面里注入 __DOUDOU_SERVER__ 标记，
// 表示当前跑在 Cloudflare 托管形态（书签与布局都走云端 API），而非扩展/演示形态。
export function isServerMode(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as unknown as { __DOUDOU_SERVER__?: boolean }).__DOUDOU_SERVER__ === true
  );
}
