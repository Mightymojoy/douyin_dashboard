# -*- coding: utf-8 -*-
import pandas as pd, json, os
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = os.path.join(os.path.dirname(__file__), '抖音自营店铺数据源.xlsx')

shop_names = ['摩登新贵女','轻熟质享客','云端商务家']

print('='*70)
print('验证修复：店铺维度KPI正确性')
print('筛选：全部店铺，2026-06-01 至 2026-07-07')
print('='*70)

total_gmv=0; total_gsv=0; total_click=0; total_expose=0; total_buyers=0
total_live_amt=0; total_live_refund=0
total_card=0; total_other=0; total_short=0; total_mall_refund=0
total_gsv_weighted_fee=0
total_live_promo_gmv=0; total_short_ratio_w=0
total_non_grant_spend=0; total_non_grant_fee_w=0
total_spend=0; total_promo_gmv=0
days_count=0

for sn in shop_names:
    df = pd.read_excel(SRC, sheet_name=sn, header=None)
    for r in range(4, len(df)):
        try: d = pd.Timestamp(df.iloc[r,0]).strftime('%Y-%m-%d')
        except: continue
        if d < '2026-06-01' or d > '2026-07-07': continue
        days_count+=1
        gmv = float(df.iloc[r,1] or 0)
        gsv = float(df.iloc[r,2] or 0)
        total_gmv += gmv
        total_gsv += gsv
        total_click += int(df.iloc[r,29] or 0)
        total_expose += int(df.iloc[r,30] or 0)
        total_buyers += int(df.iloc[r,28] or 0)
        total_live_amt += float(df.iloc[r,24] or 0)
        total_live_refund += float(df.iloc[r,17] or 0)
        total_card += float(df.iloc[r,25] or 0)
        total_other += float(df.iloc[r,26] or 0)
        total_short += float(df.iloc[r,27] or 0)
        total_mall_refund += float(df.iloc[r,18] or 0)
        fee = float(df.iloc[r,22] or 0)
        total_gsv_weighted_fee += fee * gsv
        spend = float(df.iloc[r,62] or 0)
        pgmv = float(df.iloc[r,63] or 0)
        total_spend += spend
        total_promo_gmv += pgmv
        lpgmv = float(df.iloc[r,66] or 0)
        svr = float(df.iloc[r,77] or 0)
        total_short_ratio_w += svr * lpgmv
        total_live_promo_gmv += lpgmv
        ngsp = float(df.iloc[r,78] or 0)
        ngfr = float(df.iloc[r,79] or 0)
        total_non_grant_fee_w += ngfr * ngsp
        total_non_grant_spend += ngsp

print(f'\n天数: {days_count}')
print(f'\n--- 店铺维度 KPI ---')
print(f'自营GMV:     {total_gmv/10000:.1f}w')
print(f'自营GSV:     {total_gsv/10000:.1f}w')
print(f'退款率:      {(1-total_gsv/total_gmv)*100:.2f}%')

mall_base = total_card + total_other + total_short
print(f'\n商城退前占比: {mall_base/total_gmv*100:.2f}%')
print(f'曝光点击率:   {total_click/total_expose*100:.2f}%')
print(f'点击转化率:   {total_buyers/total_click*100:.2f}%')
print(f'曝光转化率:   {total_buyers/total_expose*100:.2f}%')
print(f'客单价:       {total_gmv/total_buyers:.0f}')
print(f'直播间退款率: {total_live_refund/total_live_amt*100:.2f}%')
print(f'商城退款率:   {total_mall_refund/mall_base*100:.2f}%')
print(f'店费比(GSV加权): {total_gsv_weighted_fee/total_gsv*100:.2f}%')

print(f'\n--- 千川维度 KPI ---')
print(f'总消耗:   {total_spend/10000:.1f}w')
print(f'推广GMV:  {total_promo_gmv/10000:.1f}w')
print(f'推广ROI:  {total_promo_gmv/total_spend:.2f}x')
print(f'短视频成交占比: {total_short_ratio_w/total_live_promo_gmv*100:.2f}%')
print(f'非赠款费比:     {total_non_grant_fee_w/total_non_grant_spend*100:.2f}%')

print(f'\n{"="*70}')
print('以上为数据源直接汇总，应与看板一致')
