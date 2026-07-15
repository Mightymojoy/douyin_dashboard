import sys
with open("e:/抖音店铺-看板/刷新数据.bat", "rb") as f:
    content = f.read()
# Replace \r\r\n with \r\n
content = content.replace(b'\r\r\n', b'\r\n')
with open("e:/抖音店铺-看板/刷新数据.bat", "wb") as f:
    f.write(content)
print("Fixed line endings")
