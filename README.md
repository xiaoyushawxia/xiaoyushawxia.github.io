# xiaoyushawxia.github.io

Personal academic homepage of Xiaoyu (Shaw) Xia — a static site served by GitHub Pages.

## Asset versions

After changing anything in `assets/css` or `assets/js`, run `sh scripts/bump-assets.sh`
before committing, so browsers fetch the new files straight away.

## Visitor map

`stats.json` is refreshed every day by `.github/workflows/update_stats.yml`
(`scripts/update_stats.mjs`). It holds page views over the past 365 days,
per country for the ranking and per city for the map bubbles.

Repository secrets used by the workflow (Settings → Secrets and variables → Actions):

| Secret | Needed for |
|---|---|
| `GA_CREDENTIALS`, `GA_PROPERTY_ID` | Google Analytics — all countries |
| `BAIDU_API_KEY`, `BAIDU_SECRET_KEY`, `BAIDU_REFRESH_TOKEN`, `BAIDU_SITE_ID` | Baidu Tongji — mainland China (optional) |
| `GH_PAT` | lets the workflow save Baidu's new refresh token after each run |

### Setting up Baidu Tongji

1. In [Baidu Tongji](https://tongji.baidu.com) add the site `xiaoyushawxia.github.io` and
   put its tracking snippet in every page.
2. 管理 → 数据导出服务: turn it on and note the **API Key** and **Secret Key**.
3. Open, while logged in to Baidu:
   `https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=API_KEY&redirect_uri=oob&scope=basic&display=popup`
   and copy the **code** it shows.
4. Open
   `https://openapi.baidu.com/oauth/2.0/token?grant_type=authorization_code&code=CODE&client_id=API_KEY&client_secret=SECRET_KEY&redirect_uri=oob`
   and copy `refresh_token` from the reply.
5. The **site id** is the number in the address bar when viewing the site's reports
   (`site_id=…`).
6. Create a fine-grained GitHub token limited to this repository with
   *Secrets: Read and write*, and save it as `GH_PAT`.
7. Add the four `BAIDU_*` secrets, then run the workflow once from the Actions tab.

Baidu replaces the refresh token every time it is used; the workflow writes the new
one back to `BAIDU_REFRESH_TOKEN`. If a run ever fails at that step, repeat steps 3–4
and update the secret by hand.
