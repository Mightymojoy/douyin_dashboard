# -*- coding: utf-8 -*-
"""
飞书「抖音自营店铺数据源-新」→ dashboard_data.json 同步脚本

用法:
    python tools/feishu_sync_douyin.py --inspect
        探明子表 / 行列数 / 表头 / 样例值，与本地 Excel 表头指纹比对，不写任何文件
    python tools/feishu_sync_douyin.py --sync
        全量拉取 → 结构哨兵校验 → 写同构临时 xlsx → 调用 生成看板数据.py → 写 sync_meta.json

环境变量（GitHub Actions 里配成 Secrets）:
    FEISHU_APP_ID       自建应用 App ID
    FEISHU_APP_SECRET   自建应用 App Secret
    FEISHU_WIKI_TOKEN   wiki 节点 token（默认已内置店铺数据源节点）

依赖: 标准库 + openpyxl（写临时 xlsx）；生成看板数据.py 需要 pandas/openpyxl。

设计取舍（重要）:
    不在这里重写任何口径。飞书只当作「数据搬运层」：把 3 个子表原样还原成与
    本地 Excel 同构的表格，交给 生成看板数据.py 跑既有转换逻辑。这样云端同步
    与本地手刷的口径天然一致，不会出现两套算法各算一个数。

    源表 80 列中「商品曝光点击率 / 商品点击人数 / 成交人数」等表头重复出现，
    因此一律按列位（0-79）取值，并用 EXPECTED_HEADER 做整行指纹校验；
    结构一旦变动立即失败，绝不静默错位。
"""
import argparse
import json
import os
import subprocess
import sys
import datetime
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://open.feishu.cn/open-apis"
DEFAULT_WIKI_TOKEN = "Uwq1w8rUEiloALkv0uBcXLxGn3f"
# 文档号不是密钥，只是定位符。应用没有 wiki:wiki 权限时用它直连，
# 免得为了「找文档」这一个动作额外申请一个 scope。
DEFAULT_SPREADSHEET_TOKEN = "SOxdsxkiZhxYh2tq2uIc8wkDnvc"
DEFAULT_DOC_TITLE = "抖音自营店铺数据源-新"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
META_PATH = os.path.join(ROOT, "sync_meta.json")
TMP_XLSX = os.path.join(ROOT, "_feishu_pull.xlsx")
GEN_SCRIPT = os.path.join(ROOT, "生成看板数据.py")

SHOP_KEYS = ["摩登新贵女", "轻熟质享客", "云端商务家"]
NCOLS = 80
MAX_ROWS = 600

# 结构哨兵：本地 Excel「摩登新贵女」第 3 行实测表头（80 列，已去除换行与空格）。
# 飞书源表与之不一致时立刻失败，避免列位错移后算出全错的数。
EXPECTED_HEADER = [
    "日期", "自营GMV", "自营GSV（ttl浮动）", "退款后电商平台补贴金额(浮动)",
    "退款后千川智能优惠券金额(浮动)", "用户支付GSV（退款时间）", "自营退款（退款时间）",
    "自营退款率（退款时间）", "自营GSV目标", "自营GSV达成率", "25年同期自营GSV", "26vs25同比",
    "直播GSV", "商城GSV", "商城退前占比", "商城退后占比", "自营退款（支付时间）",
    "直播间退款（店铺日维度）", "商城退款", "自营退款率", "直播间退款率", "商城退款率",
    "店铺费比（除退款后）", "客单价", "直播间成交金额（店铺日维度）", "商品卡成交", "其他",
    "短视频及图文", "成交人数", "商品点击人数", "商品曝光人数", "商品曝光点击率",
    "商品点击-支付转化率", "商品曝光转化率", "直播场次", "直播时长（M）", "直播时长（h）",
    "直播间成交金额（场次日维度）", "直播间退款金额（场次日维度）", "直播GSV（场次日维度）",
    "时均GSV（场次日维度）", "直播间退款率（场次日维度）", "GPM(每千次观看成交金额)",
    "曝光-观看率", "观看-商品曝光率", "商品曝光点击率", "商品点击-成交率", "直播曝光-成交率",
    "观看-成交率", "曝光互动率", "观看互动率", "转粉率", "时均UV", "直播客单价", "直播曝光人数",
    "场观人数（UV）", "商品曝光人数", "商品点击人数", "成交人数", "直播互动人数", "新增粉丝数",
    "人均观看时长（s）", "总花费", "推广gmv", "推广ROI", "直播花费", "直播推广GMV", "直播推广ROI",
    "直投花费", "直投GMV", "直投ROI", "素材花费", "素材GMV", "素材ROI", "商城花费",
    "商城推广gmv", "商城推广ROI", "短视频引流成交占比", "千川非赠款花费", "非赠款实际费比",
]


def norm(s):
    """归一化表头：去换行、去所有空白（含全角空格）、统一括号。"""
    if s is None:
        return ""
    t = str(s)
    for ch in ("\n", "\r", "\t", " ", "\u3000", "\xa0"):
        t = t.replace(ch, "")
    return t.replace("（", "(").replace("）", ")")


def col_letter(idx):
    """0 → A, 79 → CB"""
    s = ""
    idx += 1
    while idx:
        idx, r = divmod(idx - 1, 26)
        s = chr(65 + r) + s
    return s


def _request(url, token=None, payload=None, method=None):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        method = method or "POST"
    req = urllib.request.Request(url, data=data, method=method or "GET")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            raise RuntimeError("HTTP %s for %s" % (e.code, url))


def get_token(app_id, app_secret):
    r = _request(BASE + "/auth/v3/tenant_access_token/internal",
                 payload={"app_id": app_id, "app_secret": app_secret})
    if r.get("code") != 0:
        raise SystemExit("[FATAL] 取 tenant_access_token 失败: %s %s" % (r.get("code"), r.get("msg")))
    return r["tenant_access_token"]


def resolve_sheet_token(token, wiki_token, fallback_st=None):
    """wiki 节点 → 电子表格 spreadsheetToken

    有 wiki:wiki 权限时走这里，能自动跟随文档改名/移动；
    没有时（实测 cli_aa7104b0b93a9bb3 就是这种情况）回落到内置文档号，
    只缺一个非必要的 scope，不该让整条同步失败。
    """
    url = BASE + "/wiki/v2/spaces/get_node?" + urllib.parse.urlencode(
        {"token": wiki_token, "obj_type": "wiki"})
    r = _request(url, token)
    if r.get("code") != 0:
        if fallback_st:
            print("[WARN] wiki 节点解析失败(%s %s)，改用内置文档号 %s"
                  % (r.get("code"), str(r.get("msg"))[:60], fallback_st))
            return fallback_st, DEFAULT_DOC_TITLE, {}
        raise SystemExit("[FATAL] 读 wiki 节点失败: %s %s" % (r.get("code"), r.get("msg")))
    node = r["data"]["node"]
    if node.get("obj_type") != "sheet":
        raise SystemExit("[FATAL] 该 wiki 节点不是电子表格，实际类型: %s" % node.get("obj_type"))
    return node["obj_token"], node.get("title", ""), node


def list_sheets(token, st):
    url = BASE + "/sheets/v3/spreadsheets/%s/sheets/query" % st
    r = _request(url, token)
    if r.get("code") != 0:
        raise SystemExit(
            "[FATAL] 读子表列表失败: %s %s\n"
            "  常见原因：应用缺少 sheets:spreadsheet:readonly 权限，或未被加为该文档协作者。\n"
            "  权限申请：https://open.feishu.cn/app/%s/auth?q=sheets:spreadsheet:readonly"
            % (r.get("code"), r.get("msg"), os.environ.get("FEISHU_APP_ID", "<APP_ID>")))
    out = []
    for s in r.get("data", {}).get("sheets", []):
        g = s.get("grid_properties", {}) or {}
        out.append({
            "title": s.get("title"),
            "sheet_id": s.get("sheet_id"),
            "rows": g.get("row_count"),
            "cols": g.get("column_count"),
        })
    return out


def read_values(token, st, sheet_id, nrows):
    rng = "%s!A1:%s%d" % (sheet_id, col_letter(NCOLS - 1), nrows)
    url = BASE + "/sheets/v2/spreadsheets/%s/values/%s?valueRenderOption=UnformattedValue" % (
        st, urllib.parse.quote(rng, safe="!"))
    r = _request(url, token)
    if r.get("code") != 0:
        raise SystemExit("[FATAL] 读区域 %s 失败: %s %s" % (rng, r.get("code"), r.get("msg")))
    vals = ((r.get("data") or {}).get("valueRange") or {}).get("values") or []
    return vals


def excel_serial_to_date(v):
    """飞书 UnformattedValue 对日期列可能返回 Excel 序列号，需还原。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    if 20000 < f < 80000:
        base = datetime.datetime(1899, 12, 30)
        return (base + datetime.timedelta(days=f)).date()
    return v


def check_header(rows, shop):
    """在 rows 里定位表头行（前 5 行内找到与 EXPECTED_HEADER 相似度最高的那行）"""
    want = [norm(x) for x in EXPECTED_HEADER]
    best, best_i, best_hit = None, None, -1
    for i, row in enumerate(rows[:5]):
        got = [norm(c) for c in (list(row) + [""] * NCOLS)[:NCOLS]]
        hit = sum(1 for a, b in zip(want, got) if a and a == b)
        if hit > best_hit:
            best, best_i, best_hit = got, i, hit
    if best is None:
        raise SystemExit("[FATAL] %s: 前 5 行里找不到任何表头" % shop)
    if best_hit < NCOLS:
        diff = []
        for j, (a, b) in enumerate(zip(want, best)):
            if a != b:
                diff.append("  列%s(#%d): 期望 %r / 实际 %r" % (col_letter(j), j, a, b))
        raise SystemExit(
            "[FATAL] %s: 表头与本地口径不一致（命中 %d/%d），列位不可用：\n%s\n"
            "  → 源表结构已变动，需先更新脚本里的 EXPECTED_HEADER 与列位映射，禁止强行同步。"
            % (shop, best_hit, NCOLS, "\n".join(diff[:12])))
    return best_i


def do_inspect(args):
    token = get_token(args.app_id, args.app_secret)
    st, title, node = resolve_sheet_token(token, args.wiki_token, args.spreadsheet_token)
    print("文档标题:", title)
    print("spreadsheetToken:", st)
    print("wiki 节点:", args.wiki_token, "| space_id:", node.get("space_id"))
    sheets = list_sheets(token, st)
    print("\n子表清单（%d 个）:" % len(sheets))
    for s in sheets:
        print("  - %-16s id=%-8s %sx%s" % (s["title"], s["sheet_id"], s["rows"], s["cols"]))

    by_title = {s["title"]: s for s in sheets}
    for shop in SHOP_KEYS:
        s = by_title.get(shop)
        if not s:
            print("\n[!] 缺少子表: %s" % shop)
            continue
        rows = read_values(token, st, s["sheet_id"], min(s["rows"] or 400, MAX_ROWS))
        print("\n=== %s  (%d 行返回) ===" % (shop, len(rows)))
        for i, row in enumerate(rows[:4]):
            shown = ["" if c is None else str(c)[:18] for c in (list(row) + [""] * 6)[:6]]
            print("  r%d: %s" % (i + 1, " | ".join(shown)))
        hi = None
        try:
            hi = check_header(rows, shop)
            print("  ✓ 表头指纹校验通过，表头位于第 %d 行" % (hi + 1))
            for ri in range(hi + 1, min(len(rows), hi + 4)):
                row = list(rows[ri]) + [None] * 3
                print("    data r%d: 日期=%r (type=%s) 自营GMV=%r 列数=%d" %
                      (ri + 1, row[0], type(row[0]).__name__, row[1], len(rows[ri])))
        except SystemExit as e:
            print("  ✗ %s" % e)


def build_rows(token, st, sheet_meta):
    """拉一个店铺子表 → (合计行, 数据行列表, 日期列表, 未来日期行数)

    ⚠️ 行位关系（实测 2026-11-17）：第1行标题、第2行空、第3行表头、**第4行合计**、第5行起为日数据。
    合计行同样带日期（46023=2026-01-01）且金额是汇总值（摩登新贵女 940.9 万 vs 次日 9.1 万），
    当成日数据会直接放大两个数量级。

    合计行必须原样回写到临时表，因为 生成看板数据.py 是按「第4行=合计、第5行起=日数据」
    的固定行位取数的；若临时表省掉合计行，生成脚本会再跳一行，把真实的第一天（2026-01-01）
    一起丢掉 —— 这个偏差实测出现过：起始日期从 2026-01-01 变成 2026-01-02。
    """
    rows = read_values(token, st, sheet_meta["sheet_id"], min(sheet_meta["rows"] or 400, MAX_ROWS))
    hi = check_header(rows, sheet_meta["title"])
    total_row = list(rows[hi + 1])[:NCOLS] if len(rows) > hi + 1 else None
    data_start = hi + 2
    today = datetime.date.today()
    data, dates, future = [], [], 0
    dropped = 0
    for row in rows[data_start:]:
        r = list(row) + [None] * (NCOLS - len(row))
        r = r[:NCOLS]
        d = excel_serial_to_date(r[0])
        if d is None or str(d).strip() == "":
            continue
        # 汇总行识别：源表每月月初插一行月度汇总（日期与当月 1 日相同、金额是整月合计），
        # 其「直播场次」列固定填 "-"，而日数据是 "9：30-24：30" 这类时间段文本；
        # 时长也是整月量级（24067 分钟）对日数据（约 850 分钟）。
        # 不剔除会把整月 GMV 叠加到当月 1 日，导致每月 1 日虚高数十倍。
        # 本地 Excel 版之所以「看起来没事」，是这些行被 pandas 读成了 1970-01-01，
        # 再被前端日期筛选顺带排除 —— 属于被掩盖的缺陷，不能复刻。
        if str(r[34]).strip() == "-":
            dropped += 1
            continue
        r[0] = d
        data.append(r)
        dd = d.date() if isinstance(d, datetime.datetime) else d
        if isinstance(dd, datetime.date):
            dates.append(dd.strftime("%Y-%m-%d"))
            if dd > today:
                future += 1
    if dropped:
        print("[INFO] %s: 剔除 %d 行月度/总计汇总行（直播场次列为 '-'）"
              % (sheet_meta["title"], dropped))
    if not data:
        raise SystemExit("[FATAL] %s: 剔除汇总行后无任何日数据，结构可能已变动" % sheet_meta["title"])
    return total_row, data, dates, future


def do_sync(args):
    import openpyxl
    from openpyxl.styles import Alignment

    token = get_token(args.app_id, args.app_secret)
    st, title, node = resolve_sheet_token(token, args.wiki_token, args.spreadsheet_token)
    sheets = list_sheets(token, st)
    by_title = {s["title"]: s for s in sheets}
    missing = [k for k in SHOP_KEYS if k not in by_title]
    if missing:
        raise SystemExit("[FATAL] 飞书源表缺少子表: %s（实际有: %s）"
                         % ("、".join(missing), "、".join(by_title)))

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    total = 0
    all_dates = []
    future_total = 0
    per_shop = {}

    for shop in SHOP_KEYS:
        total_row, rows, dates, future = build_rows(token, st, by_title[shop])
        ws = wb.create_sheet(shop)
        ws.append(["%s店铺维度" % shop])
        ws.append([None] * NCOLS)
        ws.append(list(EXPECTED_HEADER))
        # 合计行原位回写，保持与源表逐行同构（生成脚本依赖这个行位）
        ws.append(total_row if total_row else [None] * NCOLS)
        for r in rows:
            ws.append(r)
        all_dates.extend(dates)
        future_total += future
        per_shop[shop] = len(rows)
        total += len(rows)
        print("[OK] %s: %d 行（合计行已保留占位）" % (shop, len(rows)))

    wb.save(TMP_XLSX)
    print("[OK] 临时同构表: %s (%.1f KB)" % (TMP_XLSX, os.path.getsize(TMP_XLSX) / 1024))

    # 复用既有转换口径，避免两套算法各算一个数
    print("[..] 调用 生成看板数据.py")
    env = dict(os.environ)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    p = subprocess.run([sys.executable, GEN_SCRIPT, "--src", TMP_XLSX],
                       cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (p.stdout or "").strip().splitlines()
    for line in tail[-12:]:
        print("   " + line)
    if p.returncode != 0:
        err = (p.stderr or "").strip().splitlines()[-15:]
        meta = {
            "status": "fail",
            "source": "飞书「%s」" % title,
            "error": "生成看板数据.py 失败: " + (" / ".join(err[-3:]) if err else "未知错误"),
            "syncedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "updatedBy": os.environ.get("SYNC_ACTOR", "本地脚本"),
        }
        with open(META_PATH, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        raise SystemExit("[FATAL] 数据生成失败，已写 sync_meta 记录原因")

    all_dates.sort()
    # 源表末尾常有预填的未来日期行（当前实测 13 天×3 店=39 行），
    # 若直接把最后一行当「数据截止」，页面会显示一个尚未发生的日期。
    # 故 dataCutoff 只取「不晚于今天」的最后一天，源表实际最后一行另存 dataEndInSource。
    today_s = datetime.date.today().isoformat()
    real = [d for d in all_dates if d <= today_s]
    meta = {
        "status": "ok",
        "source": "飞书「%s」" % title,
        "dataCutoff": real[-1] if real else None,
        "dataEndInSource": all_dates[-1] if all_dates else None,
        "dataStart": all_dates[0] if all_dates else None,
        "recordCount": total,
        "perShop": per_shop,
        "futureRecords": future_total,
        "syncedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "updatedBy": os.environ.get("SYNC_ACTOR", "本地脚本"),
        "note": "页面运行时读取本文件，用于显示真实的数据截止时间与同步状态。",
    }
    if future_total:
        meta["warning"] = ("源表有 %d 行日期晚于今天（预填行），已从数据截止日期中排除" % future_total)
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print("[OK] sync_meta.json 已更新: %s 条 / 截止 %s" % (total, meta["dataCutoff"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", action="store_true", help="只探测结构，不写文件")
    ap.add_argument("--sync", action="store_true", help="拉全量并生成看板数据")
    ap.add_argument("--app-id", default=os.environ.get("FEISHU_APP_ID", "").strip())
    ap.add_argument("--app-secret", default=os.environ.get("FEISHU_APP_SECRET", "").strip())
    ap.add_argument("--wiki-token",
                    default=os.environ.get("FEISHU_WIKI_TOKEN", "").strip() or DEFAULT_WIKI_TOKEN)
    ap.add_argument("--spreadsheet-token",
                    default=os.environ.get("FEISHU_SPREADSHEET_TOKEN", "").strip()
                    or DEFAULT_SPREADSHEET_TOKEN,
                    help="直接指定电子表格 token；无 wiki:wiki 权限时用它直连")
    args = ap.parse_args()

    if not args.inspect and not args.sync:
        ap.print_help()
        return
    if not args.app_id or not args.app_secret:
        raise SystemExit("[FATAL] 缺少 FEISHU_APP_ID / FEISHU_APP_SECRET")

    if args.inspect:
        do_inspect(args)
    else:
        do_sync(args)


def write_fail_meta(reason):
    """同步失败时也把原因落进 sync_meta.json。

    实测 2026-11-17：缺 FEISHU_APP_ID 时脚本直接 SystemExit，meta 纹丝不动，
    页面继续显示上一次的 status=ok。后果是「云端早就挂了，页面还说同步成功」，
    比明确报错更危险。故在 __main__ 统一兜底，任何异常都写 fail meta。
    """
    prev_err = ""
    try:
        with open(META_PATH, encoding="utf-8") as f:
            prev = json.load(f)
        if prev.get("status") == "fail" and prev.get("error"):
            prev_err = " | 前序原因: " + str(prev["error"])
    except Exception:
        pass
    meta = {
        "status": "fail",
        "source": "飞书同步",
        "error": (str(reason)[:400] + prev_err)[:600],
        "syncedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "updatedBy": os.environ.get("SYNC_ACTOR", "本地脚本"),
        "note": "上一次同步未成功，以下数据仍是历史结果，请勿当作最新。",
    }
    try:
        with open(META_PATH, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        print("[FAIL] 已写 sync_meta.json: %s" % meta["error"])
    except Exception as e:
        print("[WARN] 写 sync_meta 失败: %s" % e)


def _run_guarded():
    """--sync 模式下，任何非零退出都要留下失败痕迹后以非零码退出。"""
    try:
        main()
    except SystemExit as e:
        code = e.code
        if isinstance(code, int):
            if code != 0:
                write_fail_meta("退出码 %d" % code)
            raise
        write_fail_meta(code or "未知原因")
        raise SystemExit(1)
    except Exception as e:
        import traceback
        traceback.print_exc()
        write_fail_meta("%s: %s" % (type(e).__name__, e))
        raise SystemExit(1)


if __name__ == "__main__":
    if "--sync" in sys.argv:
        _run_guarded()
    else:
        main()
