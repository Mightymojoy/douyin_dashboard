# -*- coding: utf-8 -*-
"""
通用看板更新时间轴注入工具
用法:
    python update_timeline.py <html路径> [--status success|fail] [--note "备注"]
    --status  本次更新结果（默认 success）
    --note    附加说明（可选）

功能:
    1. 在 HTML <body> 顶部注入更新时间轴状态条（金色系，匹配 ITO 风格）
    2. 维护历史记录（最近 14 条），存储于 HTML 内嵌 JSON + 本地 update_history.json
    3. 显示"上次更新时间 + 状态 + 最近记录"
"""
import argparse
import json
import os
import re
import sys
import datetime

GOLD = "#c9a962"
GOLD_DEEP = "#a8873f"
INK = "#1d1b16"
BG = "#fbf9f4"

TIMELINE_CSS = """
/* ===== 更新时间轴 ===== */
.update-tl{max-width:1280px;margin:0 auto;padding:8px 32px 0;font-family:'Inter','PingFang SC','Microsoft YaHei',sans-serif}
.update-tl .utl-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  background:var(--card,#fff);border:1px solid rgba(201,169,98,.25);border-radius:10px;
  padding:8px 14px;font-size:12px;color:var(--ink-2,#5b554a)}
.update-tl .utl-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.update-tl .utl-dot.ok{background:#2e7d32}
.update-tl .utl-dot.fail{background:#b3261e}
.update-tl .utl-tag{font-weight:700;font-size:12px}
.update-tl .utl-tag.ok{color:#2e7d32}
.update-tl .utl-tag.fail{color:#b3261e}
.update-tl .utl-sep{opacity:.35;margin:0 2px}
.update-tl .utl-time{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink,#1d1b16)}
.update-tl .utl-note{opacity:.75}
.update-tl .utl-toggle{margin-left:auto;cursor:pointer;color:var(--gold,#c9a962);
  font-weight:600;font-size:12px;background:none;border:none;padding:2px 4px}
.update-tl .utl-toggle:hover{text-decoration:underline}
.update-tl .utl-history{display:none;margin-top:8px;background:var(--card,#fff);
  border:1px solid rgba(201,169,98,.18);border-radius:10px;padding:10px 14px}
.update-tl .utl-history.show{display:block}
.update-tl .utl-hd{font-size:12px;font-weight:700;color:var(--ink,#1d1b16);margin-bottom:8px}
.update-tl .utl-row{display:flex;align-items:center;gap:8px;padding:5px 0;
  border-bottom:1px dashed rgba(201,169,98,.15);font-size:12px;color:var(--ink-2,#5b554a)}
.update-tl .utl-row:last-child{border-bottom:none}
.update-tl .utl-row .utl-dot{width:6px;height:6px}
.update-tl .utl-row .utl-d{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink,#1d1b16);min-width:96px}
.update-tl .utl-row .utl-s.ok{color:#2e7d32;font-weight:600}
.update-tl .utl-row .utl-s.fail{color:#b3261e;font-weight:600}
.update-tl .utl-row .utl-n{opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ===== END 更新时间轴 ===== */
"""


def load_history(html_path):
    """从本地 JSON 读取历史记录"""
    hist_path = os.path.join(os.path.dirname(html_path), "update_history.json")
    if os.path.exists(hist_path):
        try:
            with open(hist_path, "r", encoding="utf-8") as f:
                return json.load(f), hist_path
        except Exception:
            pass
    return [], hist_path


def save_history(hist, hist_path, max_records=14):
    try:
        with open(hist_path, "w", encoding="utf-8") as f:
            json.dump(hist[-max_records:], f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[warn] 历史记录写入失败: {e}", file=sys.stderr)


def build_timeline_html(hist):
    """生成更新时间轴 HTML 片段"""
    now = datetime.datetime.now()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")
    date_str = now.strftime("%m-%d %H:%M")

    if not hist:
        last_time, last_status = "—", "ok"
    else:
        last_time = hist[-1].get("time", "")[-5:]
        last_status = hist[-1].get("status", "ok")

    status_text = "更新成功" if last_status == "ok" else "更新失败"
    cls = "ok" if last_status == "ok" else "fail"

    rows = []
    for r in reversed(hist[-7:]):
        st = r.get("status", "ok")
        scls = "ok" if st == "ok" else "fail"
        stext = "✓" if st == "ok" else "✗"
        note = r.get("note", "")
        note_html = f"<span class='utl-n'>{note}</span>" if note else ""
        rows.append(
            f"<div class='utl-row'><span class='utl-dot {scls}'></span>"
            f"<span class='utl-d'>{r.get('time','')}</span>"
            f"<span class='utl-s {scls}'>{stext}</span>{note_html}</div>"
        )
    rows_html = "\n".join(rows) if rows else "<div class='utl-row'>暂无历史记录</div>"

    return f"""
<!-- ===== 更新时间轴 START ===== -->
<div class="update-tl">
  <div class="utl-bar">
    <span class="utl-dot {cls}"></span>
    <span class="utl-tag {cls}">{status_text}</span>
    <span class="utl-sep">·</span>
    <span class="utl-time">{date_str}</span>
    <span class="utl-sep">·</span>
    <span class="utl-note">数据更新时间轴</span>
    <button class="utl-toggle" onclick="document.querySelector('.utl-history').classList.toggle('show')">历史记录 ▾</button>
  </div>
  <div class="utl-history">
    <div class="utl-hd">最近更新记录</div>
    {rows_html}
  </div>
</div>
<!-- ===== 更新时间轴 END ===== -->"""


def inject_timeline(html, hist):
    """注入 CSS + HTML 到页面"""
    # 注入 CSS（放在 </style> 前）
    css_block = TIMELINE_CSS.strip()
    if "/* ===== 更新时间轴 ===== */" in html:
        html = re.sub(r"/\* ===== 更新时间轴 ===== \*/.*?/\* ===== END 更新时间轴 ===== \*/",
                      css_block, html, flags=re.S)
    elif "</style>" in html:
        html = html.replace("</style>", css_block + "\n</style>", 1)

    # 注入/替换 HTML 组件（在 <body> 之后或 .wrap/header 之前）
    tl_html = build_timeline_html(hist)
    if "<!-- ===== 更新时间轴 START ===== -->" in html:
        html = re.sub(r"<!-- ===== 更新时间轴 START ===== -->.*?<!-- ===== 更新时间轴 END ===== -->",
                      tl_html, html, flags=re.S)
    else:
        # 优先在 <body> 后插入（如果存在 .wrap 则在其前）
        m = re.search(r"<body[^>]*>", html)
        if m:
            pos = m.end()
            html = html[:pos] + "\n" + tl_html + html[pos:]
        else:
            html = tl_html + html
    return html


def main():
    ap = argparse.ArgumentParser(description="看板更新时间轴注入工具")
    ap.add_argument("html", help="HTML 文件路径")
    ap.add_argument("--status", default="ok", choices=["ok", "fail"], help="本次更新状态")
    ap.add_argument("--note", default="", help="附加说明")
    args = ap.parse_args()

    html_path = args.html
    if not os.path.exists(html_path):
        print(f"[error] 文件不存在: {html_path}", file=sys.stderr)
        sys.exit(1)

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    hist, hist_path = load_history(html_path)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # 同日同状态去重：不重复记录（保留当日最新一条）
    record = {"time": now, "status": args.status, "note": args.note}
    if hist and hist[-1]["time"][:10] == now[:10] and hist[-1]["status"] == args.status:
        hist[-1] = record
    else:
        hist.append(record)

    save_history(hist, hist_path)
    html = inject_timeline(html, hist)

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"[ok] 更新时间轴已注入: {html_path}")
    print(f"[ok] 当前状态: {args.status}, 历史 {len(hist)} 条")


if __name__ == "__main__":
    main()
