import json
d = json.load(open('dashboard_data.json'))
s = d['mdnjg']['shop'][0]
print(f"date={s['date']} gmv={s['gmv']:.0f} gsv={s['gsv']:.0f} refundRate={s['refundRate']:.4f} avgPrice={s['avgPrice']:.0f}")
print(f"feeRatio={s['feeRatio']:.4f} liveGsv={s['liveGsv']:.0f} mallGsv={s['mallGsv']:.0f}")
print(f"Expected: gmv=90826 gsv=64166 refundRate=0.2958 avgPrice=1211")
