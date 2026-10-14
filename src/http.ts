import makeFetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

const USER_AGENT = "ilias-sync/0.1 (+personal course mirror)";

export class HttpClient {
  readonly jar = new CookieJar();
  private readonly fetchWithCookies = makeFetchCookie(fetch, this.jar);
  /** Called when a response looks like we were logged out; should re-authenticate. */
  onSessionExpired?: () => Promise<void>;

  constructor(readonly baseUrl: string) {
    if (!this.baseUrl.endsWith("/")) this.baseUrl += "/";
  }

  resolve(url: string): string {
    return new URL(url, this.baseUrl).toString();
  }

  async request(url: string, init: RequestInit = {}, retries = 3): Promise<Response> {
    const target = this.resolve(url);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetchWithCookies(target, {
          ...init,
          headers: { "User-Agent": USER_AGENT, ...init.headers },
        });
        if (res.status >= 500 && attempt < retries) {
          await res.body?.cancel();
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        if (attempt >= retries) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  /** GET an HTML page, transparently re-logging in once if the session expired. */
  async getHtml(url: string): Promise<{ html: string; url: string }> {
    let res = await this.request(url);
    let html = await res.text();
    if (isLoginPage(res.url, html) && this.onSessionExpired) {
      await this.onSessionExpired();
      res = await this.request(url);
      html = await res.text();
      if (isLoginPage(res.url, html)) throw new Error(`Still logged out after re-login: ${url}`);
    }
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    return { html, url: res.url };
  }
}

export function isLoginPage(url: string, html: string): boolean {
  return /login\.php/.test(url) || (/type=["']password["']/.test(html) && !/logout/i.test(html));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
