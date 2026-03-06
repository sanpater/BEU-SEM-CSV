import urllib.request
import re

url = "https://beu-bih.ac.in/main.b7703db8e871d529.js"
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    response = urllib.request.urlopen(req)
    content = response.read().decode('utf-8')

    # Let's search for some strings that might indicate the endpoints
    matches = re.findall(r'[\'"`]/v1/[^\'"`]+[\'"`]', content)
    unique_matches = set(matches)
    for m in unique_matches:
        print(m)

    print("-----")
    matches = re.findall(r'[\'"`]api/[^\'"`]+[\'"`]', content)
    unique_matches = set(matches)
    for m in unique_matches:
        print(m)

    print("-----")
    # Search for something like "result", "mark"
    matches = re.findall(r'[\'"`][a-zA-Z0-9_/-]*result[a-zA-Z0-9_/-]*[\'"`]', content)
    unique_matches = set(matches)
    for m in unique_matches:
        print(m)
except Exception as e:
    print(e)
