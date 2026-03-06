from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()

    # We will log all requests to find the API
    page.on("request", lambda request: print(">>", request.method, request.url))
    page.on("response", lambda response: print("<<", response.status, response.url))

    page.goto("https://beu-bih.ac.in/result-three?name=B.Tech.%201st%20Semester%20Examination,%202024&semester=I&session=2024&regNo=24110113031&exam_held=May%2F2025", wait_until="networkidle")

    # Let's see if we can extract any text
    print(page.content()[:1000])

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
