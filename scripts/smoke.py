#!/usr/bin/env python3
"""豆豆书签（GlassDesk）部署后烟雾测试。

用法：python3 scripts/smoke.py
每次 wrangler deploy 之后跑一遍：7 个关键接口逐个验，任一红灯退出码非 0。
凭据只从本地托管文件读（站点密码 / 同步令牌），不打印、不落盘（curl 配置用完即删）。
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import time

BASE = "https://nav.aioosi.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/138.0 Safari/537.36")
HOME = os.path.expanduser("~")


def mint_gate_cfg() -> str:
    pw = open(os.path.join(HOME, "workspace/starrealm/.site_password")).read().strip()
    exp = str(int(time.time()) + 3600)
    sig = hmac.new(pw.encode(), ("gate." + exp).encode(), hashlib.sha256).digest()
    token = f"{exp}." + base64.urlsafe_b64encode(sig).decode().rstrip("=")
    fd, path = tempfile.mkstemp(prefix="smoke-gate-")
    with os.fdopen(fd, "w") as f:
        f.write(f'header = "Cookie: nav_gate_session={token}"\n')
        f.write(f'user-agent = "{UA}"\n')
    os.chmod(path, 0o600)
    return path


def mint_sync_cfg() -> str:
    tok = open(os.path.join(HOME, "workspace/glassdesk/.sync_token")).read().strip()
    fd, path = tempfile.mkstemp(prefix="smoke-sync-")
    with os.fdopen(fd, "w") as f:
        f.write(f'header = "Authorization: Bearer {tok}"\n')
    os.chmod(path, 0o600)
    return path


def curl(cfg: str, method: str, path: str, body: str | None = None):
    cmd = ["curl", "-s", "-K", cfg, "-X", method, "-w", "\n%{http_code}", BASE + path]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", body]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout
    text, _, code = out.rpartition("\n")
    try:
        data = json.loads(text, strict=False)
    except Exception:
        data = None
    return int(code), data


def main() -> int:
    gate = mint_gate_cfg()
    sync = mint_sync_cfg()
    results = []
    try:
        code, d = curl(gate, "GET", "/api/version")
        ok = code == 200 and isinstance(d, dict) and isinstance(d.get("storage"), int)
        results.append(("版本接口 /api/version", ok, f"HTTP {code}"))
        storage_v = d.get("storage") if ok else None

        code, d = curl(gate, "GET", "/api/tree")
        folders = 0
        if isinstance(d, dict):
            def count_folders(node):
                # tree 是列表，根节点 children 里 id 以 cat: 开头的即分类文件夹
                n = 0
                if isinstance(node, dict):
                    if str(node.get("id", "")).startswith("cat:"):
                        n += 1
                    for ch in node.get("children") or []:
                        n += count_folders(ch)
                elif isinstance(node, list):
                    for ch in node:
                        n += count_folders(ch)
                return n
            folders = count_folders(d.get("tree"))
        results.append(("书签树 /api/tree", code == 200 and folders >= 10, f"HTTP {code}，分类 {folders}"))

        code, d = curl(gate, "GET", "/api/subs")
        ok = code == 200 and isinstance(d, dict) and isinstance(d.get("subscriptions"), list)
        results.append(("订阅接口 /api/subs", ok, f"HTTP {code}"))

        code, d = curl(gate, "GET", "/api/healthcheck")
        ok = code == 200 and isinstance(d, dict) and isinstance(d.get("results"), list)
        results.append(("体检接口 /api/healthcheck", ok, f"HTTP {code}"))

        code, d = curl(sync, "GET", "/api/ingest/ping")
        ok = code == 200 and isinstance(d, dict) and d.get("ok") is True
        results.append(("插件通道 /api/ingest/ping", ok, f"HTTP {code}"))

        code, d = curl(gate, "GET", "/api/no-such-route-smoke")
        ok = code == 404 and isinstance(d, dict) and d.get("error") == "not found"
        results.append(("未知接口应 404", ok, f"HTTP {code}"))

        code, d = curl(gate, "PUT", "/api/storage", '{"baseVersion":0,"data":{"settings":{}}}')
        ok = code == 400 and isinstance(d, dict) and d.get("error") == "incomplete_storage"
        code2, d2 = curl(gate, "GET", "/api/version")
        unchanged = isinstance(d2, dict) and d2.get("storage") == storage_v
        results.append(("存储防护（残缺写入被拒且版本不动）", ok and unchanged, f"HTTP {code}，版本不变={unchanged}"))
    finally:
        for p in (gate, sync):
            try:
                os.unlink(p)
            except OSError:
                pass

    failed = 0
    for name, ok, detail in results:
        print(f"{'✅' if ok else '❌'} {name}（{detail}）")
        failed += 0 if ok else 1
    print(f"\n烟雾测试：{len(results) - failed}/{len(results)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
