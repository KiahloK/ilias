import * as cheerio from "cheerio";
import type { HttpClient } from "./http.js";

/**
 * Logs in through ILIAS' local login form. The form is discovered generically
 * (the form containing a password field), so hidden inputs and the action URL
 * are taken from the page instead of being hard-coded.
 */
export async function login(http: HttpClient, username: string, password: string): Promise<void> {
  const loginRes = await http.request("login.php?cmd=force_login");
  const loginHtml = await loginRes.text();
  const $ = cheerio.load(loginHtml);

  const form = $("form").filter((_, f) => $(f).find('input[type="password"]').length > 0).first();
  if (form.length === 0) throw new Error("Could not find the ILIAS login form.");

  const body = new URLSearchParams();
  form.find("input[name]").each((_, el) => {
    const input = $(el);
    const type = (input.attr("type") ?? "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (input.is("[checked]")) body.append(input.attr("name")!, input.attr("value") ?? "on");
    } else if (type !== "submit" && type !== "button") {
      body.append(input.attr("name")!, input.attr("value") ?? "");
    }
  });

  const passwordField = form.find('input[type="password"]').attr("name")!;
  const usernameField =
    form.find('input[name="username"], input[name="login_form/input_3/input_4"]').attr("name") ??
    form.find('input[type="text"], input[type="email"], input:not([type])').first().attr("name");
  if (!usernameField) throw new Error("Could not find the username field in the login form.");
  body.set(usernameField, username);
  body.set(passwordField, password);

  const submit = form.find('[type="submit"][name]').first();
  if (submit.length) body.set(submit.attr("name")!, submit.attr("value") ?? "");

  const action = http.resolve(new URL(form.attr("action") ?? "", loginRes.url).toString());
  const res = await http.request(action, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const html = await res.text();
  if (!/logout/i.test(html)) {
    throw new Error("Login failed — check username/password (no logout link after login).");
  }
}
