"""生成看板数据: 抖音自营店铺数据源.xlsx -> dashboard_data.json"""
import pandas as pd, json, os

SRC = os.path.join(os.path.dirname(__file__), '抖音自营店铺数据源.xlsx')
OUT = os.path.join(os.path.dirname(__file__), 'dashboard_data.json')

SHOP_KEYS = ['摩登新贵女','轻熟质享客','云端商务家']
SHOP_IDS = ['mdnjg','qszsk','ydswj']

def parse_date(v):
    if pd.isna(v): return None
    try: return pd.Timestamp(v).strftime('%Y-%m-%d')
    except: return None

def safe_float(v, default=0):
    if pd.isna(v): return default
    try: return float(v)
    except: return default

def safe_int(v):
    if pd.isna(v): return 0
    try: return int(round(float(v)))
    except: return 0

col = lambda c: c  # 0-based column index

output = {}

for sidx, sname in enumerate(SHOP_KEYS):
    df = pd.read_excel(SRC, sheet_name=sname, header=None)
    sid = SHOP_IDS[sidx]

    shop_data = []
    session_data = []
    qianchuan_data = []

    for r in range(4, len(df)):  # row 2=headers, row 3=totals, row 4+=daily
        date_str = parse_date(df.iloc[r, 0])
        if not date_str: continue

        # ---- 店铺维度 (0-33) ----
        gmv = safe_float(df.iloc[r, 1])       # 自营GMV
        gsv = safe_float(df.iloc[r, 2])       # 自营GSV（ttl浮动）
        subsidy = safe_float(df.iloc[r, 3])    # 退款后电商平台补贴金额
        coupon = safe_float(df.iloc[r, 4])     # 退款后千川智能优惠券金额
        payGsv = safe_float(df.iloc[r, 5])     # 用户支付GSV（退款时间）
        refundAmt = safe_float(df.iloc[r, 6])  # 自营退款（退款时间）
        refundRate = safe_float(df.iloc[r, 7]) # 自营退款率（退款时间）
        gsvTarget = safe_float(df.iloc[r, 8])  # 自营GSV目标
        achieveRate = safe_float(df.iloc[r, 9])# 自营GSV达成率
        prevYearGsv = safe_float(df.iloc[r, 10]) # 25年同期自营GSV
        yoy = safe_float(df.iloc[r, 11])       # 26vs25同比
        liveGsv = safe_float(df.iloc[r, 12])   # 直播GSV
        mallGsv = safe_float(df.iloc[r, 13])   # 商城GSV
        mallBeforeRatio = safe_float(df.iloc[r, 14]) # 商城退前占比
        mallAfterRatio = safe_float(df.iloc[r, 15])  # 商城退后占比
        refundPayTime = safe_float(df.iloc[r, 16])   # 自营退款（支付时间）
        liveRefund = safe_float(df.iloc[r, 17])       # 直播间退款（店铺日维度）
        mallRefund = safe_float(df.iloc[r, 18])        # 商城退款
        refundRate2 = safe_float(df.iloc[r, 19])       # 自营退款率
        liveRefundRate = safe_float(df.iloc[r, 20])    # 直播间退款率
        mallRefundRate = safe_float(df.iloc[r, 21])    # 商城退款率
        feeRatio = safe_float(df.iloc[r, 22])          # 店铺费比（除退款后）
        avgPrice = safe_float(df.iloc[r, 23])          # 客单价
        liveAmt = safe_float(df.iloc[r, 24])           # 直播间成交金额（店铺日维度）
        cardOrder = safe_float(df.iloc[r, 25])         # 商品卡成交
        otherRe = safe_float(df.iloc[r, 26])           # 其他
        shortVideo = safe_float(df.iloc[r, 27])        # 短视频及图文
        orderBuyers = safe_int(df.iloc[r, 28])          # 成交人数
        clickUsers = safe_int(df.iloc[r, 29])           # 商品点击人数
        exposeUsers = safe_int(df.iloc[r, 30])          # 商品曝光人数
        expClickRate = safe_float(df.iloc[r, 31])       # 商品曝光点击率
        clickConvRate = safe_float(df.iloc[r, 32])      # 商品点击-支付转化率
        expConvRate = safe_float(df.iloc[r, 33])        # 商品曝光转化率

        shop_data.append({
            'date': date_str,
            'gmv': gmv, 'gsv': gsv,
            'subsidy': subsidy, 'coupon': coupon,
            'payGsv': payGsv,
            'refundAmt': refundAmt, 'refundRate': refundRate,
            'gsvTarget': gsvTarget, 'achieveRate': achieveRate,
            'prevYearGsv': prevYearGsv, 'yoy': yoy,
            'liveGsv': liveGsv, 'mallGsv': mallGsv,
            'mallBeforeRatio': mallBeforeRatio, 'mallAfterRatio': mallAfterRatio,
            'refundPayTime': refundPayTime,
            'liveRefund': liveRefund, 'mallRefund': mallRefund,
            'refundRate2': refundRate2,
            'liveRefundRate': liveRefundRate, 'mallRefundRate': mallRefundRate,
            'feeRatio': feeRatio,
            'avgPrice': avgPrice,
            'liveAmt': liveAmt,
            'cardOrder': cardOrder, 'otherRe': otherRe, 'shortVideo': shortVideo,
            'orderBuyers': orderBuyers, 'clickUsers': clickUsers, 'exposeUsers': exposeUsers,
            'expClickRate': expClickRate, 'clickConvRate': clickConvRate, 'expConvRate': expConvRate
        })

        # ---- 直播间维度 (34-61) ----
        # 注意：列34表头为"直播场次"，但实际数据为时间范围字符串（如"10:00-24:00"），非场次计数
        timeRange = str(df.iloc[r, 34]) if pd.notna(df.iloc[r, 34]) else ''  # 主要时段
        sessions = safe_int(df.iloc[r, 34]) if isinstance(df.iloc[r, 34], (int, float)) else 0  # 若未来改为数字场次可用
        durMin = safe_float(df.iloc[r, 35])          # 直播时长（M）
        durHour = safe_float(df.iloc[r, 36])         # 直播时长（h）
        ssGmv = safe_float(df.iloc[r, 37])           # 直播间成交金额（场次日维度）
        ssRefund = safe_float(df.iloc[r, 38])         # 直播间退款金额（场次日维度）
        ssGsv = safe_float(df.iloc[r, 39])            # 直播GSV（场次日维度）
        ssGsvPerHour = safe_float(df.iloc[r, 40])     # 时均GSV（场次日维度）
        ssRefundRate = safe_float(df.iloc[r, 41])     # 直播间退款率（场次日维度）
        gpm = safe_float(df.iloc[r, 42])              # GPM
        expViewRate = safe_float(df.iloc[r, 43])      # 曝光-观看率
        viewProdExposeRate = safe_float(df.iloc[r, 44]) # 观看-商品曝光率
        prodExpClickRate = safe_float(df.iloc[r, 45])   # 商品曝光点击率
        prodClickDealRate = safe_float(df.iloc[r, 46])   # 商品点击-成交率
        liveExpDealRate = safe_float(df.iloc[r, 47])     # 直播曝光-成交率
        viewDealRate = safe_float(df.iloc[r, 48])         # 观看-成交率
        expInteractRate = safe_float(df.iloc[r, 49])      # 曝光互动率
        viewInteractRate = safe_float(df.iloc[r, 50])     # 观看互动率
        followRate = safe_float(df.iloc[r, 51])           # 转粉率
        uvPerHour = safe_float(df.iloc[r, 52])            # 时均UV
        liveAvgPrice = safe_float(df.iloc[r, 53])         # 直播客单价
        liveExpose = safe_int(df.iloc[r, 54])              # 直播曝光人数
        uv = safe_int(df.iloc[r, 55])                     # 场观人数（UV）
        prodExpose = safe_int(df.iloc[r, 56])              # 商品曝光人数
        prodClick = safe_int(df.iloc[r, 57])               # 商品点击人数
        dealBuyers = safe_int(df.iloc[r, 58])              # 成交人数
        interactUsers = safe_int(df.iloc[r, 59])           # 直播互动人数
        newFans = safe_int(df.iloc[r, 60])                 # 新增粉丝数
        avgViewSec = safe_float(df.iloc[r, 61])            # 人均观看时长（s）

        if sessions > 0 or ssGmv > 0 or timeRange:
            session_data.append({
                'date': date_str,
                'timeRange': timeRange, 'sessions': sessions,
                'durMin': durMin, 'durHour': durHour,
                'gmv': ssGmv, 'refund': ssRefund, 'gsv': ssGsv,
                'gsvPerHour': ssGsvPerHour, 'refundRate': ssRefundRate,
                'gpm': gpm,
                'expViewRate': expViewRate, 'viewProdExposeRate': viewProdExposeRate,
                'prodExpClickRate': prodExpClickRate, 'prodClickDealRate': prodClickDealRate,
                'liveExpDealRate': liveExpDealRate, 'viewDealRate': viewDealRate,
                'expInteractRate': expInteractRate, 'viewInteractRate': viewInteractRate,
                'followRate': followRate, 'uvPerHour': uvPerHour,
                'liveAvgPrice': liveAvgPrice,
                'liveExpose': liveExpose, 'uv': uv,
                'prodExpose': prodExpose, 'prodClick': prodClick,
                'dealBuyers': dealBuyers, 'interactUsers': interactUsers,
                'newFans': newFans, 'avgViewSec': avgViewSec
            })

        # ---- 千川付费维度 (62-79) ----
        totalSpend = safe_float(df.iloc[r, 62])        # 总花费
        promoGmv = safe_float(df.iloc[r, 63])          # 推广gmv
        promoRoi = safe_float(df.iloc[r, 64])          # 推广ROI
        liveSpend = safe_float(df.iloc[r, 65])         # 直播花费
        livePromoGmv = safe_float(df.iloc[r, 66])      # 直播推广GMV
        livePromoRoi = safe_float(df.iloc[r, 67])      # 直播推广ROI
        directSpend = safe_float(df.iloc[r, 68])       # 直投花费
        directGmv = safe_float(df.iloc[r, 69])         # 直投GMV
        directRoi = safe_float(df.iloc[r, 70])         # 直投ROI
        materialSpend = safe_float(df.iloc[r, 71])     # 素材花费
        materialGmv = safe_float(df.iloc[r, 72])       # 素材GMV
        materialRoi = safe_float(df.iloc[r, 73])       # 素材ROI
        mallSpend = safe_float(df.iloc[r, 74])         # 商城花费
        mallPromoGmv = safe_float(df.iloc[r, 75])      # 商城推广gmv
        mallPromoRoi = safe_float(df.iloc[r, 76])      # 商城推广ROI
        shortVideoRatio = safe_float(df.iloc[r, 77])   # 短视频引流成交占比
        nonGrantSpend = safe_float(df.iloc[r, 78])     # 千川非赠款花费
        nonGrantFeeRatio = safe_float(df.iloc[r, 79])  # 非赠款实际费比

        if totalSpend > 0 or promoGmv > 0 or liveSpend > 0 or directSpend > 0 or materialSpend > 0 or mallSpend > 0 or nonGrantSpend > 0:
            qianchuan_data.append({
                'date': date_str,
                'totalSpend': totalSpend,
                'promoGmv': promoGmv, 'promoRoi': promoRoi,
                'liveSpend': liveSpend, 'livePromoGmv': livePromoGmv, 'livePromoRoi': livePromoRoi,
                'directSpend': directSpend, 'directGmv': directGmv, 'directRoi': directRoi,
                'materialSpend': materialSpend, 'materialGmv': materialGmv, 'materialRoi': materialRoi,
                'mallSpend': mallSpend, 'mallPromoGmv': mallPromoGmv, 'mallPromoRoi': mallPromoRoi,
                'shortVideoRatio': shortVideoRatio,
                'nonGrantSpend': nonGrantSpend,
                'nonGrantFeeRatio': nonGrantFeeRatio
            })

    output[sid] = {
        'shop': shop_data,
        'sessions': session_data,
        'qianchuan': qianchuan_data
    }
    print(f'{sname}({sid}): shop={len(shop_data)}天, sessions={len(session_data)}天, qc={len(qianchuan_data)}天')

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f'\n已输出: {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)')

# Also output as JS for standalone HTML loading
JS_OUT = os.path.join(os.path.dirname(__file__), 'dashboard_data.js')
with open(JS_OUT, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated by 生成看板数据.py\n')
    f.write('window.DASHBOARD_DATA = ')
    json.dump(output, f, ensure_ascii=False)
    f.write(';\n')
print(f'已输出: {JS_OUT} ({os.path.getsize(JS_OUT)/1024:.0f} KB)')

# ---- 生成数据内嵌HTML版（自包含，双击即用） ----
HTML_SRC = os.path.join(os.path.dirname(__file__), 'douyin_dashboard.html')
HTML_OUT = os.path.join(os.path.dirname(__file__), 'douyin_dashboard_embedded.html')

with open(HTML_SRC, 'r', encoding='utf-8') as f:
    html_content = f.read()

script_tag = '<script src="dashboard_data.js"></script>'
json_str = json.dumps(output, ensure_ascii=False, separators=(',',':'))
inline_script = f'<script>window.DASHBOARD_DATA = {json_str};</script>'

if script_tag in html_content:
    html_content = html_content.replace(script_tag, inline_script)
    with open(HTML_OUT, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print(f'已输出: {HTML_OUT} ({os.path.getsize(HTML_OUT)/1024:.0f} KB, 数据内嵌版)')
else:
    print(f'⚠ 警告: 在 douyin_dashboard.html 中未找到 "{script_tag}"，跳过HTML嵌入')
