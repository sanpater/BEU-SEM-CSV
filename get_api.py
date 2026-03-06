import urllib.request
import re

url = "https://beu-bih.ac.in/main.b7703db8e871d529.js"
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    content = response.read().decode('utf-8')
    # Find API endpoints
    urls = re.findall(r'https?://[^\s"\'<>]+', content)
    unique_urls = set(urls)
    for u in unique_urls:
        if 'api' in u or 'result' in u or 'beu' in u:
            print(u)
except Exception as e:
    print(e)
